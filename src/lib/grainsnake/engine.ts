/**
 * GRAINSNAKE — the rules. One tick at a time, integers only, no clock.
 *
 * PURE AND ISOMORPHIC. Imports `./rules` and `./types` and nothing else. No React,
 * no DOM, no `window`, no `Date`, no `performance`, no node builtins, no
 * `Math.random`. **This module IS the server-side replayer** (spec, *Anti-cheat*) —
 * the route handler imports this file and runs it without a canvas. There is no
 * second implementation of the rules to drift from, which is the entire reason
 * replay verification is affordable in this game and was not in RICE CHOMP.
 *
 * ── THE TWO ENTRY POINTS ARE ONE IMPLEMENTATION ─────────────────────────────────
 * `step()` is pure: it clones and returns a new state. `stepMut()` mutates in place
 * and is what a 60 fps host loop should call. `step()` is literally
 * `stepMut(cloneState(s), input)` — the rules are written once. Two hand-written
 * copies of a step function agree right up until one of them changes.
 *
 * ── WHAT IS NOT IN HERE ─────────────────────────────────────────────────────────
 * No audio, no rendering, no interpolation. Sound is DERIVED from state transitions
 * by the host, never emitted by the simulation — the replayer has no speakers. The
 * render layer's interpolation fraction is a float the host owns and is not state.
 */

import {
  CELL_COUNT,
  COLS,
  GOLDEN_EVERY,
  GOLDEN_STEPS,
  MAX_INPUT_EVENTS,
  MAX_REPLAY_TICKS,
  ROWS,
  SCORE_GOLDEN,
  SCORE_GRAIN,
  START_CELL,
  START_LENGTH,
  TICK_HZ,
  TURN_QUEUE_DEPTH,
  multiplierFor,
  ticksPerStepFor,
} from "./rules";
import {
  DX,
  DY,
  RIGHT,
  opposite,
  type Dir,
  type GameState,
  type InputEvent,
  type ReplayLog,
  type RunOutcome,
} from "./types";

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/**
 * xorshift32 — the engine's only source of randomness, and it lives in the state.
 * Same generator RICE CHOMP uses, for the same reason: it is exact in 32-bit
 * integers on every platform this runs on, which `Math.random()` is not and could
 * not be made to be.
 *
 * A seed of 0 is the generator's fixed point (it would emit 0 forever), so it is
 * remapped rather than accepted — a run seeded 0 must not be a run with no food.
 */
export function xorshift32(s: number): number {
  let x = s | 0;
  if (x === 0) x = 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x | 0;
}

/**
 * Advance the state's PRNG and return an integer in `[0, n)`.
 *
 * ONE DRAW, ALWAYS — modulo rather than a rejection loop. Rejection sampling would
 * consume a variable number of draws, which desyncs the stream under replay the
 * moment anything upstream changes, and the spec forbids it by name for exactly that
 * reason. The modulo bias across 2^32 into at most 529 buckets is far below anything
 * a player could perceive, and a fixed draw count is worth more here than perfect
 * uniformity.
 */
