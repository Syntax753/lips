/**
 * Bundled Go toolchain + server build.
 *
 * The Go MCP server needs a Go compiler. Rather than require a separate manual
 * install, this module makes the project self-contained:
 *
 *   1. If a usable system `go` (>= MIN_GO) is on PATH, use it.
 *   2. Otherwise download a pinned Go release into the gitignored .toolchain/
 *      directory (once; cached afterwards) and use that.
 *
 * `ensureServerReady()` is called at REPL startup, so the very first launch
 * provisions the toolchain and builds the server binary on demand.
 *
 * Env overrides:
 *   LIPS_GO=bundled | system | auto   force toolchain source (default: auto)
 *   GO_VERSION=1.24.0                 pin a specific Go version to download
 */

import { spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { goServerDir, repoRoot, serverBinary } from "./config.js";

const MIN_GO = { major: 1, minor: 22 };

const toolchainDir = path.join(repoRoot, ".toolchain");
const bundledGoDir = path.join(toolchainDir, "go");
const goExe = process.platform === "win32" ? "go.exe" : "go";
const bundledGoBin = path.join(bundledGoDir, "bin", goExe);

// --- process helper ----------------------------------------------------------

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  capture?: boolean;
}

function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let out = "";
    if (opts.capture) {
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`\`${cmd} ${args.join(" ")}\` exited ${code}${out ? `: ${out.trim()}` : ""}`)),
    );
  });
}

// --- toolchain provisioning --------------------------------------------------

function goVersionOk(versionOutput: string): boolean {
  const m = /go(\d+)\.(\d+)/.exec(versionOutput);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > MIN_GO.major || (major === MIN_GO.major && minor >= MIN_GO.minor);
}

async function systemGo(): Promise<string | null> {
  try {
    const out = await run("go", ["version"], { capture: true });
    return goVersionOk(out) ? "go" : null;
  } catch {
    return null;
  }
}

/** Build env that keeps Go's caches inside the project and pins the toolchain. */
function goEnv(goBin: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GOCACHE: path.join(toolchainDir, "gocache"),
    GOPATH: path.join(toolchainDir, "gopath"),
    GOTOOLCHAIN: "local",
    PATH: `${path.dirname(goBin)}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

interface GoArchive {
  filename: string;
  url: string;
}

async function resolveGoArchive(): Promise<GoArchive> {
  const goos =
    process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const goarch =
    process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch;
  const ext = goos === "windows" ? "zip" : "tar.gz";

  const pin = process.env.GO_VERSION;
  if (pin) {
    const filename = `go${pin}.${goos}-${goarch}.${ext}`;
    return { filename, url: `https://go.dev/dl/${filename}` };
  }

  const res = await fetch("https://go.dev/dl/?mode=json");
  if (!res.ok) throw new Error(`could not list Go releases (HTTP ${res.status})`);
  const releases = (await res.json()) as Array<{
    version: string;
    stable: boolean;
    files: Array<{ filename: string; os: string; arch: string; kind: string }>;
  }>;
  const stable = releases.find((r) => r.stable) ?? releases[0];
  const file = stable?.files.find((f) => f.os === goos && f.arch === goarch && f.kind === "archive");
  if (!file) throw new Error(`no Go archive for ${goos}/${goarch} in ${stable?.version ?? "?"}`);
  return { filename: file.filename, url: `https://go.dev/dl/${file.filename}` };
}

async function downloadGo(): Promise<void> {
  const { filename, url } = await resolveGoArchive();
  mkdirSync(toolchainDir, { recursive: true });
  const archivePath = path.join(toolchainDir, filename);

  console.log(`· downloading Go toolchain (${filename}) — first run only`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(archivePath));

  if (existsSync(bundledGoDir)) rmSync(bundledGoDir, { recursive: true, force: true });
  console.log(`· extracting into ${path.relative(repoRoot, bundledGoDir)}/`);
  // Extract from toolchainDir with a bare filename. On Windows, pin the system
  // bsdtar (C:\Windows\System32\tar.exe): it handles .zip, whereas a git-bash
  // GNU tar that may be earlier on PATH does not. A relative filename also
  // avoids bsdtar reading the "C:" of an absolute path as a remote host.
  const tarCmd =
    process.platform === "win32"
      ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  await run(tarCmd, ["-xf", filename], { cwd: toolchainDir });
  rmSync(archivePath, { force: true });

  if (!existsSync(bundledGoBin)) {
    throw new Error(`extraction did not produce ${bundledGoBin}`);
  }
}

/** Resolve a Go binary to use, downloading the bundled toolchain if needed. */
export async function ensureGo(): Promise<string> {
  if (existsSync(bundledGoBin)) return bundledGoBin;

  const pref = process.env.LIPS_GO; // 'bundled' | 'system' | undefined (=auto)
  if (pref !== "bundled") {
    const sys = await systemGo();
    if (sys) return sys;
    if (pref === "system") {
      throw new Error(`LIPS_GO=system but no usable 'go' (>= ${MIN_GO.major}.${MIN_GO.minor}) is on PATH`);
    }
  }

  await downloadGo();
  return bundledGoBin;
}

// --- server build ------------------------------------------------------------

/** Rebuild when the binary is missing or older than any source file. */
function needsBuild(): boolean {
  if (!existsSync(serverBinary)) return true;
  const binMtime = statSync(serverBinary).mtimeMs;
  for (const f of readdirSync(goServerDir)) {
    if (f.endsWith(".go") || f === "go.mod") {
      if (statSync(path.join(goServerDir, f)).mtimeMs > binMtime) return true;
    }
  }
  return false;
}

async function buildServer(goBin: string): Promise<void> {
  mkdirSync(path.dirname(serverBinary), { recursive: true });
  console.log("· building Go MCP server");
  await run(goBin, ["build", "-o", serverBinary, "."], { cwd: goServerDir, env: goEnv(goBin) });
}

async function testServer(goBin: string): Promise<void> {
  console.log("· running go test ./...");
  await run(goBin, ["test", "./..."], { cwd: goServerDir, env: goEnv(goBin) });
}

/**
 * Ensure a Go toolchain exists and the server binary is built and current.
 * Cheap and quiet on the common path (toolchain cached, binary fresh).
 */
export async function ensureServerReady(): Promise<void> {
  const goBin = await ensureGo();
  if (needsBuild()) await buildServer(goBin);
}

// --- CLI: `tsx src/bootstrap.ts` provisions Go, tests, and builds ------------

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  (async () => {
    const goBin = await ensureGo();
    console.log(`· using Go: ${goBin === "go" ? "system 'go'" : goBin}`);
    await testServer(goBin);
    await buildServer(goBin);
    console.log(`✓ server ready: ${serverBinary}`);
  })().catch((err) => {
    console.error(`bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
