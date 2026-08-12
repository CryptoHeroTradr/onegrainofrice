/**
 * TETRICE engine test helpers.
 *
 * The engine's state is plain readonly data, so a test builds the exact position it wants
 * to assert about rather than playing its way there. Every helper returns a NEW state —
 * nothing here mutates, for the same reason `step` does not.
 */

import {
  COLS,
  ROWS,
  type Rotation,
  type Shape,
  cellsOf,
} from "@/games/tetrice/engine/rules";
import {
  cellCode,
  createInitialState,
  idx,
  type GameState,
} from "@/games/tetrice/engine/state";
import { step, type Action } from "@/games/tetrice/engine/step";

export const SEED = 0x5eed1;

export function fresh(seed: number = SEED): GameState {
  return createInitialState(seed);
}

/** Put a specific piece in play at a specific place, with fresh lock state. */
export function withActive(
  s: GameState,
  shape: Shape,
  rot: Rotation,
  x: number,
  y: number,
): GameState {
  return {
    ...s,
    active: { shape, rot, x, y, id: s.pieceCounter + 1 },
    pieceCounter: s.pieceCounter + 1,
    gravityCounter: 0,
    lockTimer: -1,
    lockResets: 0,
  };
}

/** Fill specific cells with a shape's code, as though a piece had locked there. */
export function withCells(
  s: GameState,
  cells: ReadonlyArray<readonly [number, number]>,
  shape: Shape = "I",
): GameState {
  const well = new Uint8Array(s.well);
  const wellPiece = new Int32Array(s.wellPiece);
  const wellCellIndex = new Uint8Array(s.wellCellIndex);
  const code = cellCode(shape);
  for (const [x, y] of cells) {
    well[idx(x, y)] = code;
    wellPiece[idx(x, y)] = -1;
  }
  return { ...s, well, wellPiece, wellCellIndex };
}

/** Fill row `y` completely, except the columns in `holes`. */
export function withRow(
  s: GameState,
  y: number,
  holes: readonly number[] = [],
  shape: Shape = "I",
): GameState {
  const cells: Array<readonly [number, number]> = [];
  for (let x = 0; x < COLS; x++) {
    if (!holes.includes(x)) cells.push([x, y]);
  }
  return withCells(s, cells, shape);
}

export function withCounters(
  s: GameState,
  patch: Partial<Pick<GameState, "score" | "lines" | "level">>,
): GameState {
  return { ...s, ...patch };
}

/** Advance `ticks` ticks, feeding `inputs` on every one of them (default: nothing). */
export function advance(
  s: GameState,
  ticks: number,
  inputs: readonly Action[] = [],
): GameState {
  let cur = s;
  for (let i = 0; i < ticks; i++) cur = step(cur, inputs, cur.ticks);
  return cur;
}

/** Advance one tick with a given action set. */
export function tick(s: GameState, inputs: readonly Action[] = []): GameState {
  return step(s, inputs, s.ticks);
}

/** The occupied cells of the active piece, in absolute coordinates. */
export function activeCells(s: GameState): Array<readonly [number, number]> {
  const p = s.active;
  if (!p) return [];
  return cellsOf(p.shape, p.rot).map(([cx, cy]) => [p.x + cx, p.y + cy] as const);
}

/** How many cells of the well are filled. */
export function filledCount(s: GameState): number {
  let n = 0;
  for (let i = 0; i < COLS * ROWS; i++) if (s.well[i] !== 0) n += 1;
  return n;
}

/** A printable well, for a failure message worth reading. */
export function render(s: GameState): string {
  const lines: string[] = [];
  const active = new Set(activeCells(s).map(([x, y]) => `${x},${y}`));
  for (let y = 0; y < ROWS; y++) {
    let row = "";
    for (let x = 0; x < COLS; x++) {
      row += active.has(`${x},${y}`) ? "@" : s.well[idx(x, y)] !== 0 ? "#" : ".";
    }
    lines.push(`${String(y).padStart(2, "0")} ${row}`);
  }
  return lines.join("\n");
}

/**
 * Guard against a vacuous assertion: a test that "passes" because nothing happened.
 * Same shape as grainsnake's `assertRan`.
 */
export function assertRan(before: GameState, after: GameState): void {
  if (after.ticks === before.ticks) {
    throw new Error("assertRan: no ticks were simulated — this test measured nothing");
  }
}
