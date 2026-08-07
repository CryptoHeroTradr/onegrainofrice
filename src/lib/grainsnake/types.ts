/**
 * GRAINSNAKE — simulation state, input, and the shapes that cross the wire.
 *
 * PURE AND ISOMORPHIC. No React, no DOM, no `window`, no `Date`, no `performance`,
 * no node builtins, and no imports at all beyond `./rules`. A client component
 * pulling this in must not drag a database driver behind it, and a route handler
 * pulling it in must not drag a canvas.
 *
 * ── EVERY QUANTITY THE RULES READ IS AN INTEGER ─────────────────────────────────
 * Cells, not subunits (spec, *The one hard constraint this game adds*). The snake
 * occupies whole cells and turns only on a cell boundary, so a sub-cell position
 * would be a quantity the rules never read — and every representable-but-unread
 * state is somewhere a replay can diverge for free. The renderer interpolates
 * between cells using a float it owns; that float is never in here.
 *
 * A cell is a single integer index, `row * COLS + col`. One number rather than a
 * pair, because it is a ring-buffer entry, an occupancy index and a food identity
 * all at once, and three representations of one position is two chances to disagree.
 */

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

/**
 * Numeric so an input trace is compact and comparable, and in the same order RICE
 * CHOMP uses (`src/components/chomp/engine/types.ts`) so the two engines cannot mean
 * different things by `1`. The order is load-bearing: `d ^ 2` flips a direction, and
 * a reversal check is the single most-used rule in this game.
 */
export const UP = 0;
export const LEFT = 1;
export const DOWN = 2;
export const RIGHT = 3;

export type Dir = typeof UP | typeof LEFT | typeof DOWN | typeof RIGHT;

/** Column delta, indexed by Dir. */
export const DX: readonly number[] = [0, -1, 0, 1];
/** Row delta, indexed by Dir. */
export const DY: readonly number[] = [-1, 0, 1, 0];

/** The reverse of a direction. UP↔DOWN, LEFT↔RIGHT. */
export function opposite(d: Dir): Dir {
  return (d ^ 2) as Dir;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * The whole simulation. Everything here is an integer or a fixed-shape integer array.
 *
 * NOTHING IN HERE IS A CLOCK. There is no timestamp, no elapsed-ms, no started-at.
 * Duration is derived from `tick` at the boundary (`ticks * 1000 / 60`) and is never
 * stored, never accepted from a client, and never read by a rule. See the spec's
 * *Anti-cheat*: the host's accumulator clamp drops time the replayer cannot see, so
 * any time-derived quantity in here would be a client/server divergence by
 * construction.
 */
export interface GameState {
  // --- the snake, as a ring buffer -----------------------------------------
  /**
   * Cell indices, `CELL_COUNT` long, used as a ring. `cells[headPos]` is the head;
   * segment `i` back from the head is `cells[(headPos - i + CELL_COUNT) % CELL_COUNT]`.
   *
   * A ring rather than an array that shifts: the acceptance criteria forbid a
   * 500-segment `unshift`/`pop` every 67 ms, which is the one place this game could
   * plausibly allocate in its hot loop.
   */
  cells: Int32Array;
  /** Index into `cells` of the current head. */
  headPos: number;
  /** Segments occupied, head included. Also how far back the ring is valid. */
  length: number;
  /**
   * 1 where a body segment sits, 0 elsewhere, indexed by cell. Redundant with
   * `cells` and kept in lockstep with it, so a collision test is O(1) instead of a
   * walk down the trail — which at length 500, 15 times a second, is the difference
   * between a game and a slideshow.
   */
  occupied: Uint8Array;

  // --- heading --------------------------------------------------------------
  /** The direction the snake is committed to and will move in on the next step. */
  dir: Dir;
  /**
   * Buffered turns, front first, at most `TURN_QUEUE_DEPTH`. Engine state, not host
   * state — it is drained one accepted entry per step and each entry is validated
   * against the direction at the moment it is DRAINED, not when it was entered.
   */
  queue: Dir[];

  // --- clockwork ------------------------------------------------------------
  /**
   * Ticks elapsed. Starts counting at the first accepted input, so tick 0 of a trace
   * is meaningful rather than an arbitrary amount of a player reading the screen.
   */
  tick: number;
  /** Ticks remaining before the next step. Counts down; reset from the tier on each step. */
  ticksToNextStep: number;
  /** False until the first accepted input. Nothing moves and no tick elapses before it. */
  started: boolean;

  // --- food -----------------------------------------------------------------
  /** Cell of the ordinary grain. Always present while the board has a free cell. */
  grain: number;
  /** Cell of the golden grain, or -1 when there is none. */
  golden: number;
  /** Steps of travel left before the golden grain expires. Meaningless when golden is -1. */
  goldenSteps: number;

  // --- counters -------------------------------------------------------------
  /** Total food eaten, ordinary + golden. Exactly `length - START_LENGTH`. */
  foodEaten: number;
  /** Ordinary grains eaten. Drives the golden-grain counter. */
  ordinaryEaten: number;
  /** Golden grains taken. The board's second axis — see the spec's *Scoring*. */
  goldensTaken: number;
  /** The score. */
  score: number;

  // --- terminal conditions --------------------------------------------------
  /** True once the run has ended by collision. One life, no continues. */
  dead: boolean;
  /** True once every cell is body. The win state, and the highest score by construction. */
  filled: boolean;

  // --- randomness -----------------------------------------------------------
  /**
   * The xorshift32 state. IN the state, not beside it: the food sequence is part of
   * what a replay must reproduce, so a PRNG living in a module variable would be a
   * hidden input and the replayer would diverge the first time two runs interleaved.
   */
  rng: number;
  /** The seed this run was created with, carried so a submission can be replayed. */
  seed: number;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * One steering input, stamped with the tick it was applied on.
 *
 * THE TICK INDEX IS THE ONLY TEMPORAL FIELD IN THIS FORMAT, and it is an integer
 * count of simulation steps rather than a measure of time. There is no timestamp
 * here and there must never be one.
 */
export interface InputEvent {
  /** The tick this input is applied on. */
  tick: number;
  dir: Dir;
}

/**
 * A complete recorded run: everything the replayer needs and nothing else.
 *
 * `(seed, inputs, tick index)` — the spec's rule, stated as a type. If a field is
 * ever added here that the replayer cannot reconstruct the run from, the format is
 * wrong, not the replayer.
 */
export interface ReplayLog {
  seed: number;
  /** Ascending by tick. Ties are impossible: one input is applied per tick. */
  inputs: InputEvent[];
  /** Ticks the run lasted. The authoritative clock, and the only one. */
  ticks: number;
  /** The rules this run was played under. Refused, never rescored, on mismatch. */
  engineVersion: number;
}

/**
 * What the simulation says a finished run was worth. Computed by the engine on both
 * sides; the SERVER's copy is the one that gets stored.
 */
export interface RunOutcome {
  score: number;
  length: number;
  foodEaten: number;
  goldensTaken: number;
  ticks: number;
  filled: boolean;
  dead: boolean;
}
