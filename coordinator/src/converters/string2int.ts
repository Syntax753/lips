/**
 * Convert a string to an integer — either a digit string ("12") or an English
 * number phrase ("twelve", "three hundred forty two"). Used so word-numbers can
 * be normalised before being fed to numeric tools.
 */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };

export function string2int(input: string): number {
  const trimmed = input.trim();
  if (/^[-+]?\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  const cleaned = trimmed.toLowerCase().replace(/[-,]/g, " ").replace(/\band\b/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new Error(`cannot convert "${input}" to an integer`);

  let result = 0;
  let current = 0;
  let negative = false;
  for (const t of tokens) {
    if (t === "negative" || t === "minus") {
      negative = true;
    } else if (t in UNITS) {
      current += UNITS[t];
    } else if (t in TENS) {
      current += TENS[t];
    } else if (t === "hundred") {
      current = (current || 1) * 100;
    } else if (t in SCALES) {
      result += (current || 1) * SCALES[t];
      current = 0;
    } else {
      throw new Error(`unknown number word "${t}" in "${input}"`);
    }
  }
  const value = result + current;
  return negative ? -value : value;
}
