/**
 * TETRICE — every number the simulation reads, in one file.
 *
 * `docs/tetrice-spec.md` is the argument; this is the table. No magic numbers anywhere
 * else in the engine.
 *
 * **ANY CHANGE TO A NUMBER IN THE SIMULATION SECTION IS AN `ENGINE_VERSION` BUMP.** The
 * matrix, the shapes, the kick tables, the gravity table, the lock frames, the reset cap,
 * the line values, the drop values, the lookahead depth, the shuffle. A stored replay is
 * only re-verifiable against the engine it was played on, and the version is how the
 * server knows which that was (spec: *Run lifecycle*).
 *
 * Pure data and pure functions. No DOM, no React, no browser globals — this module is
 * imported by the client AND by the score route, and it must run in Node unchanged.
 */

/** Bumped whenever anything in the simulation section below changes. */
export const ENGINE_VERSION = 1;

// ─── the matrix ──────────────────────────────────────────────────────────────

/** 10 wide × 22 tall; the top 2 rows are the spawn buffer and are never rendered. */
export const COLS = 10;
export const ROWS = 22;
export const BUFFER_ROWS = 2;
/** The visible field is 10 × 20. Rendering only — the simulation uses the full matrix. */
export const VISIBLE_ROWS = ROWS - BUFFER_ROWS;

// ─── the shapes ──────────────────────────────────────────────────────────────

export type Shape = "I" | "J" | "L" | "S" | "Z" | "T" | "O";

/** Canonical order. The bag shuffles this; the well stores index + 1. */
export const SHAPES: readonly Shape[] = ["I", "J", "L", "S", "Z", "T", "O"];

export type Cell = readonly [number, number];

interface ShapeDef {
  /** Bounding box the piece rotates inside. */
  readonly box: number;
  /**
   * The four cells, IN A FIXED ORDER. The order is the cell's identity: rotation
   * transforms coordinates and leaves the index alone, so the renderer's jitter key
   * `(pieceInstanceId, cellIndex)` survives movement and rotation unchanged and can be
   * carried into the locked board cell (spec: *The pieces*).
   */
  readonly cells: readonly Cell[];
  /** O's four rotation states are identical, so it does not rotate at all. */
  readonly rotates: boolean;
}

export const SHAPE_DEF: Readonly<Record<Shape, ShapeDef>> = {
  I: { box: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]], rotates: true },
  J: { box: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]], rotates: true },
  L: { box: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]], rotates: true },
  S: { box: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]], rotates: true },
  Z: { box: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]], rotates: true },
  T: { box: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]], rotates: true },
  O: { box: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]], rotates: false },
};

/**
 * Spawn position, exact because a replayer needs it exact (spec: *The matrix*).
 * Box origin x = 3 for everything except O, whose 2-wide box sits at 4 so it occupies
 * columns 4–5. Origin y = 0 puts every piece's occupied cells inside the buffer rows.
 */
export const SPAWN_Y = 0;
export function spawnX(shape: Shape): number {
  return shape === "O" ? 4 : 3;
}

/** Rotation states: 0 spawn, 1 = R (one CW), 2 = two, 3 = L (one CCW). */
export type Rotation = 0 | 1 | 2 | 3;

/** The cells of `shape` in rotation `rot`, index-stable. O ignores `rot`. */
export function cellsOf(shape: Shape, rot: number): Cell[] {
  const def = SHAPE_DEF[shape];
  const turns = def.rotates ? ((rot % 4) + 4) % 4 : 0;
  return def.cells.map(([x, y]) => {
    let cx = x;
    let cy = y;
    for (let t = 0; t < turns; t++) {
      const nx = def.box - 1 - cy;
      const ny = cx;
      cx = nx;
      cy = ny;
    }
    return [cx, cy] as Cell;
  });
}

// ─── SRS kick tables ─────────────────────────────────────────────────────────

/**
 * The standard Super Rotation System offsets, tried in order; the first that does not
 * collide is taken, and if none is free the rotation does not happen at all.
 *
 * **THESE ARE WRITTEN IN THE PUBLISHED CONVENTION: +y IS UP.** The engine's own y axis
 * points DOWN (gravity's direction), and `kickOffsets()` negates y on the way out. The
 * table is left in the reference orientation deliberately — it is data transcribed from a
 * published specification, and a table that can be diffed against the source it came from
 * is worth more than one pre-converted into our axis and no longer recognisable.
 *
 * Keyed `from → to`, for the four CW and four CCW transitions. There is no 180 rotation:
 * no input produces one.
 */
type KickTable = Readonly<Record<string, readonly Cell[]>>;

