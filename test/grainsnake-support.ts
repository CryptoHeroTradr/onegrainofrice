/**
 * GRAINSNAKE test support — instruments, not rules.
 *
 * Nothing here may encode a rule the engine also encodes: a helper that re-implements
 * the step function tests the helper. These are ways of DRIVING the engine (a bot, a
 * board builder, a frame-rate harness) and of INSPECTING it, and every one of them
 * calls the real `stepMut`.
 */

import {
  CELL_COUNT,
  COLS,
  ROWS,
  START_LENGTH,
  ticksPerStepFor,
} from "@/lib/grainsnake/rules";
import {
  cloneState,
  createGame,
  neighbour,
  segmentAt,
  stepMut,
  tailCell,
} from "@/lib/grainsnake/engine";
import { DOWN, LEFT, RIGHT, UP, opposite, type Dir, type GameState } from "@/lib/grainsnake/types";

export const DIRS: Dir[] = [UP, LEFT, DOWN, RIGHT];

/** The head cell. */
export function head(state: GameState): number {
  return segmentAt(state, 0);
}

/** Every cell the trail occupies, head first. */
export function bodyCells(state: GameState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.length; i++) out.push(segmentAt(state, i));
  return out;
}

/**
 * Is stepping `d` immediately fatal? Mirrors the engine's collision test — including
 * the vacating-tail exemption — WITHOUT re-deriving it: it asks the engine for the
 * tail and applies the one documented exception.
 */
export function isFatal(state: GameState, d: Dir): boolean {
  const next = neighbour(head(state), d);
  if (next < 0) return true;
  if (!state.occupied[next]) return false;
  // The tail vacates on a non-growing step, so moving into it is legal.
  const grows = next === state.grain || next === state.golden;
  return !(next === tailCell(state) && !grows);
}

/**
 * Reachable free cells from `from`, counting the head's own cell as blocked.
 * A flood fill, used only to keep the test bot alive — no rule reads it.
 */
function reachable(state: GameState, from: number): number {
  if (from < 0 || state.occupied[from]) return 0;
  const seen = new Uint8Array(CELL_COUNT);
  const stack = [from];
  seen[from] = 1;
  let n = 0;
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    n++;
    for (const d of DIRS) {
      const nb = neighbour(cell, d);
      if (nb < 0 || seen[nb] || state.occupied[nb]) continue;
      seen[nb] = 1;
      stack.push(nb);
    }
  }
  return n;
}

/**
 * A survival-first direction: legal, not a reversal, and preferring the move that
 * leaves the most open space. Deliberately NOT a good player — it is the cheapest
 * thing that keeps a snake alive long enough for a growth assertion to reach tier 7.
 *
 * Ties break by the fixed `DIRS` order, so the bot is deterministic.
 */
export function safeDir(state: GameState, avoid: number = -1): Dir | null {
  let best: Dir | null = null;
  let bestSpace = -1;
  for (const d of DIRS) {
    if (d === opposite(state.dir)) continue;
    if (isFatal(state, d)) continue;
    // `avoid` keeps the bot off a specific cell. The golden-grain tests need it:
    // the bot is otherwise perfectly happy to walk onto the grain whose EXPIRY is
    // being measured, which ends the measurement by eating the instrument.
    if (avoid >= 0 && neighbour(head(state), d) === avoid) continue;
    const space = reachable(state, neighbour(head(state), d));
    if (space > bestSpace) {
      bestSpace = space;
      best = d;
    }
  }
  return best;
}

/**
 * Run ticks until the head moves to a new cell (one step) or the run ends.
 * Returns the ticks consumed, so a caller can assert on the tier's interval.
 */
export function stepOneCell(state: GameState, input: Dir | null = null): number {
  const before = head(state);
  let ticks = 0;
  let first = input;
  // A step can never take more than the slowest tier's interval plus one.
  const guard = 64;
  while (!state.dead && !state.filled && ticks < guard) {
    stepMut(state, first);
    first = null;
    ticks++;
    if (head(state) !== before) return ticks;
  }
  return ticks;
}

/**
 * Feed the snake `n` items by placing the grain directly in the path the survival
 * bot chooses, one per step.
 *
 * The point is to test the GROWTH rule, not a bot's competence: placing food where
 * the snake is already going makes the eat deterministic and lets the assertion run
 * all the way into tier 7 without depending on pathfinding quality. It uses the real
 * eat path — the engine still spawns the replacement grain itself.
 */
