/**
 * RICE CHOMP — the maze, and every lookup that reads it.
 *
 * Pure module: no React, no DOM, no node builtins. Unit-tested in
 * test/chomp-maze.test.ts.
 *
 * ── BOUNDS ──────────────────────────────────────────────────────────────────────
 * tsconfig has `strict` but NOT `noUncheckedIndexedAccess`, so `grid[i]` is typed
 * `number` even when `i` is off the end and the value is actually `undefined`. Every
 * lookup in this file therefore range-checks by hand before indexing. `tileAt()` is
 * the only way the rest of the engine is allowed to read the maze, so the guard lives
 * in exactly one place.
 */

import { WALL, EMPTY, GRAIN, POWER, GATE, SUB, type Tile } from "./types";

export const COLS = 28;
export const ROWS = 31;

/**
 * The maze. Mirror-symmetric about the vertical axis (col x === col 27-x on every
 * row), one tile wide everywhere, no dead ends, girth 10.
 *
 *   #  wall          .  grain          o  golden grain (power)
 *   (space) open, no grain             =  pen gate
 *
 * Row 14 is the warp tunnel: cols 0-5 and 22-27 are open and grain-free, and the two
 * edges connect to each other. The pen occupies cols 10-17, rows 12-16, with a 6×3
 * interior and a gate at row 12, cols 13-14 that opens UPWARD into the row-11
 * corridor.
 *
 * Reviewed and signed off before implementation; see docs/rice-chomp-plan.md §7 for
 * the loop analysis (22 independent loops, every one with 2+ entrances, so no loop
 * can be kited indefinitely by geometry alone).
 */
export const MAZE: readonly string[] = [
  "############################", //  0
  "#............##............#", //  1
  "#.####.#####.##.#####.####.#", //  2
  "#o####.#####.##.#####.####o#", //  3
  "#.####.#####.##.#####.####.#", //  4
  "#..........................#", //  5
  "#.####.##.########.##.####.#", //  6
  "#.####.##.########.##.####.#", //  7
  "#......##..........##......#", //  8
  "######.##.########.##.######", //  9
  "######.##.########.##.######", // 10
  "######.##.        .##.######", // 11
  "######.##.###==###.##.######", // 12
  "######.##.#      #.##.######", // 13
  "      .##.#      #.##.      ", // 14  <- warp tunnel
  "######.##.#      #.##.######", // 15
  "######.##.########.##.######", // 16
  "######.##.########.##.######", // 17
  "######.##..........##.######", // 18  <- sub-pen loop corridor
  "######.##.########.##.######", // 19
  "#............##............#", // 20
  "#.####.#####.##.#####.####.#", // 21
  "#.####.#####.##.#####.####.#", // 22
  "#o...........##...........o#", // 23
  "####.##.############.##.####", // 24
  "#.......##........##.......#", // 25
  "#.#####.##.######.##.#####.#", // 26
  "#.#####.##.######.##.#####.#", // 27
  "#.#####.##.######.##.#####.#", // 28
  "#..........................#", // 29
  "############################", // 30
];

/** The row the warp tunnel runs along. Only this row wraps horizontally. */
export const TUNNEL_ROW = 14;

/**
 * Where the player starts: row 25, straddling the boundary between cols 13 and 14,
 * facing left. Centring between two tiles is the genre convention and means the
 * first input in either horizontal direction is immediately legal.
 */
export const PLAYER_SPAWN_COL = 14;
export const PLAYER_SPAWN_ROW = 25;

const CHAR_TO_TILE: Record<string, Tile> = {
  "#": WALL,
  " ": EMPTY,
  ".": GRAIN,
  o: POWER,
  "=": GATE,
};

export interface ParsedMaze {
  /** Row-major COLS×ROWS tile codes. Mutated as grains are eaten. */
  grid: Uint8Array;
  /** How many GRAIN + POWER tiles the maze started with. */
  totalGrains: number;
  totalPower: number;
}

/**
 * Parse the string rows into a flat tile grid. Throws on a malformed maze rather than
 * silently producing a half-built board — a typo here is a bug, not a runtime state.
 */
export function parseMaze(rows: readonly string[] = MAZE): ParsedMaze {
  if (rows.length !== ROWS) {
    throw new Error(`[chomp] maze must have ${ROWS} rows, got ${rows.length}`);
  }
  const grid = new Uint8Array(COLS * ROWS);
  let totalGrains = 0;
  let totalPower = 0;

  for (let y = 0; y < ROWS; y++) {
    const row = rows[y];
    if (row.length !== COLS) {
      throw new Error(`[chomp] maze row ${y} must be ${COLS} wide, got ${row.length}`);
    }
    for (let x = 0; x < COLS; x++) {
      const ch = row.charAt(x);
      const tile = CHAR_TO_TILE[ch];
      if (tile === undefined) {
        throw new Error(`[chomp] unknown maze char ${JSON.stringify(ch)} at row ${y}, col ${x}`);
      }
      grid[y * COLS + x] = tile;
      if (tile === GRAIN) totalGrains++;
      else if (tile === POWER) totalPower++;
    }
  }
  return { grid, totalGrains, totalPower };
}

/**
 * Wrap a column into range. Only meaningful on TUNNEL_ROW, but applied everywhere
 * because every other row is walled at cols 0 and 27, so wrapping can never be
 * reached there anyway.
 */
export function wrapCol(col: number): number {
  const m = col % COLS;
  return m < 0 ? m + COLS : m;
}

/**
 * Read a tile. Columns wrap; rows out of range read as WALL, so nothing can ever walk
 * off the top or bottom. This is the ONLY grid read in the engine.
 */
export function tileAt(grid: Uint8Array, col: number, row: number): Tile {
  if (row < 0 || row >= ROWS) return WALL;
  const idx = row * COLS + wrapCol(col);
  // Bounds are now guaranteed by the row check + wrapCol, but the assertion is
  // cheap and keeps this honest if COLS/ROWS ever drift from the grid length.
  if (idx < 0 || idx >= grid.length) return WALL;
  return grid[idx] as Tile;
}

/** Overwrite a tile. Silently ignores out-of-range rows, matching tileAt(). */
export function setTile(grid: Uint8Array, col: number, row: number, tile: Tile): void {
  if (row < 0 || row >= ROWS) return;
  const idx = row * COLS + wrapCol(col);
  if (idx < 0 || idx >= grid.length) return;
  grid[idx] = tile;
}

/** Can the PLAYER occupy this tile? Walls and the pen gate are closed to them. */
export function isOpenForPlayer(grid: Uint8Array, col: number, row: number): boolean {
  const t = tileAt(grid, col, row);
  return t !== WALL && t !== GATE;
}

/** Can a PEST occupy this tile? Same, but the gate is passable. */
export function isOpenForPest(grid: Uint8Array, col: number, row: number): boolean {
  return tileAt(grid, col, row) !== WALL;
}

// --- subunit <-> tile conversion -------------------------------------------

/** Subunit x of the centre of a column (likewise y of a row). */
export function tileCentre(index: number): number {
  return index * SUB + SUB / 2;
}

/** Which tile a subunit coordinate falls in. Floors, so it is exact on boundaries. */
export function tileOf(sub: number): number {
  return Math.floor(sub / SUB);
}

/**
 * Signed distance from the centre of the containing tile, in subunits.
 * 0 exactly at the centre, negative before it, positive after.
 */
export function offsetFromCentre(sub: number): number {
  const t = tileOf(sub);
  return sub - tileCentre(t);
}
