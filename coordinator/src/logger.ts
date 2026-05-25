/**
 * Live logging for long-running work (notably the grid search). Lines are written
 * straight to stderr and flushed, so they appear in the terminal AS the work
 * happens — never buffered into a tool result (which would bloat the model's
 * context and can exceed token limits).
 *
 * Levels: "verbose" (default) emits the per-state search log; "basic" suppresses
 * it. The REPL sets the level from the `--log=` flag.
 */
export type LogLevel = "verbose" | "basic";

// Default quiet so programmatic/library use (and the test suite) stays clean; the
// REPL turns verbose ON by default (suppress it with --log=basic).
let currentLevel: LogLevel = "basic";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

/** Emit a verbose progress line (no-op under "basic"). Flushed to stderr. */
export function logVerbose(line: string): void {
  if (currentLevel === "verbose") process.stderr.write(line + "\n");
}
