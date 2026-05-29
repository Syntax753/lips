import { solve } from "../delegator/solve.js";
import { solveSystem } from "../delegator/algebraic.js";
import { solveTimeline } from "../delegator/timeline.js";
import { classify, type Classification } from "./classify.js";
import { evaluateBoolean, fromBoolean } from "./boolean.js";
import { fromGrid, fromAlgebraic, fromTimeline, type Verdict } from "./contract.js";

/**
 * The deterministic router: classify an input, run the matching solver, and
 * return a uniform Verdict. This is the body of the drop-in MCP `validate` tool
 * and the deterministic core the agentic coordinator delegates leaves to.
 *
 * `unknown` inputs (free natural language) are not guessed at here — the verdict
 * says so, leaving decomposition to the agentic layer.
 */
export interface ValidateResult extends Verdict {
  /** How the input was classified, so callers can see the routing decision. */
  classification: Classification;
}

export function validate(input: string): ValidateResult {
  const classification = classify(input);
  const verdict = run(input, classification);
  return { ...verdict, classification };
}

function run(input: string, c: Classification): Verdict {
  switch (c.kind) {
    case "grid":
      return fromGrid(solve(input));

    case "algebraic": {
      const equations = input
        .split(/[\n;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return fromAlgebraic(solveSystem(equations));
    }

    case "boolean": {
      const b = evaluateBoolean(input);
      if (b) return fromBoolean(b);
      // Should not happen — classify only returns "boolean" when this evaluates.
      return { kind: "boolean", valid: false, witness: null, metrics: {}, reason: "could not evaluate the expression" };
    }

    case "timeline":
      return fromTimeline(solveTimeline(JSON.parse(input)));

    default:
      return { kind: "unknown", valid: false, witness: null, metrics: {}, reason: c.note };
  }
}
