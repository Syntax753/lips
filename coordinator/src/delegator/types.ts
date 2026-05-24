/**
 * Parameter classification. Every glyph the coordinator handles — and every
 * response a delegator returns — carries one of these tags, so the coordinator
 * can decide what to do with it next (and process independent parts in
 * parallel).
 *
 *   USR  the raw original input.
 *   RDR  requires reducing into comparable truths (e.g. an equation). A list of
 *        these is what an evaluator (preflight) is given to check solvability.
 *   CMP  a comparable: two operands plus the comparator to apply. Produced by
 *        reducers, consumed by comparators, which return true/false.
 */
export type ParamType = "USR" | "RDR" | "CMP";

export type Usr = { type: "USR"; text: string };
export type Rdr = { type: "RDR"; form: string };
export type Cmp = { type: "CMP"; lhs: string; rhs: string; comparator: string };

export type Parameter = Usr | Rdr | Cmp;

export const usr = (text: string): Usr => ({ type: "USR", text });
export const rdr = (form: string): Rdr => ({ type: "RDR", form });
export const cmp = (lhs: string, rhs: string, comparator: string): Cmp => ({
  type: "CMP",
  lhs,
  rhs,
  comparator,
});
