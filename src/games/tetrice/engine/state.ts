/**
 * TETRICE — the game state, and the shape of it.
 *
 * **EVERY FIELD IS AN INTEGER OR A SMALL ENUM. THERE ARE NO FLOATS IN HERE.** That is the
 * constraint the replay verifier rests on (spec: *Hard constraints*): an integer-only
 * state is one a Node process can reproduce exactly, and a float one is not. The render
 * layer may interpolate between two of these; it may never store anything back.
 *
 * No DOM, no React, no browser globals.
 */

import {
  COLS,
  QUEUE_LOOKAHEAD,
  ROWS,
  SHAPES,
  SPAWN_Y,
  cellsOf,
  spawnX,
  ENGINE_VERSION,
  type Rotation,
  type Shape,
} from "./rules";
import { nextBag, seedRng, type RngState } from "./rng";

export interface ActivePiece {
  readonly shape: Shape;
  readonly rot: Rotation;
  /** Box origin, in cells. The piece's cells are `cellsOf(shape, rot)` offset by this. */
  readonly x: number;
  readonly y: number;
  /**
   * Identifies this piece for the whole of its life, including after it locks. The
   * renderer keys its grain jitter on `(pieceInstanceId, cellIndex)`, so this must not
   * change when the piece moves, rotates, or is held and brought back.
   */
  readonly id: number;
}

export interface GameState {
  /** Stamped on every state so a stored run says which engine produced it. */
  readonly engineVersion: number;
  /** The seed as issued. Kept beside the live RNG state so a replay can restart. */
  readonly seed: number;
  readonly rng: RngState;
  /** What is left of the current bag, dealt from the front. */
  readonly bag: readonly Shape[];
  /** The next pieces, at least QUEUE_LOOKAHEAD deep. */
  readonly queue: readonly Shape[];

  /** COLS × ROWS, row-major. 0 is empty; otherwise `SHAPES.indexOf(shape) + 1`. */
  readonly well: Uint8Array;
  /** Parallel to `well`: the piece instance that filled the cell, 0 when empty. */
  readonly wellPiece: Int32Array;
  /** Parallel to `well`: the cell's index WITHIN its piece, for the jitter key. */
  readonly wellCellIndex: Uint8Array;

  readonly active: ActivePiece | null;
  readonly hold: Shape | null;
  /** One swap per lock. Set on hold, cleared when a piece locks. */
  readonly holdUsed: boolean;

  /** Frames accumulated toward the next row of gravity. */
  readonly gravityCounter: number;
  /** Frames the piece has been resting. -1 when it is not resting. */
  readonly lockTimer: number;
  /** Resets spent on THIS piece. Cleared only on spawn. */
  readonly lockResets: number;

  readonly score: number;
  readonly lines: number;
  readonly level: number;
  /** Ticks simulated. The run's duration is derived from this, never from a clock. */
  readonly ticks: number;
  readonly over: boolean;

  /** Monotonic, so every piece instance id is distinct within a run. */
  readonly pieceCounter: number;
}

export const EMPTY = 0;

export function cellCode(shape: Shape): number {
  return SHAPES.indexOf(shape) + 1;
}

export function idx(x: number, y: number): number {
  return y * COLS + x;
}

/** True if any cell of the piece is off the matrix or on an occupied cell. */
export function collides(
  well: Uint8Array,
  shape: Shape,
  rot: number,
  x: number,
  y: number,
): boolean {
  for (const [cx, cy] of cellsOf(shape, rot)) {
    const px = x + cx;
    const py = y + cy;
    if (px < 0 || px >= COLS || py < 0 || py >= ROWS) return true;
    if (well[idx(px, py)] !== EMPTY) return true;
  }
  return false;
}

/** Pull one shape, refilling the bag when it runs dry. */
export function drawShape(
  rng: RngState,
  bag: readonly Shape[],
): { rng: RngState; bag: Shape[]; shape: Shape } {
  let state = rng;
  let pool = [...bag];
  if (pool.length === 0) {
    const rolled = nextBag(state);
    state = rolled.state;
    pool = rolled.bag;
  }
  const shape = pool[0];
  return { rng: state, bag: pool.slice(1), shape };
}

/** Top the queue back up to the lookahead depth. */
export function refillQueue(
  rng: RngState,
  bag: readonly Shape[],
  queue: readonly Shape[],
): { rng: RngState; bag: Shape[]; queue: Shape[] } {
  let state = rng;
  let pool = [...bag];
  const out = [...queue];
  while (out.length < QUEUE_LOOKAHEAD) {
    const drawn = drawShape(state, pool);
    state = drawn.rng;
    pool = drawn.bag;
    out.push(drawn.shape);
  }
  return { rng: state, bag: pool, queue: out };
}

/**
 * A fresh run on `seed`, with the first piece already spawned so the state is playable at
 * tick 0. The seed comes from the server; the engine neither picks one nor validates it.
 */
export function createInitialState(seed: number): GameState {
  let rng = seedRng(seed);
  const filled = refillQueue(rng, [], []);
  rng = filled.rng;

  const first = filled.queue[0];
  const queue = filled.queue.slice(1);
  const topped = refillQueue(rng, filled.bag, queue);

  return {
    engineVersion: ENGINE_VERSION,
    seed: seed >>> 0,
    rng: topped.rng,
    bag: topped.bag,
    queue: topped.queue,
    well: new Uint8Array(COLS * ROWS),
    wellPiece: new Int32Array(COLS * ROWS),
    wellCellIndex: new Uint8Array(COLS * ROWS),
    active: {
      shape: first,
      rot: 0,
      x: spawnX(first),
      y: SPAWN_Y,
      id: 1,
    },
    hold: null,
    holdUsed: false,
    gravityCounter: 0,
    lockTimer: -1,
    lockResets: 0,
    score: 0,
    lines: 0,
    level: 1,
    ticks: 0,
    over: false,
    pieceCounter: 1,
  };
}

/**
 * A canonical, order-stable string for the whole state.
 *
 * This is what "byte-identical" means for a determinism test, and it is also what a
 * replay comparison reduces to. Typed arrays are written out as plain numbers, so two
 * states that differ anywhere differ here.
 */
export function serialize(state: GameState): string {
  return JSON.stringify({
    engineVersion: state.engineVersion,
    seed: state.seed,
    rng: state.rng,
    bag: state.bag,
    queue: state.queue,
    well: Array.from(state.well),
    wellPiece: Array.from(state.wellPiece),
    wellCellIndex: Array.from(state.wellCellIndex),
    active: state.active,
    hold: state.hold,
    holdUsed: state.holdUsed,
    gravityCounter: state.gravityCounter,
    lockTimer: state.lockTimer,
    lockResets: state.lockResets,
    score: state.score,
    lines: state.lines,
    level: state.level,
    ticks: state.ticks,
    over: state.over,
    pieceCounter: state.pieceCounter,
  });
}