export const KICKS_JLSTZ: KickTable = {
  "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

/** The I piece has its own table, and it is not a variation on the one above. */
export const KICKS_I: KickTable = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

/**
 * The offsets for one transition, **converted into engine axes (y down)**.
 * O never rotates, so it never reaches here with anything but the identity.
 */
export function kickOffsets(shape: Shape, from: Rotation, to: Rotation): Cell[] {
  const table = shape === "I" ? KICKS_I : KICKS_JLSTZ;
  const entry = table[`${from}>${to}`];
  if (!entry) return [[0, 0]];
  // `dy === 0 ? 0 : -dy` rather than plain `-dy`: negating zero yields -0, which is equal
  // to 0 everywhere except in a deep-equality check and in JSON, and this engine's whole
  // contract is that two states either serialize identically or they do not.
  return entry.map(([dx, dy]) => [dx, dy === 0 ? 0 : -dy] as Cell);
}

// ─── gravity, lock, level ────────────────────────────────────────────────────

/**
 * Frames per row, level 1..15, then flat at the last entry. Authored in FRAMES because
 * only 60/n is representable at a 60 Hz fixed step; anything authored in seconds is a
 * number the simulation rounds and the replayer disagrees about.
 */
export const GRAVITY_FRAMES: readonly number[] = [
  48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 4, 3, 3, 2,
];

/** The table stops at 15. The LEVEL does not — it keeps climbing as a score multiplier. */
export function gravityFramesForLevel(level: number): number {
  const i = Math.min(Math.max(level, 1), GRAVITY_FRAMES.length) - 1;
  return GRAVITY_FRAMES[i];
}

/** Frames a resting piece waits before it locks. */
export const LOCK_DELAY_FRAMES = 30;
/**
 * How many times a successful move or rotate may restart that timer, per piece.
 * Worst case 30 + 15×30 = 480 frames = 8 s on one piece, at any level.
 */
export const MAX_LOCK_RESETS = 15;

export const LINES_PER_LEVEL = 10;
export function levelForLines(lines: number): number {
  return 1 + Math.floor(lines / LINES_PER_LEVEL);
}

// ─── scoring ─────────────────────────────────────────────────────────────────

/** Indexed by rows cleared: [0, single, double, triple, quad], multiplied by level. */
export const LINE_SCORES: readonly number[] = [0, 100, 300, 500, 800];
export const SOFT_DROP_POINTS = 1;
export const HARD_DROP_POINTS = 2;

// ─── queue ───────────────────────────────────────────────────────────────────

/**
 * NEXT shows 4. This is an ENGINE constant, not a UI one: the generator must run this far
 * ahead of the piece in play, and the replayer has to run it ahead by exactly as much or
 * the bags diverge.
 */
export const QUEUE_LOOKAHEAD = 4;

// ─── PRESENTATION CONSTANTS ──────────────────────────────────────────────────
//
// *Moved here from the throwaway gate renderer in Phase 2, which is what disarms the
// tripwire `test/tetrice-palette.test.ts` was carrying.*
//
// **THE SIMULATION NEVER READS ANYTHING BELOW THIS LINE, AND CHANGING IT IS NOT AN
// `ENGINE_VERSION` BUMP.** A colour cannot change a replay's score. They live in this file
// because it is the one place a per-shape table belongs, and because the palette test
// needs a home for them that outlives the gate page — but the version rule above applies
// to the simulation section only, and a future reader must not infer otherwise from the
// filename.

/** One `@theme` token per shape (spec: *The pieces*). */
export const TOKEN: Readonly<Record<Shape, string>> = {
  I: "--color-porcelain",
  J: "--color-olive-deep",
  L: "--color-khaki",
  S: "--color-bamboo",
  Z: "--color-tuna",
  T: "--color-salmon",
  O: "--color-olive",
};

export type Axis = "horizontal" | "vertical" | "diagNE" | "diagSE";

/**
 * The three-way categorical grain long-axis code, fixed in SCREEN space — it does not
 * rotate with the piece. Assigned so no two shapes in a hue family share one; the Phase 1
 * gate then measured that it is also the only channel separating the three near-identical
 * luminance pairs, which `test/tetrice-palette.test.ts` now enforces.
 */
export const AXIS: Readonly<Record<Shape, Axis>> = {
  I: "horizontal",
  J: "vertical",
  S: "diagNE",
  O: "horizontal",
  L: "diagSE",
  Z: "diagSE",
  T: "vertical",
};

/** Per-grain value variation around the piece's hue. Value only — never a hue shift. */
export const VALUE_SPREAD = 0.14;