function drawBelow(state: GameState, n: number): number {
  state.rng = xorshift32(state.rng);
  return (state.rng >>> 0) % n;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Column of a cell. */
export function colOf(cell: number): number {
  return cell % COLS;
}
/** Row of a cell. */
export function rowOf(cell: number): number {
  return (cell - (cell % COLS)) / COLS;
}

/**
 * The cell one step from `cell` in direction `d`, or -1 if that leaves the board.
 *
 * The wall is a BORDER, not a tile: leaving the grid is the collision, and there is
 * nothing inside the field to hit but the snake itself. -1 rather than a wrap,
 * because this game does not wrap and a silent wrap is the bug that would hide it.
 */
export function neighbour(cell: number, d: Dir): number {
  const c = colOf(cell) + DX[d];
  const r = rowOf(cell) + DY[d];
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
  return r * COLS + c;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** The cell of segment `i` counted back from the head (0 = head). */
export function segmentAt(state: GameState, i: number): number {
  const p = (state.headPos - i + CELL_COUNT) % CELL_COUNT;
  return state.cells[p];
}

/** The tail cell — the segment that will vacate on the next non-growing step. */
export function tailCell(state: GameState): number {
  return segmentAt(state, state.length - 1);
}

/**
 * The cell the tail moved OUT of on the last step, or -1 when there isn't one.
 *
 * DERIVED, NOT STORED. The ring is `CELL_COUNT` long and only ever written at
 * `headPos`, so the slot one past the tail still holds the cell the tail occupied a
 * step ago. Reading it costs nothing and — this is the point — adds no field to
 * `GameState`: a `prevTail` member would be representable state that no rule reads,
 * and every one of those is somewhere a replay can diverge for free.
 *
 * It exists for the RENDERER, which needs it to interpolate the tail: at fraction f
 * the tail is between where it was and where it is, and "where it was" is here.
 *
 * Validity is tested rather than tracked. The slot is stale by construction, and on a
 * step where the snake GREW the tail did not move at all, so the entry describes an
 * older move. A vacated cell must be adjacent to the current tail and must not be part
 * of the body; anything else returns -1 and the caller draws a static tail, which in a
 * fused trail is invisible.
 */
export function vacatedCell(state: GameState): number {
  if (state.length >= CELL_COUNT) return -1;
  const p = (state.headPos - state.length + CELL_COUNT) % CELL_COUNT;
  const cell = state.cells[p];
  if (cell < 0 || cell >= CELL_COUNT) return -1;
  if (state.occupied[cell]) return -1;
  const tail = tailCell(state);
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    if (neighbour(tail, d) === cell) return cell;
  }
  return -1;
}

/**
 * A fresh run.
 *
 * The snake starts at the centre cell pointing RIGHT, laid out behind itself so the
 * first step is a move rather than a fold. It does NOT move until the first accepted
 * input, and no tick elapses before then — a run that starts moving while the player
 * is still reading the screen spends its first second punishing them.
 */
export function createGame(seed: number): GameState {
  const cells = new Int32Array(CELL_COUNT);
  const occupied = new Uint8Array(CELL_COUNT);

  // Head at index START_LENGTH-1 so the ring's newest entry is the head and the two
  // cells behind it are the initial body, laid out to the LEFT (behind a RIGHT-facing
  // snake).
  for (let i = 0; i < START_LENGTH; i++) {
    const cell = START_CELL - (START_LENGTH - 1 - i);
    cells[i] = cell;
    occupied[cell] = 1;
  }

  const state: GameState = {
    cells,
    headPos: START_LENGTH - 1,
    length: START_LENGTH,
    occupied,
    dir: RIGHT,
    queue: [],
    tick: 0,
    ticksToNextStep: ticksPerStepFor(0),
    started: false,
    grain: -1,
    golden: -1,
    goldenSteps: 0,
    foodEaten: 0,
    ordinaryEaten: 0,
    goldensTaken: 0,
    score: 0,
    dead: false,
    filled: false,
    rng: xorshift32(seed | 0),
    seed: seed | 0,
  };

  state.grain = spawnFood(state);
  return state;
}

/** A deep copy. Every array is copied; nothing is shared with the original. */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    cells: Int32Array.from(s.cells),
    occupied: Uint8Array.from(s.occupied),
    queue: s.queue.slice(),
  };
}

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------

/**
 * Place a grain on a uniformly-chosen FREE cell, or -1 when the board has none.
 *
 * Builds the free list and draws one index — never rejection-samples over all cells.
 * Rejection sampling is the obvious implementation and is wrong twice (spec, *Food*):
 * it consumes a variable number of draws, and its expected running time goes to
 * infinity as the snake fills the board, which is a hang at precisely the moment a
 * player has earned the right not to be hung. This is O(CELL_COUNT) — 529 — and
 * terminates at one free cell exactly as fast as at five hundred.
 */
