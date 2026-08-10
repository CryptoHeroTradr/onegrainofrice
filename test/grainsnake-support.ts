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
import {
  DOWN,
  LEFT,
  RIGHT,
  UP,
  opposite,
  type Dir,
  type GameState,
  type InputEvent,
} from "@/lib/grainsnake/types";

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
  // No off-board test. `neighbour()` wraps on both axes and cannot return a negative
  // cell — `test/grainsnake-wrap.test.ts` asserts that exhaustively over every cell ×
  // direction, which is what makes deleting the branch safe rather than optimistic.
  // It used to read `if (next < 0) return true;` and became unreachable at
  // ENGINE_VERSION 2; an unreachable branch in the helper every bot in this suite
  // routes through is a lie about what the bots are avoiding.
  const next = neighbour(head(state), d);
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
  if (state.occupied[from]) return 0;
  const seen = new Uint8Array(CELL_COUNT);
  const stack = [from];
  seen[from] = 1;
  let n = 0;
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    n++;
    for (const d of DIRS) {
      const nb = neighbour(cell, d);
      if (seen[nb] || state.occupied[nb]) continue;
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

// ---------------------------------------------------------------------------
// Death — the instruments for asserting it POSITIVELY
// ---------------------------------------------------------------------------

/**
 * The shortest snake that can die. **Measured, not assumed** — an exhaustive search
 * over every reachable body shape at each length, canonicalised by translating the head
 * to the origin (an exact symmetry on a torus) and closed under non-growing moves:
 * length 3 has 12 reachable shapes and 0 lethal moves, length 4 has 36 and 0, length 5
 * has 100 and 16. See the spec's *The board*.
 *
 * Why it matters to the SUITE rather than only to the design: an assertion that a snake
 * did not die is vacuous below this length, because it could not have. Since
 * ENGINE_VERSION 2 removed the walls, self-collision is the only death in the game, so
 * every `expect(dead).toBe(false)` on a short snake is now a test that cannot fail for
 * the reason it was written.
 */
export const MIN_LETHAL_LENGTH = 5;

/**
 * A direction that steps into the snake's own trail and is NOT the exempt vacating
 * tail — i.e. a move that must kill. Null when the shape offers none.
 *
 * Asks the engine for the tail and applies the one documented exception, exactly as
 * `isFatal` does; it does not re-derive the collision rule.
 */
export function suicideDir(state: GameState): Dir | null {
  for (const d of DIRS) {
    if (d === opposite(state.dir)) continue;
    const next = neighbour(head(state), d);
    if (!state.occupied[next]) continue;
    const grows = next === state.grain || next === state.golden;
    if (next === tailCell(state) && !grows) continue; // survivable by the exemption
    return d;
  }
  return null;
}

/** What a deliberate self-collision did, so a test can assert the REASON. */
export interface SelfCollision {
  /** The cell the head was steered into. */
  intoCell: number;
  /** Was that cell trail at the moment of the step? */
  wasOwnTrail: boolean;
  /** Ticks the whole manoeuvre took. */
  ticks: number;
  /** The tick the run ended on. */
  diedAtTick: number;
}

/** Clockwise from each direction — the coil that walks a snake into its own trail. */
const CLOCKWISE: Record<Dir, Dir> = { [UP]: RIGHT, [RIGHT]: DOWN, [DOWN]: LEFT, [LEFT]: UP };

/**
 * End a run by steering DELIBERATELY into the trail, and report what it steered into.
 *
 * This is the instrument the suite was missing. Before ENGINE_VERSION 2 the only run in
 * the whole suite that ended did so by holding one direction until a wall arrived; with
 * the walls gone that manoeuvre either loops forever or — worse, because it still
 * passes — laps the torus and dies of an *incidental* self-collision, which is a death
 * nobody asked for at a tick nobody predicted.
 *
 * It coils clockwise until a lethal move exists, then takes it. Both halves are
 * deterministic, so the tick it dies on is a fact a test may assert.
 */
export function dieBySelfCollision(state: GameState, guard = 64): SelfCollision {
  let ticks = 0;
  for (let i = 0; i < guard; i++) {
    if (state.dead || state.filled) throw new Error("run ended before the collision was set up");
    const kill = suicideDir(state);
    if (kill !== null) {
      const intoCell = neighbour(head(state), kill);
      const wasOwnTrail = state.occupied[intoCell] === 1;
      ticks += stepOneCell(state, kill);
      return { intoCell, wasOwnTrail, ticks, diedAtTick: state.tick };
    }
    ticks += stepOneCell(state, CLOCKWISE[state.dir]);
  }
  throw new Error(`no self-collision reachable in ${guard} steps`);
}

/**
 * THE GUARD AGAINST A VACUOUS `expect(dead).toBe(false)`.
 *
 * Same job as the determinism suite's `assertRan`: a value equal to the default
 * measures nothing. A snake below `MIN_LETHAL_LENGTH` is not surviving, it is merely
 * unable to die — so a test that asserts survival has to first establish that death was
 * on the table.
 */
export function expectCouldHaveDied(state: GameState, label: string): void {
  if (state.length < MIN_LETHAL_LENGTH) {
    throw new Error(
      `${label}: reached length ${state.length}, below MIN_LETHAL_LENGTH ${MIN_LETHAL_LENGTH} — ` +
        `death was impossible, so asserting it did not happen measures nothing`,
    );
  }
}

/**
 * Play a run with a grain-chasing bot and RECORD the input log it produced.
 *
 * The determinism and replay suites need a log that is a real run rather than a
 * hand-written script: a blind script almost never meets a grain, so it replays a snake
 * that ate nothing, and "the same empty run twice" is the vacuous pass those suites
 * already learned to guard against once.
 *
 * The bot steps toward the grain by the SHORTEST path on the torus, which is what makes
 * it wrap — it will happily leave one edge to arrive nearer the grain on the other, and
 * that is the behaviour under test, not a contrivance. It refuses fatal moves and falls
 * back to `safeDir`.
 *
 * Returns only `(tick, dir)` pairs, so the log is exactly what the replay format
 * permits and can be handed straight to `replay()`.
 */
export function recordGreedyRun(
  seed: number,
  ticks: number,
): { inputs: InputEvent[]; state: GameState; wraps: number } {
  const state = createGame(seed);
  const inputs: InputEvent[] = [];
  let wraps = 0;

  const towardGrain = (s: GameState): Dir | null => {
    if (s.grain < 0) return null;
    const hx = s.grain % COLS;
    const hy = Math.floor(s.grain / COLS);
    const cx = head(s) % COLS;
    const cy = Math.floor(head(s) / COLS);
    // Shortest signed step on each axis, wrapping.
    const sx = ((hx - cx + COLS + COLS / 2) % COLS) - Math.floor(COLS / 2);
    const sy = ((hy - cy + ROWS + ROWS / 2) % ROWS) - Math.floor(ROWS / 2);
    const wants: Dir[] = [];
    if (sx > 0) wants.push(RIGHT);
    else if (sx < 0) wants.push(LEFT);
    if (sy > 0) wants.push(DOWN);
    else if (sy < 0) wants.push(UP);
    for (const d of wants) {
      if (d === opposite(state.dir)) continue;
      if (!isFatal(s, d)) return d;
    }
    return null;
  };

  for (let t = 0; t < ticks; t++) {
    const before = head(state);
    const at = state.started ? state.tick : 0;
    let input: Dir | null = null;
    // Only offer an input when the snake is ABOUT to step, so the log stays sparse and
    // every entry is one the engine actually consumed.
    if (state.ticksToNextStep <= 1 || !state.started) {
      input = towardGrain(state) ?? safeDir(state);
      // A repeat of the current heading is not a turn and queues nothing — EXCEPT as
      // the opening input, where it is what starts the run. Nulling it there is the
      // bug that made two of the candidate seeds sit at tick 0 forever: the snake
      // starts facing RIGHT, so a bot whose first choice is RIGHT never presses go.
      if (state.started && input === state.dir) input = null;
    }
    if (input !== null) inputs.push({ tick: at, dir: input });
    stepMut(state, input);
    if (!state.dead && head(state) !== before && crossedSeam(before, head(state))) wraps++;
    if (state.dead || state.filled) break;
  }
  return { inputs, state, wraps };
}

/** Did a single step from `from` to `to` cross a seam? One step, so any jump did. */
export function crossedSeam(from: number, to: number): boolean {
  const dx = Math.abs((from % COLS) - (to % COLS));
  const dy = Math.abs(Math.floor(from / COLS) - Math.floor(to / COLS));
  return dx > 1 || dy > 1;
}

/**
 * A state whose trail is exactly `headFirst`, facing `dir`.
 *
 * Built by writing the ring rather than by playing, for the same reason
 * `nearlyFullState` is: the shape is the fixture, not the thing under test. Placing a
 * head on a border cell by playing there would take a hundred steps of bot and prove
 * nothing about the step being measured.
 */
export function stateWithBody(headFirst: number[], dir: Dir, seed = 99): GameState {
  const state = cloneState(createGame(seed));
  const n = headFirst.length;
  state.occupied.fill(0);
  for (let i = 0; i < n; i++) {
    const cell = headFirst[n - 1 - i]; // the ring runs tail → head
    state.cells[i] = cell;
    state.occupied[cell] = 1;
  }
  state.headPos = n - 1;
  state.length = n;
  state.foodEaten = Math.max(0, n - START_LENGTH);
  state.grain = -1;
  state.golden = -1;
  state.started = true;
  state.dir = dir;
  state.ticksToNextStep = ticksPerStepFor(state.foodEaten);
  return state;
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
