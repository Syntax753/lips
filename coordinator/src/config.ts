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
 * Model aliases. Routing, plain-number comparisons, arithmetic and simple
 * algebra are well within Haiku's reach, so they stay on the cheap/fast model
 * to keep the "distributed" fan-out cheap. Richer data types — game-state
 * grids, JSON objects, text/type conversion — are handled by a stronger model
 * for reliability. Override with LIPS_MODEL / LIPS_COMPLEX_MODEL.
 */
export const model = process.env.LIPS_MODEL ?? "haiku";
export const complexModel = process.env.LIPS_COMPLEX_MODEL ?? "sonnet";
