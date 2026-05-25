import * as readline from "node:readline";
import { coordinate } from "./coordinator.js";
import { directEvaluate } from "./mcpClient.js";
import { OPERATORS, parseExpression } from "./parser.js";
import { serverBinary, model } from "./config.js";
import { ensureServerReady } from "./bootstrap.js";
import { decide, type Goal } from "./cmp/decide.js";
import { COMPARATOR_NAMES, type ComparatorName } from "./cmp/index.js";

const PROMPT = ">>> ";
const CONT = "... ";
/** Lines accumulated for the current input; a blank line submits the block. */
const buffer: string[] = [];
/** Timestamp of the last content line, to tell a deliberate blank line apart
 *  from the LF that follows a pasted CRLF (which arrives within a few ms). */
let lastContentAt = 0;
const BLANK_SUBMIT_MS = 100;

function banner(): void {
  console.log("lips — symbolic-logic coordinator REPL");
  console.log(`coordinator model: ${model}   server: ${serverBinary}`);
  console.log("Type a question or paste a grid over one or more lines, then a BLANK line to run it.");
  console.log('e.g. "is twelve greater than fourteen?", Enter, then Enter again on a blank line.');
  console.log("A pasted grid is SOLVED by default (shortest path of @ to the goal x).");
  console.log("Commands start with ':' (e.g. :help, :quit) and run on their own line.");
}

function help(): void {
  console.log(
    [
      "Commands:",
      "  <text…>                         Your input over one or more lines (a question, or paste a grid).",
      "                                  A BLANK line submits the block to the coordinator; :cancel clears it.",
      '                                    "is 12 greater than 14?" + blank line   -> false',
      "                                    paste a grid + blank line               -> solve it (shortest path to x)",
      "  :direct <expr>                  Boolean compare via the Go server directly (no model).",
      "  :decide <kind> <goal> <a> <b>   Decide locally (no model). kind=numeric|alpha, goal=max|min.",
      "                                  Prints -1 (a better) / +1 (b better) / 0 (tie).",
      "  :parse  <expr>                  Show how an expression is parsed locally.",
      "  :ops                            List the supported operators.",
      "  :help                           Show this help.",
      "  :quit | :exit                   Leave the REPL (Ctrl-D also works).",
      "",
      "Commands (lines starting with ':') run immediately. Everything else accumulates until a blank line.",
      "Operators accept keyword or symbol forms, e.g. GT or >, NEQ or != .",
    ].join("\n"),
  );
}

function listOps(): void {
  for (const op of OPERATORS) {
    console.log(`  ${op.keyword.padEnd(4)} ${op.forms.join(" / ").padEnd(12)} ${op.label}`);
  }
}

async function runDirect(expr: string): Promise<void> {
  const parsed = parseExpression(expr);
  if (!parsed) {
    console.log(`  could not parse "${expr}" as <lhs> <op> <rhs>`);
    return;
  }
  try {
    const value = await directEvaluate(parsed.operator, parsed.lhs, parsed.rhs);
    console.log(`  ${value}`);
  } catch (err) {
    console.log(`  error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runCoordinator(expr: string): Promise<void> {
  // Stream each call/result the moment it happens (flushed line-by-line), so the
  // delegation is visible as it unfolds rather than dumped at the end.
  const result = await coordinate(expr, (line) => console.log(`  ${line}`));
  if (result.error) console.log(`  error: ${result.error}`);
}

function runDecide(rest: string): void {
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length !== 4) {
    console.log("  usage: :decide <numeric|alpha> <max|min> <lhs> <rhs>");
    return;
  }
  const [comparator, goal, lhs, rhs] = parts;
  if (!COMPARATOR_NAMES.includes(comparator as ComparatorName)) {
    console.log(`  unknown comparator "${comparator}" (use: ${COMPARATOR_NAMES.join(", ")})`);
    return;
  }
  if (goal !== "max" && goal !== "min") {
    console.log(`  goal must be "max" or "min"`);
    return;
  }
  try {
    const v = decide(lhs, rhs, comparator as ComparatorName, goal as Goal);
    const sign = v.verdict > 0 ? "+1" : v.verdict < 0 ? "-1" : "0";
    const better = v.winner === "tie" ? "tie" : v.winner === "lhs" ? lhs : rhs;
    console.log(`  verdict ${sign}  (better: ${better})`);
  } catch (err) {
    console.log(`  error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function dispatch(line: string): Promise<void> {
  const input = line.trim();
  if (input === "") return;

  if (input === ":quit" || input === ":exit" || input === ":q") {
    rl.close();
    return;
  }
  if (input === ":help" || input === ":h") return help();
  if (input === ":ops") return listOps();

  if (input.startsWith(":parse")) {
    const expr = input.slice(":parse".length).trim();
    const parsed = parseExpression(expr);
    console.log(parsed ? `  ${JSON.stringify(parsed)}` : `  no match`);
    return;
  }

  if (input.startsWith(":direct")) {
    return runDirect(input.slice(":direct".length).trim());
  }

  if (input.startsWith(":decide")) {
    return runDecide(input.slice(":decide".length).trim());
  }

  if (input.startsWith(":")) {
    console.log(`  unknown command: ${input}  (try :help)`);
    return;
  }

  await runCoordinator(input);
}

/**
 * Top-level line handler. Outside multiline mode it dispatches commands; the
 * `:ml` family starts a multiline block. Inside multiline mode every line is
 * accumulated until a blank line (submit) or `:cancel` (abort).
 */
async function onLine(raw: string): Promise<void> {
  const line = raw.replace(/\r/g, ""); // strip CR so pasted CRLF doesn't leak in
  // At the start of a fresh input, a ':' line is a command and runs immediately.
  if (buffer.length === 0 && line.trim().startsWith(":")) {
    await dispatch(line);
    return;
  }
  // Mid-block, :cancel discards what's been typed so far.
  if (buffer.length > 0 && line.trim() === ":cancel") {
    buffer.length = 0;
    console.log("  (input cleared)");
    return;
  }
  if (line.trim() === "") {
    if (buffer.length === 0) return;
    // Ignore a blank that lands right after content — it's the LF half of a
    // pasted CRLF newline, not a deliberate submit. A real blank line (typed
    // after a pause) submits the block.
    if (Date.now() - lastContentAt < BLANK_SUBMIT_MS) return;
    const text = buffer.join("\n");
    buffer.length = 0;
    await runCoordinator(text);
    return;
  }
  buffer.push(line);
  lastContentAt = Date.now();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: PROMPT,
});
// Hold input until the Go MCP server is provisioned and built.
rl.pause();

rl.on("line", (line) => {
  rl.pause();
  onLine(line)
    .catch((err) => console.log(`  unexpected error: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => {
      rl.setPrompt(buffer.length > 0 ? CONT : PROMPT);
      rl.prompt(); // prompt() also resumes the paused input
    });
});

rl.on("close", () => {
  console.log("bye");
  process.exit(0);
});

(async () => {
  try {
    await ensureServerReady();
  } catch (err) {
    console.error(
      `could not prepare the Go MCP server: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  banner();
  rl.prompt(); // resumes the paused input stream
})();
