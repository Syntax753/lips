import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repo root. Whether running from src/ (tsx) or dist/ (built), two levels up
 * is the repo root, where the sibling go-mcp-server package lives.
 */
export const repoRoot = path.resolve(here, "..", "..");

/** Directory of the Go MCP server package. */
export const goServerDir = path.join(repoRoot, "go-mcp-server");

const binaryName = process.platform === "win32" ? "comparators.exe" : "comparators";

/**
 * Absolute path to the compiled Go MCP server binary. Override with
 * COMPARATORS_MCP_BIN if you build it somewhere else.
 */
export const serverBinary =
  process.env.COMPARATORS_MCP_BIN ??
  path.join(goServerDir, "bin", binaryName);

/**
 * Model alias used by both the coordinator and the comparator specialists.
 * Routing + a single tool call is well within Haiku's reach, so default there
 * to keep the "distributed" fan-out cheap. Override with LIPS_MODEL.
 */
export const model = process.env.LIPS_MODEL ?? "haiku";
