import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import {
  coordinatorSystemPrompt,
  mcpServers,
  specialistAgents,
  toolName,
} from "./agents.js";
import { OPERATORS } from "./parser.js";
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
    // The coordinator may only delegate; specialists own the comparator tools.
    allowedTools: ["Task", ...OPERATORS.map((op) => toolName(op.canonical))],
    permissionMode: "bypassPermissions",
    maxTurns: 10,
  };

  try {
    for await (const message of query({ prompt: expression, options })) {
      if (message.type === "assistant") {
        const blocks = message.message.content;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (!isToolUseBlock(block)) continue;
            const where = message.subagent_type
              ? `[${message.subagent_type}]`
              : "[coordinator]";
            trace.push(`${where} -> ${block.name}(${JSON.stringify(block.input)})`);
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