export function spawnFood(state: GameState): number {
  const free: number[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    if (state.occupied[cell]) continue;
    if (cell === state.grain) continue;
    if (cell === state.golden) continue;
    free.push(cell);
  }
  if (free.length === 0) return -1;
  return free[drawBelow(state, free.length)];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * The direction the snake is COMMITTED to for the purpose of validating a new input:
 * the last thing it has been told to do, which is the back of the queue when the
 * queue is non-empty and the current heading otherwise.
 *
 * This is what makes a corner double-tap work. Travelling RIGHT with UP queued, a
 * LEFT press is not a reversal — after the UP it is a perfectly ordinary turn — and
 * validating it against the CURRENT heading would reject the second half of every
 * corner a player enters at speed.
 */
function committedDir(state: GameState): Dir {
  return state.queue.length > 0 ? state.queue[state.queue.length - 1] : state.dir;
}

/**
 * Offer a steering input. Returns true if it was accepted into the queue.
 *
 * **A REVERSAL IS DISCARDED, NOT QUEUED.** It cannot be buffered "for later", because
 * by the time later arrives the snake has turned and the reversal is now a legal move
 * the player did not ask for — the single most infuriating bug in this genre, and it
 * is always this.
 *
 * A repeat of the committed direction is dropped too: it is not a turn, and letting
 * it consume one of two queue slots would cost a player the corner they were mid-way
 * through entering.
 */
export function steer(state: GameState, d: Dir): boolean {
  if (state.dead || state.filled) return false;
  const committed = committedDir(state);
  if (d === committed) return false;
  if (d === opposite(committed)) return false;
  if (state.queue.length >= TURN_QUEUE_DEPTH) return false;
  state.queue.push(d);
  return true;
}

/**
 * Is this input LEGAL — i.e. something other than a reversal?
 *
 * Distinct from "was it queued", and the distinction is load-bearing. Pressing the
 * direction you are already travelling in is a legal input that queues nothing: it is
 * not a turn, so it must not spend a queue slot, but it IS the player saying "go".
 *
 * Conflating the two is a real bug with a very quiet failure: the snake starts facing
 * RIGHT, so a player whose first press is RIGHT — the single most natural opening
 * input there is — would find the run never starting at all, with no tick elapsing
 * and nothing on screen to explain why. Caught 2026-08-07 by the determinism suite,
 * which had been comparing two never-started states and passing.
 */
function isLegalInput(state: GameState, d: Dir): boolean {
  return d !== opposite(committedDir(state));
}

/**
 * Take at most ONE turn off the queue, re-validating against the CURRENT heading at
 * the moment of draining rather than the moment of entry.
 *
 * Entries that have become reversals in the meantime are discarded rather than
 * applied — belt and braces over `steer()`'s check, and the spec requires the drain
 * to be the authority. Discarding does not consume the step's turn: the drain
 * continues to the next entry, so a stale entry cannot eat a good one.
 */
function drainTurn(state: GameState): void {
  while (state.queue.length > 0) {
    const d = state.queue.shift() as Dir;
    if (d === state.dir || d === opposite(state.dir)) continue;
    state.dir = d;
    return;
  }
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/**
 * Advance the simulation by exactly one CELL. Called by `stepMut` when the tick
 * countdown reaches zero; never called directly by a host.
 */
function advanceOneCell(state: GameState): void {
  drainTurn(state);

  const next = neighbour(segmentAt(state, 0), state.dir);

  // The border. Leaving the grid is the wall.
  if (next < 0) {
    state.dead = true;
    return;
  }

  const eatsGrain = next === state.grain;
  const eatsGolden = next === state.golden;
  const grows = eatsGrain || eatsGolden;
  const tail = tailCell(state);

  /**
   * THE CLASSIC OFF-BY-ONE, HANDLED EXPLICITLY. The tail cell the tail is about to
   * vacate is not a collision: a snake moving into the square its own tail leaves on
   * the same step survives. Getting this wrong makes tight turns randomly fatal at
   * exactly the lengths where a player is proudest of them.
   *
   * The exemption is void when the snake is growing, because then the tail does not
   * move. (Food never spawns inside the trail, so `grows && next === tail` cannot
   * actually occur — the condition is written out anyway rather than relying on that
   * invariant holding somewhere else in the file.)
   */
  if (state.occupied[next] && !(next === tail && !grows)) {
    state.dead = true;
    return;
  }

  // Vacate the tail BEFORE placing the head, so moving into the vacated cell is a
  // legal write rather than a collision with a stale occupancy bit.
  if (!grows) {
    state.occupied[tail] = 0;
  } else {
    state.length++;
  }

  state.headPos = (state.headPos + 1) % CELL_COUNT;
  state.cells[state.headPos] = next;
  state.occupied[next] = 1;

  // Did the golden grain exist before this step resolved? Decides whether it pays a
  // step of its travel budget below — one spawned by THIS step has not travelled yet.
  const hadGolden = state.golden >= 0 && !eatsGolden;

  if (grows) {
    // The multiplier is the tier the grain was eaten AT — computed before the counter
    // moves. The speed below is the tier the snake is now IN. Both are "keyed on food
    // eaten"; they differ by one item at a boundary and that is the natural reading.
    const mult = multiplierFor(state.foodEaten);
    state.foodEaten++;

    if (eatsGolden) {
      state.score += SCORE_GOLDEN * mult;
      state.goldensTaken++;
      state.golden = -1;
    } else {
      state.score += SCORE_GRAIN * mult;
      state.ordinaryEaten++;
      state.grain = spawnFood(state);
      // The golden grain appears on a COUNTER, not a timer.
      if (state.ordinaryEaten % GOLDEN_EVERY === 0) {
        const cell = spawnFood(state);
        if (cell >= 0) {
          state.golden = cell;
          state.goldenSteps = GOLDEN_STEPS;
        }
      }
    }
  }

  // The win: every cell is body. Checked after growth, before any further spawning
  // matters — a full board has no free cell for `spawnFood` to have found anyway.
  if (state.length >= CELL_COUNT) {
    state.filled = true;
    return;
  }

  // The golden grain's travel budget, in STEPS. Counted down one per step of travel,
  // whether or not it is taken. Never seconds — a replayer has no clock.
  if (hadGolden) {
    state.goldenSteps--;
    if (state.goldenSteps <= 0) {
      state.golden = -1;
      state.goldenSteps = 0;
    }
  }
}

/**
 * Advance ONE TICK, mutating `state`, and return it.
 *
 * `input` is the steering input recorded for this tick, or null. The tick is the
 * simulation's whole clock: there is no elapsed time here, and the host is
 * responsible for converting wall-clock into a count of these (see `drainTicks`).
 */
export function stepMut(state: GameState, input: Dir | null = null): GameState {
  if (state.dead || state.filled) return state;

  if (input !== null) {
    // The run begins on the first LEGAL input, which is not the same as the first
    // QUEUED one — pressing the direction you already face queues nothing and still
    // means "go". Only a reversal is discarded outright, and a discarded reversal is
    // not the player choosing to start; it is a key that does nothing.
    if (isLegalInput(state, input)) state.started = true;
    steer(state, input);
  }

  // Nothing moves and no tick elapses before the first input.
  if (!state.started) return state;

  state.tick++;
  state.ticksToNextStep--;

  if (state.ticksToNextStep <= 0) {
    advanceOneCell(state);
    // Re-read the tier AFTER the step: eating may have moved the snake into a faster
    // one, and the new interval applies from the next step.
    state.ticksToNextStep = ticksPerStepFor(state.foodEaten);
  }

  return state;
}

/**
 * Advance one tick, PURELY — clone in, clone out, `state` untouched.
 *
 * Same rules as `stepMut`, because it *is* `stepMut`. Use this in tests, in the
 * replayer, and anywhere the caller wants a value rather than a mutation; use
 * `stepMut` in the 60 fps host loop, where cloning a 529-entry ring every tick is
 * the allocation the acceptance criteria forbid.
 */
export function step(state: GameState, input: Dir | null = null): GameState {
  return stepMut(cloneState(state), input);
}

// ---------------------------------------------------------------------------
// The host clock — NOT part of the simulation
// ---------------------------------------------------------------------------

/** Milliseconds per simulation tick. Host-side only; no rule ever reads it. */
export const TICK_MS = 1000 / TICK_HZ;

/**
 * Ceiling on ticks a single drain may produce. A tab backgrounded for 40 s returns
 * holding 2,400 ticks of debt; spending it in one frame is a snake that teleports
 * into a wall the player never saw.
 *
 * **THE CLAMP IS ALSO WHY NO TIME-DERIVED FIELD MAY ENTER THE REPLAY FORMAT.** It
 * drops accumulated time that the replayer never learns about, so a client-measured
 * duration and a tick count are not two views of one quantity — they are different
 * quantities, and any run that was ever tabbed away from would disagree.
 */
export const MAX_TICKS_PER_DRAIN = 6;

export interface TickDrain {
  /** Whole ticks to run now. */
  ticks: number;
  /** The accumulator to carry into the next frame. */
  accumulator: number;
  /** True when the clamp discarded debt. Host may want to log it; no rule reads it. */
  clamped: boolean;
}

/**
 * Convert elapsed wall-clock into a whole number of ticks.
 *
 * **THIS IS THE ONLY PLACE TIME BECOMES TICKS, AND IT ACCUMULATES — IT DOES NOT COUNT
 * FRAMES.** A frame-counted loop runs the game at double speed on a 120 Hz phone and
 * at 0.75× on a 45 Hz panel: deterministic at every refresh rate, and a *different*
 * game at each. It is invisible on the machine it was written on, which is why the
 * determinism suite drives this at three frame rates rather than one.
 *
 * The accumulator is a float and is HOST state. It is not in `GameState`, it is never
 * serialized, and no rule reads it — only the integer `ticks` it produces crosses into
 * the simulation.
 */
export function drainTicks(accumulator: number, elapsedMs: number): TickDrain {
  let acc = accumulator + (elapsedMs > 0 ? elapsedMs : 0);
  let ticks = Math.floor(acc / TICK_MS);
  let clamped = false;
  if (ticks > MAX_TICKS_PER_DRAIN) {
    ticks = MAX_TICKS_PER_DRAIN;
    acc = 0;
    clamped = true;
  } else {
    acc -= ticks * TICK_MS;
  }
  return { ticks, accumulator: acc, clamped };
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** What a finished run was worth, read off the state. */
export function outcomeOf(state: GameState): RunOutcome {
  return {
    score: state.score,
    length: state.length,
    foodEaten: state.foodEaten,
    goldensTaken: state.goldensTaken,
    ticks: state.tick,
    filled: state.filled,
    dead: state.dead,
  };
}

/**
 * Duration, DERIVED from the tick count. The only bridge between this simulation and
 * anything measured in milliseconds, and it runs one way.
 *
 * A client-supplied duration would be a second, forgeable, un-cross-checkable field
 * saying the same thing as the tick count — and, given the clamp above, saying it
 * wrong. There is no inverse of this function on purpose.
 */
export function durationMsFromTicks(ticks: number): number {
  return Math.round((ticks * 1000) / TICK_HZ);
}

export interface ReplayResult {
  ok: boolean;
  /** Why the replay was refused. Never shown to a player verbatim. */
  reason?: string;
  outcome?: RunOutcome;
  state?: GameState;
}

/**
 * Re-simulate a recorded run and compute its outcome.
 *
 * **THIS IS THE PHASE 7 VERIFIER.** It imports nothing DOM-shaped and runs in a route
 * handler exactly as it runs in a test. The score it returns is the one that gets
 * stored; the client's claim is compared against it and rejected on mismatch, never
 * stored-and-sorted-later.
 *
 * An `engineVersion` this build does not implement is REFUSED, not rescored and not
 * guessed at — the failure that policy prevents is a tuning pass silently rescoring
 * every stored trace under rules those runs were never played under.
 */
export function replay(log: ReplayLog, expectedVersion: number): ReplayResult {
  if (log.engineVersion !== expectedVersion) {
    return { ok: false, reason: "unknown engine version" };
  }
  if (!Number.isInteger(log.ticks) || log.ticks < 0 || log.ticks > MAX_REPLAY_TICKS) {
    return { ok: false, reason: "tick count out of bounds" };
  }
  if (log.inputs.length > MAX_INPUT_EVENTS) {
    return { ok: false, reason: "too many inputs" };
  }

  // Inputs must be strictly ascending by tick: one input is applied per tick, so a
  // repeat or a step backwards is a malformed log rather than a playable one.
  for (let i = 1; i < log.inputs.length; i++) {
    if (log.inputs[i].tick <= log.inputs[i - 1].tick) {
      return { ok: false, reason: "inputs not strictly ascending" };
    }
  }

  const state = createGame(log.seed);
  let cursor = 0;

  // The pre-start input carries no tick of its own: nothing elapses until the run
  // begins, so the first input is applied at tick 0 and starts the clock.
  for (let t = 0; t < log.ticks; t++) {
    let input: Dir | null = null;
    const at = state.started ? state.tick : 0;
    if (cursor < log.inputs.length && log.inputs[cursor].tick === at) {
      input = log.inputs[cursor].dir;
      cursor++;
    }
    stepMut(state, input);
    if (state.dead || state.filled) break;
  }

  return { ok: true, outcome: outcomeOf(state), state };
}

/**
 * Run a whole input log against a fresh game and return the final state.
 *
 * The plain-Node driver the tests and the replayer share. `ticks` bounds the run;
 * it stops early on death or a filled board.
 */
export function runLog(seed: number, inputs: InputEvent[], ticks: number): GameState {
  const state = createGame(seed);
  let cursor = 0;
  for (let t = 0; t < ticks; t++) {
    let input: Dir | null = null;
    const at = state.started ? state.tick : 0;
    if (cursor < inputs.length && inputs[cursor].tick === at) {
      input = inputs[cursor].dir;
      cursor++;
    }
    stepMut(state, input);
    if (state.dead || state.filled) break;
  }
  return state;
}

/**
 * A stable, comparable serialization of a state — the "byte for byte" in the
 * determinism suite.
 *
 * Typed arrays are truncated to the live part of the ring: the cells beyond `length`
 * are stale ring entries that no rule reads, and including them would make two
 * genuinely identical runs compare unequal because one of them had previously been
 * longer. Comparing what the rules read is the point; comparing the buffer's litter
 * would be measuring the container.
 */
export function snapshot(state: GameState): string {
  const body: number[] = [];
  for (let i = 0; i < state.length; i++) body.push(segmentAt(state, i));
  return JSON.stringify({
    body,
    length: state.length,
    dir: state.dir,
    queue: state.queue,
    tick: state.tick,
    ticksToNextStep: state.ticksToNextStep,
    started: state.started,
    grain: state.grain,
    golden: state.golden,
    goldenSteps: state.goldenSteps,
    foodEaten: state.foodEaten,
    ordinaryEaten: state.ordinaryEaten,
    goldensTaken: state.goldensTaken,
    score: state.score,
    dead: state.dead,
    filled: state.filled,
    rng: state.rng,
    seed: state.seed,
  });
}
