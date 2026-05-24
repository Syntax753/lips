import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import {
  allowedToolNames,
  coordinatorSystemPrompt,
  mcpServers,
  specialistAgents,
} from "./agents.js";
import { model } from "./config.js";

export interface CoordinatorResult {
  /** The raw final text from the coordinator. */
  raw: string;
  /** Parsed boolean, or null if none could be extracted. */
  value: boolean | null;
  /** Human-readable trace of delegated tool / subagent activity. */
  trace: string[];
  /** Set when the run failed before producing a result. */
  error?: string;
}

// A minimal shape for the assistant message content blocks we care about.
interface ToolUseBlock {
  type: "tool_use";
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

/** The text of an assistant `text` content block (the coordinator's narration). */
function textOf(block: unknown): string | null {
  if (typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text") {
    const t = String((block as { text?: unknown }).text ?? "").trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

/** A readable one-liner for a tool call (Task calls show their subagent + description). */
function describeCall(block: ToolUseBlock): string {
  const input = (block.input ?? {}) as Record<string, unknown>;
  if (block.name === "Task") {
    const sub = input.subagent_type ?? "?";
    const desc = input.description ?? input.prompt ?? "";
    return `Task → ${sub}${desc ? `: ${desc}` : ""}`;
  }
  return `${block.name}(${JSON.stringify(block.input)})`;
}

/** Flattened text of a tool_result block (what the tool returned). */
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
  text = text.trim().replace(/\s*\n\s*/g, " | ");
  return text.length > 0 ? text : null;
}

/**
 * Run the coordinator over a single expression. The coordinator routes to a
 * short-lived comparator specialist (via the Task tool), which calls the Go
 * MCP server and returns the boolean.
 */
export async function coordinate(expression: string): Promise<CoordinatorResult> {
  const trace: string[] = [];
  let raw = "";
  let error: string | undefined;

  const options: Options = {
    model,
    systemPrompt: coordinatorSystemPrompt(),
    mcpServers: mcpServers(),
    agents: specialistAgents(),
    // The coordinator delegates boolean comparisons (Task -> specialists own the
    // comparator tools) and calls the decision / preflight / reduce / solve tools itself.
    allowedTools: allowedToolNames(),
    permissionMode: "bypassPermissions",
    maxTurns: 20,
  };

  try {
    for await (const message of query({ prompt: expression, options })) {
      if (message.type === "assistant") {
        const blocks = message.message.content;
        if (!Array.isArray(blocks)) continue;
        if (!blocks.some(isToolUseBlock)) continue; // text-only message = prose / final answer
        const where = message.subagent_type ? `[${message.subagent_type}]` : "[coordinator]";
        for (const block of blocks) {
          // The narration the model wrote alongside its calls (why it's delegating)...
          const narration = textOf(block);
          if (narration) trace.push(`${where} ${narration}`);
          // ...and the call itself.
          if (isToolUseBlock(block)) trace.push(`${where} → ${describeCall(block)}`);
        }
      } else if (message.type === "user") {
        // Tool results — what each delegated call returned.
        const blocks = (message as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            const result = toolResultText(block);
            if (result) trace.push(`   ← ${result}`);
          }
        }
      } else if (message.type === "result") {
        if (message.subtype === "success") {
          raw = message.result;
        } else {
          error = `run ended: ${message.subtype}` +
            ("errors" in message && message.errors?.length
              ? ` (${message.errors.join("; ")})`
              : "");
        }
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return { raw, value: extractBoolean(raw), trace, error };
}
