import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { serverBinary } from "./config.js";
import { toolName } from "./agents.js";

/**
 * A tiny newline-delimited JSON-RPC 2.0 client for the Go comparator server.
 * It exists so the REPL's `:direct` command can exercise the Go MCP server
 * end-to-end without spending any model tokens — handy for verifying the
 * server in isolation.
 */

interface JsonRpcResponse {
  id?: number | string;
  result?: { content?: Array<{ type: string; text?: string }>; structuredContent?: { result?: boolean }; isError?: boolean };
  error?: { code: number; message: string };
}

function send(child: ChildProcessWithoutNullStreams, msg: unknown): void {
  child.stdin.write(JSON.stringify(msg) + "\n");
}

/**
 * Spawn the server, perform the MCP handshake, call one comparator tool, and
 * shut the server down. Resolves to the boolean result.
 */
export function directEvaluate(operator: string, lhs: number, rhs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(serverBinary, [], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      reject(new Error(`failed to launch server at ${serverBinary}: ${String(err)}`));
      return;
    }

    let stderr = "";
    let buffer = "";
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(message));
    };
    const succeed = (value: boolean) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(value);
    };

    child.on("error", (err) =>
      fail(`failed to launch server at ${serverBinary}: ${err.message}`),
    );
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (!settled) {
        fail(`server exited (code ${code ?? "?"})${stderr ? `: ${stderr.trim()}` : ""}`);
      }
    });

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line) as JsonRpcResponse;
        } catch {
          continue; // ignore anything that isn't a JSON-RPC message
        }

        if (msg.id === 1) {
          // initialize acknowledged -> announce initialized, then call the tool.
          send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
          send(child, {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: operator, arguments: { lhs, rhs } },
          });
        } else if (msg.id === 2) {
          if (msg.error) {
            fail(`server error: ${msg.error.message}`);
            return;
          }
          const result = msg.result;
          if (result?.isError) {
            const text = result.content?.find((c) => c.type === "text")?.text ?? "tool error";
            fail(text);
            return;
          }
          if (typeof result?.structuredContent?.result === "boolean") {
            succeed(result.structuredContent.result);
            return;
          }
          const text = result?.content?.find((c) => c.type === "text")?.text;
          if (text === "true" || text === "false") {
            succeed(text === "true");
            return;
          }
          fail(`unexpected tool result: ${line}`);
        }
      }
    });

    // Kick off the handshake.
    send(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "lips-repl-direct", version: "0.1.0" },
      },
    });
  });
}

// Re-exported for symmetry / discoverability; the direct client addresses tools
// by canonical name, but this documents the mcp__ name the agents use.
export { toolName };
