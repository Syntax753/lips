import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loader for the vendored Microban collection (155 puzzles by David W. Skinner,
 * public domain — see the header in microban.txt). The puzzles are roughly
 * ordered easy → hard, which makes them a difficulty-graded harness for the
 * grid solver: how far up the set it solves, and where it falls off.
 *
 * The file is in the standard XSB notation; this converts each board into the
 * lips glyph set and pads ragged rows to a rectangle (the solver requires equal
 * widths, and exterior floor is unreachable so padding it is safe):
 *
 *   XSB   meaning            lips
 *   #     wall               #
 *   @     player             @
 *   +     player on goal     &   (player on a box goal)
 *   $     box                +
 *   *     box on goal        *
 *   .     goal               ~   (box goal)
 *   (sp)  floor / outside    (sp) — parse() maps space -> '.'
 *
 * Read from source via import.meta.url, so it works under tsx (tests/bench run
 * from src/); it is a dev/test fixture, not shipped in dist.
 */

const XSB_TO_LIPS: Record<string, string> = {
  "#": "#",
  "@": "@",
  "+": "&",
  "$": "+",
  "*": "*",
  ".": "~",
  " ": " ",
};

export interface MicrobanLevel {
  /** 1-based number as in the collection. */
  number: number;
  /** The board in lips glyphs, padded to a rectangle. */
  grid: string;
  /** Cell count (rows × cols) — a rough size/difficulty proxy. */
  cells: number;
  /** Number of boxes (== number of goals in a valid level). */
  boxes: number;
}

function convertLine(line: string): string {
  let out = "";
  for (const ch of line) out += XSB_TO_LIPS[ch] ?? ch;
  return out;
}

export function loadMicroban(): MicrobanLevel[] {
  const path = fileURLToPath(new URL("./microban.txt", import.meta.url));
  const text = readFileSync(path, "utf8").replace(/\r/g, "");

  const levels: MicrobanLevel[] = [];
  let block: string[] = [];
  let number = 0;

  const flush = (): void => {
    if (block.length === 0) return;
    const width = Math.max(...block.map((l) => l.length));
    const rows = block.map((l) => convertLine(l.padEnd(width, " ")));
    const grid = rows.join("\n");
    number += 1;
    const boxes = (grid.match(/[+*]/g) ?? []).length;
    levels.push({ number, grid, cells: width * rows.length, boxes });
    block = [];
  };

  // Levels are runs of board lines; ';' comments (titles/header) and blank lines
  // separate them.
  for (const raw of text.split("\n")) {
    if (raw.startsWith(";") || raw.trim() === "") {
      flush();
      continue;
    }
    block.push(raw);
  }
  flush();

  return levels;
}
