/**
 * TETRICE — board sizing.
 *
 * **INTEGER MULTIPLES OF THE CELL SIZE ONLY, FLOOR 15 px.** A fractional cell puts grain
 * centres on half pixels, and a grain is an ellipse a few pixels across: half-pixel
 * centres are how a rice grain turns into a grey smudge at the size this game actually
 * runs at. The canvas is then letterboxed inside whatever space it was given.
 *
 * The floor is 15 because that is the size the Phase 1 gate judged the axis code at, and
 * below it nothing has been measured.
 */

import { COLS, VISIBLE_ROWS } from "../engine/rules";

export const CELL_FLOOR = 15;
/** The NEXT queue renders larger than the well — decided in the spec: the queue is the
 *  harder identification task and it is where a hue-family collision shows first. */
export const QUEUE_SCALE = 1.4;

export interface BoardSize {
  /** Whole CSS pixels. */
  cell: number;
  width: number;
  height: number;
  /** True when the floor bound, not the available space, decided it. */
  atFloor: boolean;
}

/**
 * The largest whole-pixel cell that fits, never below the floor.
 *
 * Both dimensions are considered: a short-and-wide viewport is bound by height, and the
 * common desktop case is bound by height too, which is why two different widths can
 * legitimately resolve to the same cell. That is only a bug when two sizes resolve the
 * same because a flex parent reported the same height for both — see the note in
 * `TetriceScreen`.
 */
export function resolveBoardSize(availWidth: number, availHeight: number): BoardSize {
  const byWidth = Math.floor(availWidth / COLS);
  const byHeight = Math.floor(availHeight / VISIBLE_ROWS);
  const fit = Math.min(byWidth, byHeight);
  const cell = Math.max(CELL_FLOOR, fit);
  return {
    cell,
    width: cell * COLS,
    height: cell * VISIBLE_ROWS,
    atFloor: fit < CELL_FLOOR,
  };
}

/** Queue/hold preview cell, also whole pixels. */
export function previewCell(wellCell: number): number {
  return Math.max(CELL_FLOOR, Math.round(wellCell * QUEUE_SCALE));
}
