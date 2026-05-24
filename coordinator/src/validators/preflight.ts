import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { equationVariables } from "../algebra/linear.js";

/**
 * Preflight validator: given a set of linear equations, decide whether the
 * system is solvable. It counts equations vs unknowns and checks that every
 * unknown is transitively connected to the others through shared equations.
 * This is a necessary-condition check — the solver still catches dependent or
 * contradictory systems.
 *
 * Like every validator in this family, the headline result is a boolean (`ok`).
 */

export const VALIDATORS_SERVER = "validators";
export const PREFLIGHT_TOOL = `mcp__${VALIDATORS_SERVER}__preflight`;

export type PreflightResult = {
  ok: boolean;
  equationCount: number;
  unknownCount: number;
  unknowns: string[];
  connected: boolean;
  determined: boolean; // equationCount === unknownCount
  reason: string;
};

export function preflight(equations: string[]): PreflightResult {
  const varsPerEq = equations.map(equationVariables);
  const unknownSet = new Set<string>();
  for (const vs of varsPerEq) for (const v of vs) unknownSet.add(v);
  const unknowns = [...unknownSet].sort();
  const equationCount = equations.length;
  const unknownCount = unknowns.length;

  // Union-find: connect all unknowns that co-occur in an equation.
  const parent = new Map<string, string>(unknowns.map((v) => [v, v]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const vs of varsPerEq) for (let i = 1; i < vs.length; i++) union(vs[0], vs[i]);
  const connected = unknownCount <= 1 ? true : new Set(unknowns.map(find)).size === 1;

  const determined = equationCount === unknownCount;
  const ok = unknownCount > 0 && connected && equationCount >= unknownCount;

  const reason = ok
    ? determined
      ? `solvable: ${equationCount} equations, ${unknownCount} unknowns, all connected`
      : `overdetermined but connected: ${equationCount} equations, ${unknownCount} unknowns`
    : unknownCount === 0
      ? "no unknowns found"
      : !connected
        ? "the unknowns are not all connected through shared equations"
        : `underdetermined: ${equationCount} equation(s) for ${unknownCount} unknown(s)`;

  return { ok, equationCount, unknownCount, unknowns, connected, determined, reason };
}

export const preflightTool = tool(
  "preflight",
  "Decide whether a set of LINEAR equations is solvable. Counts equations vs unknowns and checks that all unknowns are transitively connected through shared equations. Returns ok=true/false plus the counts and reason.",
  {
    equations: z
      .array(z.string())
      .describe('the equations, e.g. ["M = 4*T", "M - 10 = 2*(T - 10)"]'),
  },
  async (args) => {
    const result = preflight(args.equations);
    return { content: [{ type: "text", text: String(result.ok) }], structuredContent: result };
  },
);

export function validatorsServer() {
  return createSdkMcpServer({ name: VALIDATORS_SERVER, version: "0.1.0", tools: [preflightTool] });
}
