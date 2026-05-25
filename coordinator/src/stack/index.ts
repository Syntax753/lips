import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

/**
 * A stateful search frontier: a stack of grid states backed by a visited Set.
 * `push` adds states not seen before (so the same grid is never explored
 * twice — the search is exhaustive and terminates); `pop` returns the top.
 *
 * State lives in the closure created by `stackServer()`, which is built once
 * per coordinator run — so each query gets its own fresh frontier.
 */

export const STACK_SERVER = "stack";
export const STACK_PUSH_TOOL = `mcp__${STACK_SERVER}__push`;
export const STACK_POP_TOOL = `mcp__${STACK_SERVER}__pop`;
export const STACK_RESET_TOOL = `mcp__${STACK_SERVER}__reset`;
export const STACK_TOOLS = [STACK_PUSH_TOOL, STACK_POP_TOOL, STACK_RESET_TOOL];

export function stackServer() {
  const stack: string[] = [];
  const seen = new Set<string>();

  const pushTool = tool(
    "push",
    "Push grid states onto the search frontier. Pass them ordered FARTHEST-first (by score) so the CLOSEST ends up on top and is popped first. States already seen are skipped (a visited Set backs the stack), keeping the search exhaustive and terminating.",
    { items: z.array(z.string()).describe("grid states to push, ordered farthest-first") },
    async (args) => {
      let pushed = 0;
      let skipped = 0;
      for (const g of args.items) {
        if (seen.has(g)) {
          skipped++;
          continue;
        }
        seen.add(g);
        stack.push(g);
        pushed++;
      }
      return {
        content: [{ type: "text", text: `pushed ${pushed}, skipped ${skipped} already-seen, size ${stack.length}` }],
        structuredContent: { pushed, skipped, size: stack.length },
      };
    },
  );

  const popTool = tool(
    "pop",
    "Pop the top grid state off the search frontier (the closest unexplored state). `empty` is true when the frontier is exhausted.",
    {},
    async () => {
      const grid = stack.pop() ?? null;
      return {
        content: [{ type: "text", text: grid === null ? "(empty)" : grid }],
        structuredContent: { grid, empty: grid === null, size: stack.length },
      };
    },
  );

  const resetTool = tool(
    "reset",
    "Clear the frontier and its visited Set — start a fresh search.",
    {},
    async () => {
      stack.length = 0;
      seen.clear();
      return { content: [{ type: "text", text: "frontier reset" }], structuredContent: { size: 0 } };
    },
  );

  return createSdkMcpServer({ name: STACK_SERVER, version: "0.1.0", tools: [pushTool, popTool, resetTool] });
}
