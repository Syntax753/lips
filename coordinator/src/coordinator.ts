import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, Options } from "@anthropic-ai/claude-agent-sdk";
import { coordinatorSystemPrompt, mcpServers, specialistAgents } from "./agents.js";
import { model } from "./config.js";

export interface CoordinatorResult {
  /** The coordinator's final answer text. */
  raw: string;
  /** Parsed boolean when the answer is a bare truth, else null. */
  value: boolean | null;
  /** The delegation as an indented call tree (also streamed live via onTrace). */
  trace: string[];
  /** Set when the run failed before producing a result. */
  error?: string;
}

/**
 * Gate: the coordinator may only call Task; any other tool is allowed only from
 * inside a subagent (options.agentID set). A direct call by the coordinator is
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

// --- formatting (shared by the live trace) -----------------------------------

function isSubagentCall(tool: string): boolean {
  return tool === "Agent" || tool === "Task";
}

function inputEntries(block: ToolUseBlock): [string, unknown][] {
  if (typeof block.input !== "object" || block.input === null) return [];
  const entries = Object.entries(block.input as Record<string, unknown>);
  return isSubagentCall(block.name) ? entries.filter(([k]) => k !== "subagent_type") : entries;
}

function nodeName(block: ToolUseBlock): string {
  if (isSubagentCall(block.name)) {
    const sub = (block.input as { subagent_type?: string } | null)?.subagent_type ?? "?";
    return `${block.name} → ${sub}`;
  }
  return block.name;
}

function formatInputs(block: ToolUseBlock): string {
  if (typeof block.input === "string") return block.input;
  return inputEntries(block)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

function cleanResult(text: string): string {
  return text
    .replace(/<usage>.*?<\/usage>/gs, "")
    .replace(/\s*agentId:\s*\S+\s*\(use SendMessage[^)]*\)/g, "")
    .replace(/\s*\|\s*$/g, "")
    .trim();
}

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

interface EmbeddedTrace {
  ops: { name: string; input: string; output: string }[];
  summary: string;
}

/** If a result carries an internal op-trace (the algebra delegator), surface it. */
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

/** Emit a tool result at `depth`, expanding an embedded op-trace if present. */
function emitResult(depth: number, result: string | null, emit: (line: string) => void): void {
  const inner = "  ".repeat(depth);
  const embedded = embeddedTrace(result);
  if (embedded) {
    for (const op of embedded.ops) {
      emit(`${inner}${op.name} (${op.input})`);
      emit(`${"  ".repeat(depth + 1)}--> ${op.output}`);
    }
    emit(`${inner}--> ${embedded.summary}`);
    return;
  }
  const lines = ((result ? cleanResult(result) : "") || "(no result)").split("\n");
  emit(`${inner}--> ${lines[0]}`);
  for (const extra of lines.slice(1)) emit(`${inner}    ${extra}`);
}

// --- run ---------------------------------------------------------------------

/**
 * Run the coordinator over a request. Tool calls and results are emitted to
 * `onTrace` THE MOMENT they happen (so a caller can flush them live), indented
 * by call depth — coordinator → Agent → tool. The same lines are also collected
 * into the returned `trace`.
 */
export async function coordinate(
  expression: string,
  onTrace?: (line: string) => void,
): Promise<CoordinatorResult> {
  const trace: string[] = [];
  const emit = (line: string) => {
    trace.push(line);
    onTrace?.(line);
  };
  const depthOf = new Map<string, number>();
  let raw = "";
  let error: string | undefined;

  const options: Options = {
    model,
    systemPrompt: coordinatorSystemPrompt(),
    mcpServers: mcpServers(),
    agents: specialistAgents(),
    canUseTool,
    permissionMode: "default",
    maxTurns: 30,
  };

  emit(`coordinator (${expression})`);

  try {
    for await (const message of query({ prompt: expression, options })) {
      if (message.type === "assistant") {
        const blocks = message.message.content;
        if (!Array.isArray(blocks)) continue;
        const parentId = message.parent_tool_use_id;
        const depth = parentId ? (depthOf.get(parentId) ?? 0) + 1 : 1;
        for (const block of blocks) {
          if (!isToolUseBlock(block)) continue;
          depthOf.set(block.id, depth);
          emit(`${"  ".repeat(depth)}${nodeName(block)} (${formatInputs(block)})`);
        }
      } else if (message.type === "user") {
        const blocks = (message as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (typeof block !== "object" || block === null) continue;
            const b = block as { type?: unknown; tool_use_id?: unknown };
            if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
              const depth = (depthOf.get(b.tool_use_id) ?? 0) + 1;
              emitResult(depth, toolResultText(block), emit);
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

  // The coordinator's own final answer (the root call's return).
  const answer = (raw.trim() || "(no answer)").split("\n");
  emit(`  --> ${answer[0]}`);
  for (const extra of answer.slice(1)) emit(`      ${extra}`);

  return { raw, value: extractBoolean(raw), trace, error };
}
