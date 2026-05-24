import * as readline from "node:readline";
import { coordinate } from "./coordinator.js";
import { directEvaluate } from "./mcpClient.js";
import { OPERATORS, parseExpression } from "./parser.js";
import { serverBinary, model } from "./config.js";
import { ensureServerReady } from "./bootstrap.js";
import { decide, type Goal } from "./cmp/decide.js";
import { COMPARATOR_NAMES, type ComparatorName } from "./cmp/index.js";

const PROMPT = ">>> ";

function banner(): void {
  console.log("lips — symbolic-logic coordinator REPL");
  console.log(`coordinator model: ${model}   server: ${serverBinary}`);
  console.log("Ask in plain language — a comparison, a decision, or a word problem,");
  console.log('e.g. "is twelve greater than fourteen?" or "which is bigger, 12 or 14?".');
  console.log(":help for commands, :quit to exit.");
}

function help(): void {
  console.log(
    [
      "Commands:",
      "  <text>                          Ask the coordinator (uses the model): a comparison, a decision,",
      "                                  or a word problem / system of equations. e.g.:",
      '                                    "is 12 greater than 14?"          -> false',
      '                                    "which is bigger, 12 or 14?"      -> 14',
      '                                    "I am four times my nephew\'s age..." -> solves the system',
      "  :direct <expr>                  Boolean compare via the Go server directly (no model).",
      "  :decide <kind> <goal> <a> <b>   Decide locally (no model). kind=numeric|alpha, goal=max|min.",
      "                                  Prints -1 (a better) / +1 (b better) / 0 (tie).",
      "  :parse  <expr>                  Show how an expression is parsed locally.",
      "  :ops                            List the supported operators.",
      "  :help                           Show this help.",
      "  :quit | :exit                   Leave the REPL (Ctrl-D also works).",
      "",
      "Tool calls are always shown (· lines) so you can see the delegation as it happens.",
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
  const result = await coordinate(expr);

  // The whole run as a call tree: the coordinator (and every tool) shows its
  // name and inputs, nested calls indented beneath, and its return on a `--> `
  // line. The coordinator's own `-->` is the final answer.
  for (const step of result.trace) console.log(`  ${step}`);
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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: PROMPT,
});
// Hold input until the Go MCP server is provisioned and built.
rl.pause();

rl.on("line", (line) => {
  rl.pause();
  dispatch(line)
    .catch((err) => console.log(`  unexpected error: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => rl.prompt()); // prompt() also resumes the paused input
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