export function feed(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    if (state.dead || state.filled) return;
    const d = safeDir(state);
    if (d === null) return;
    // Put the grain exactly where the snake is about to go.
    state.grain = neighbour(head(state), d);
    stepOneCell(state, d === state.dir ? null : d);
  }
}

/**
 * A boustrophedon (serpentine) ordering of every cell: row 0 left→right, row 1
 * right→left, and so on. Consecutive entries are always adjacent, so ANY prefix of
 * it is a valid snake — which is what makes it the right way to build a nearly-full
 * board without hand-writing a 528-cell path.
 */
export function serpentine(): number[] {
  const order: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let i = 0; i < COLS; i++) {
      const c = r % 2 === 0 ? i : COLS - 1 - i;
      order.push(r * COLS + c);
    }
  }
  return order;
}

/**
 * A state whose snake occupies the first `length` cells of the serpentine, leaving
 * exactly `CELL_COUNT - length` free — the head is at the far end, adjacent to the
 * first free cell.
 *
 * Built by writing the ring directly rather than by playing, because playing into a
 * 528-length snake is the thing being set up, not the thing being tested.
 */
export function nearlyFullState(length: number, seed = 12345): GameState {
  const state = cloneState(createGame(seed));
  const order = serpentine();
  state.occupied.fill(0);
  for (let i = 0; i < length; i++) {
    // Ring order is tail → head, so the serpentine index IS the ring index here.
    state.cells[i] = order[i];
    state.occupied[order[i]] = 1;
  }
  state.headPos = length - 1;
  state.length = length;
  state.foodEaten = length - START_LENGTH;
  state.grain = -1;
  state.golden = -1;
  state.started = true;
  state.ticksToNextStep = ticksPerStepFor(state.foodEaten);
  // Heading is whatever the last serpentine move was.
  const prev = order[length - 2];
  const cur = order[length - 1];
  state.dir = dirBetween(prev, cur);
  return state;
}

/** The direction that moves `from` to `to`. Both must be adjacent. */
export function dirBetween(from: number, to: number): Dir {
  for (const d of DIRS) if (neighbour(from, d) === to) return d;
  throw new Error(`cells ${from} and ${to} are not adjacent`);
}

/**
 * Drive the engine through the real accumulator at a given frame interval, until
 * `targetTicks` ticks have elapsed since the run started.
 *
 * THIS IS THE HARNESS THE DETERMINISM SUITE TURNS ON. It converts frame durations
 * into ticks the way the host must — by accumulating time — so a frame-counting
 * implementation would produce a different tick total per frame rate and fail.
 */
export function driveAccumulated(
  seed: number,
  inputsByTick: Map<number, Dir>,
  targetTicks: number,
  frameMs: number,
  drain: (acc: number, ms: number) => { ticks: number; accumulator: number },
): GameState {
  const state = createGame(seed);
  let acc = 0;
  let guard = 0;
  while (state.tick < targetTicks && !state.dead && !state.filled && guard < 2_000_000) {
    guard++;
    const d = drain(acc, frameMs);
    acc = d.accumulator;
    for (let i = 0; i < d.ticks; i++) {
      if (state.tick >= targetTicks || state.dead || state.filled) break;
      const at = state.started ? state.tick : 0;
      stepMut(state, inputsByTick.get(at) ?? null);
    }
  }
  return state;
}

/**
 * The CONTROL for the determinism suite: a driver that counts FRAMES instead of
 * accumulating time — one tick per frame, whatever the frame took.
 *
 * This is the single most common way this class of loop ships broken, and a suite
 * that only ever ran at 60 Hz would pass on it. Keeping the broken version here means
 * the determinism assertions are measured against something that genuinely fails.
 */
export function driveFrameCounted(
  seed: number,
  inputsByTick: Map<number, Dir>,
  frames: number,
): GameState {
  const state = createGame(seed);
  for (let f = 0; f < frames; f++) {
    if (state.dead || state.filled) break;
    const at = state.started ? state.tick : 0;
    stepMut(state, inputsByTick.get(at) ?? null);
  }
  return state;
}

export { UP, DOWN, LEFT, RIGHT };
