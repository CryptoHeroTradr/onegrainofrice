/**
 * RICE CHOMP — shared engine types and units.
 *
 * Pure module: no React, no DOM, no node builtins. Imported by the engine, by the
 * client components, and by the vitest suite (which runs `environment: "node"`).
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────────
 * Every quantity here is an INTEGER, and the simulation only ever advances in whole
 * fixed-size ticks. That is deliberate and load-bearing: scores are submitted with a
 * recorded input trace, and the plan is for the server to eventually re-simulate that
 * trace and compute the score itself (see docs/rice-chomp-plan.md, anti-cheat option
 * (c)). Replay only works if the same inputs at the same tick numbers produce bit-
 * identical results on a phone, a laptop and a Node process on the VPS.
 *
 * So the engine must NEVER:
 *   - scale movement by a real-time delta (that is what the tick accumulator is for),
 *   - use Math.random() (a seeded integer PRNG goes here when pests land),
 *   - use Date.now() or performance.now() inside the simulation,
 *   - accumulate positions in floating point.
 *
 * Floats are fine in the RENDER layer, which is free to interpolate and is never
 * replayed.
 */

// --- geometry ---------------------------------------------------------------

/** Sub-tile resolution. A tile is SUB×SUB subunits; positions are integers. */
export const SUB = 120;

/** Simulation rate. Wall-clock time is converted to whole ticks by the canvas host. */
export const TICK_HZ = 60;

/**
 * Speeds are expressed as subunits-per-tick × SPEED_SCALE, so a speed can be a
 * fraction of a subunit per tick without ever storing a float. Each tick adds the
 * speed to an integer accumulator and moves by the whole part.
 *
 * Why bother now, in a phase with one constant speed? Because the level curve in a
 * later phase needs "80% of base", and changing the movement representation after
 * traces exist would invalidate every stored trace.
 */
export const SPEED_SCALE = 256;

/** Convert tiles-per-second into the internal speed unit. Exact for the values used. */
export function tilesPerSecond(tps: number): number {
  return Math.round((tps * SUB * SPEED_SCALE) / TICK_HZ);
}

// --- directions -------------------------------------------------------------
// Numeric so an input trace is compact and comparable. Order matters: OPPOSITE
// flips a direction with `^ 2`, and the junction tiebreak in a later phase relies
// on this being the genre-standard up/left/down/right preference order.

export const UP = 0;
export const LEFT = 1;
export const DOWN = 2;
export const RIGHT = 3;
export const NONE = -1;

export type Dir = typeof UP | typeof LEFT | typeof DOWN | typeof RIGHT;
export type DirOrNone = Dir | typeof NONE;

/** Column/row deltas, indexed by Dir. */
export const DX: readonly number[] = [0, -1, 0, 1];
export const DY: readonly number[] = [-1, 0, 1, 0];

/** The reverse of a direction. UP↔DOWN, LEFT↔RIGHT. */
export function opposite(d: Dir): Dir {
  return ((d ^ 2) as Dir);
}

/** True when `d` is vertical (UP or DOWN). */
export function isVertical(d: Dir): boolean {
  return d === UP || d === DOWN;
}

// --- tiles ------------------------------------------------------------------

export const WALL = 0;
export const EMPTY = 1;
export const GRAIN = 2;
export const POWER = 3;
/** The pen gate. Pests may pass; the player may not. */
export const GATE = 4;

export type Tile = typeof WALL | typeof EMPTY | typeof GRAIN | typeof POWER | typeof GATE;
