import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, Options } from "@anthropic-ai/claude-agent-sdk";
import { coordinatorSystemPrompt, mcpServers, specialistAgents } from "./agents.js";
import { model } from "./config.js";

/**
 * Permission gate that enforces "the coordinator only calls Task". Task is
 * always allowed; any other tool is allowed only when it runs inside a
 * subagent (options.agentID is set). A direct tool call by the coordinator is
 * denied, forcing it to delegate.
 */
const canUseTool: CanUseTool = async (tool, input, options) => {
  if (tool === "Task" || options.agentID) {
    return { behavior: "allow", updatedInput: input };
  }
  return {
    behavior: "deny",
    message: "The coordinator must not call tools directly — spawn the matching specialist via the Task tool.",
  };
};

export interface CoordinatorResult {
  /** The coordinator's final answer text. */
  raw: string;
  /** Parsed boolean when the answer is a bare truth, else null. */
  value: boolean | null;
  /** The delegation rendered as an indented call tree. */
  trace: string[];
  /** Set when the run failed before producing a result. */
  error?: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "tool_use"
  );
}

function extractBoolean(text: string): boolean | null {
  const matches = text.toLowerCase().match(/\b(true|false)\b/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1] === "true";
}

// --- call tree ---------------------------------------------------------------

interface CallNode {
  id: string;
  caller: string; // "coordinator" or the subagent type that made the call
  tool: string;
  input: unknown;
  result: string | null;
  children: CallNode[];
}

/** Flattened text of a tool_result block (what a call returned). */
function toolResultText(block: unknown): string | null {
  if (typeof block !== "object" || block === null) return null;
  const b = block as { type?: unknown; content?: unknown };
  if (b.type !== "tool_result") return null;
  let text = "";
  if (typeof b.content === "string") text = b.content;
  else if (Array.isArray(b.content)) {
    text = b.content
      .map((x) =>
        typeof x === "object" && x !== null && (x as { type?: unknown }).type === "text"
          ? String((x as { text?: unknown }).text ?? "")
          : "",
      )
      .join(" ");
  }
  text = text.trim();
  return text.length > 0 ? text : null;
}

/** The subagent-spawning tool is surfaced as "Agent" (or "Task"). */
function isSubagentCall(tool: string): boolean {
  return tool === "Agent" || tool === "Task";
}

/** Input entries to print. A subagent's type goes in the name, so drop it here. */
function inputEntries(node: CallNode): [string, unknown][] {
  if (typeof node.input !== "object" || node.input === null) return [];
  const entries = Object.entries(node.input as Record<string, unknown>);
  return isSubagentCall(node.tool) ? entries.filter(([k]) => k !== "subagent_type") : entries;
}

/** Display name, e.g. "Agent → gt-specialist" or the bare tool name. */
function nodeName(node: CallNode): string {
  if (isSubagentCall(node.tool)) {
    const sub = (node.input as { subagent_type?: string } | null)?.subagent_type ?? "?";
    return `${node.tool} → ${sub}`;
  }
  return node.tool;
}

/** Inputs rendered inline for the `name (inputs)` header line. */
function formatInputs(node: CallNode): string {
  if (typeof node.input === "string") return node.input;
  return inputEntries(node)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

/** Strip subagent bookkeeping (agentId hint, <usage> block) from a result. */
function cleanResult(text: string): string {
  return text
    .replace(/<usage>.*?<\/usage>/gs, "")
    .replace(/\s*agentId:\s*\S+\s*\(use SendMessage[^)]*\)/g, "")
    .replace(/\s*\|\s*$/g, "")
    .trim();
}

interface EmbeddedTrace {
  ops: { name: string; input: string; output: string }[];
  summary: string;
}

/**
 * If a result carries an internal op trace (the algebra delegator runs
 * preflight/reduce/solve in code), surface each op so it renders as a nested
 * call instead of a single JSON blob.
 */
