/**
 * Extract an identifying field from a JSON object and return it as a string,
 * so an object can be reduced to a comparable scalar (default field: "id").
 */
export function json2id(jsonStr: string, field = "id"): string {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    throw new Error(`json2id: "${jsonStr}" is not valid JSON`);
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error("json2id: input must be a JSON object");
  }
  const rec = obj as Record<string, unknown>;
  if (!(field in rec)) {
    throw new Error(`json2id: field "${field}" not found (have: ${Object.keys(rec).join(", ") || "none"})`);
  }
  return String(rec[field]);
}