function embeddedTrace(result: string | null): EmbeddedTrace | null {
  if (!result) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(result);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as { trace?: unknown; ok?: unknown; solution?: unknown; reason?: unknown };
  if (!Array.isArray(o.trace)) return null;
  const ops = o.trace
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({ name: String(x.name ?? ""), input: String(x.input ?? ""), output: String(x.output ?? "") }));
  const summary = o.ok
    ? `solution: ${Object.entries((o.solution as Record<string, unknown>) ?? {})
        .map(([k, v]) => `${k} = ${v}`)
        .join(", ")}`
    : `not solvable: ${String(o.reason ?? "")}`;
  return { ops, summary };
}

function renderNode(node: CallNode, depth: number, lines: string[]): void {
  const pad = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);
  const innerResult = "  ".repeat(depth + 2);
  lines.push(`${pad}${nodeName(node)} (${formatInputs(node)})`); // name (inputs), indented under its caller
  for (const child of node.children) renderNode(child, depth + 1, lines); // nested calls, indented one deeper

  // A delegator's internal operations render as nested calls of their own.
  const embedded = embeddedTrace(node.result);
  if (embedded) {
    for (const op of embedded.ops) {
      lines.push(`${inner}${op.name} (${op.input})`);
      lines.push(`${innerResult}--> ${op.output}`);
    }
    lines.push(`${inner}--> ${embedded.summary}`);
    return;
  }

  const cleaned = node.result ? cleanResult(node.result) : "";
  const resultLines = (cleaned || "(no result)").split("\n");
  lines.push(`${inner}--> ${resultLines[0]}`); // return value, last
  for (const extra of resultLines.slice(1)) lines.push(`${inner}    ${extra}`);
}

/** Render the whole run as a tree rooted at the coordinator (itself a "tool"). */
function renderTree(roots: CallNode[], input: string, answer: string): string[] {
  const root: CallNode = {
    id: "__coordinator__",
    caller: "user",
    tool: "coordinator",
    input,
    result: answer,
    children: roots,
  };
  const lines: string[] = [];
  renderNode(root, 0, lines);
  return lines;
}

// --- run ---------------------------------------------------------------------

/**
 * Run the coordinator over a request. Returns the final answer plus the
 * delegation as a call tree: every tool nested under its caller (a Task's
 * specialist calls nest under it), each input on its own line, and the return
 * value on a final `--> ` line.
 */
export async function coordinate(expression: string): Promise<CoordinatorResult> {
  const nodes = new Map<string, CallNode>();
  const roots: CallNode[] = [];
  let raw = "";
  let error: string | undefined;

  const options: Options = {
    model,
    systemPrompt: coordinatorSystemPrompt(),
    mcpServers: mcpServers(),
    agents: specialistAgents(),
    // The coordinator may only spawn specialists; canUseTool denies it any
    // direct tool call. Specialists (agentID set) run their tools normally.
    canUseTool,
    permissionMode: "default",
    maxTurns: 20,
  };

  try {
    for await (const message of query({ prompt: expression, options })) {
      if (message.type === "assistant") {
        const blocks = message.message.content;
        if (!Array.isArray(blocks)) continue;
        const caller = message.subagent_type ?? "coordinator";
        const parentId = message.parent_tool_use_id;
        for (const block of blocks) {
          if (!isToolUseBlock(block)) continue;
          const node: CallNode = {
            id: block.id,
            caller,
            tool: block.name,
            input: block.input,
            result: null,
            children: [],
          };
          nodes.set(node.id, node);
          // Nest under the call that spawned this turn (a Task), else it's a root.
          const parent = parentId ? nodes.get(parentId) : undefined;
          if (parent) parent.children.push(node);
          else roots.push(node);
        }
      } else if (message.type === "user") {
        const blocks = (message as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (typeof block !== "object" || block === null) continue;
            const b = block as { type?: unknown; tool_use_id?: unknown };
            if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
              const node = nodes.get(b.tool_use_id);
              if (node) node.result = toolResultText(block);
            }
          }
        }
      } else if (message.type === "result") {
        if (message.subtype === "success") {
          raw = message.result;
        } else {
          error =
            `run ended: ${message.subtype}` +
            ("errors" in message && message.errors?.length ? ` (${message.errors.join("; ")})` : "");
        }
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return { raw, value: extractBoolean(raw), trace: renderTree(roots, expression, raw), error };
}
