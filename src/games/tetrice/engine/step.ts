/**
 * TETRICE — one tick of the simulation.
 *
 * ─── THE INPUT BOUNDARY, WHICH IS THE WHOLE REASON REPLAY VERIFICATION WORKS ──────────
 *
 * **THE ENGINE SEES DISCRETE ACTIONS PER FRAME. IT HAS NO CONCEPT OF A KEY BEING HELD.**
 *
 * DAS (the delay before a held direction repeats) and ARR (how fast it then repeats) live
 * in the CLIENT's input layer. The client converts a held key into individual `MoveLeft`
 * actions on specific ticks; the trace records those actions at those ticks; the replayer
 * feeds the same list back in. Nothing in this file knows how they were produced.
 *
 * Two things follow, and both are load-bearing:
 *
 *  1. **DAS/ARR are feel tunables that may change WITHOUT an `ENGINE_VERSION` bump**,
 *     because the simulation never reads them. That is the difference between a tuning
 *     pass and a migration.
 *  2. **A trace is `(seed, actions, tick index)` and nothing else.** No timestamps, no
 *     durations, no held-key state to reconstruct. Anything the replayer cannot rebuild
 *     from those three cannot be in the format (spec: *Hard constraints*).
 *
 * If a future change makes the engine ask "is left still down?", replay verification is
 * over — that is a question about wall-clock input state, and the replayer has no way to
 * answer it.
 *
 * ─── PURITY ──────────────────────────────────────────────────────────────────────────
 *
 * `step` never mutates its argument. It builds a draft, copies the typed arrays only when
 * something is actually written to them, and returns a new state. Same state + same
 * actions + same frame ⇒ same output, in the browser and in Node, for ever.
 */

import {
  COLS,
  HARD_DROP_POINTS,
  LINE_SCORES,
  LOCK_DELAY_FRAMES,
  MAX_LOCK_RESETS,
  ROWS,
  SHAPE_DEF,
  SOFT_DROP_POINTS,
  SPAWN_Y,
  cellsOf,
  gravityFramesForLevel,
  kickOffsets,
  levelForLines,
  spawnX,
  type Rotation,
  type Shape,
} from "./rules";
import {
  EMPTY,
  cellCode,
  collides,
  idx,
  refillQueue,
  type ActivePiece,
  type GameState,
} from "./state";

export type Action =
  | "MoveLeft"
  | "MoveRight"
  | "RotateCW"
  | "RotateCCW"
  | "SoftDrop"
  | "HardDrop"
  | "Hold";

export const ALL_ACTIONS: readonly Action[] = [
  "MoveLeft",
  "MoveRight",
  "RotateCW",
  "RotateCCW",
  "SoftDrop",
  "HardDrop",
  "Hold",
];

/**
 * The order actions are applied within one tick — FIXED, and independent of the order the
 * caller listed them in. Two clients that emit the same set in a different order must
 * produce the same tick, or the trace's meaning depends on array order and the replayer
 * disagrees with the browser for a reason nobody will find.
 *
 * At most one of each action applies per tick; a repeated action in the array is ignored.
 */
const ACTION_ORDER: readonly Action[] = [
  "Hold",
  "RotateCW",
  "RotateCCW",
  "MoveLeft",
  "MoveRight",
  "SoftDrop",
  "HardDrop",
];

/** Mutable working copy. Nothing outside this module ever sees one. */
interface Draft {
  rng: number;
  bag: Shape[];
  queue: Shape[];
  well: Uint8Array;
  wellPiece: Int32Array;
  wellCellIndex: Uint8Array;
  wellCopied: boolean;
  active: ActivePiece | null;
  hold: Shape | null;
  holdUsed: boolean;
  gravityCounter: number;
  lockTimer: number;
  lockResets: number;
  score: number;
  lines: number;
  level: number;
  over: boolean;
  pieceCounter: number;
  /** A piece locked this tick, so gravity must not run again on its successor. */
  lockedThisTick: boolean;
}

function toDraft(s: GameState): Draft {
  return {
    rng: s.rng,
    bag: [...s.bag],
    queue: [...s.queue],
    well: s.well,
    wellPiece: s.wellPiece,
    wellCellIndex: s.wellCellIndex,
    wellCopied: false,
    active: s.active,
    hold: s.hold,
    holdUsed: s.holdUsed,
    gravityCounter: s.gravityCounter,
    lockTimer: s.lockTimer,
    lockResets: s.lockResets,
    score: s.score,
    lines: s.lines,
    level: s.level,
    over: s.over,
    pieceCounter: s.pieceCounter,
    lockedThisTick: false,
  };
}

/** Copy-on-write: the caller's arrays are never written through. */
function mutableWell(d: Draft): void {
  if (d.wellCopied) return;
  d.well = new Uint8Array(d.well);
  d.wellPiece = new Int32Array(d.wellPiece);
  d.wellCellIndex = new Uint8Array(d.wellCellIndex);
  d.wellCopied = true;
}

/** Restart the lock timer, if the piece is resting and it has a reset left to spend. */
function noteStateChange(d: Draft): void {
  if (d.lockTimer < 0) return; // not resting — the timer is not running
  if (d.lockResets >= MAX_LOCK_RESETS) return; // exhausted; the timer keeps running
  d.lockResets += 1;
  d.lockTimer = 0;
}

function tryMove(d: Draft, dx: number, dy: number): boolean {
  const p = d.active;
  if (!p) return false;
  if (collides(d.well, p.shape, p.rot, p.x + dx, p.y + dy)) return false;
  d.active = { ...p, x: p.x + dx, y: p.y + dy };
  return true;
}

/**
 * SRS rotation. Tries the naive rotation, then each kick offset in order, and takes the
 * first that fits. If none fits, NOTHING changes — and a rotation that did not happen is
 * not a state change (spec: *A RESET REQUIRES A STATE CHANGE*).
 */
function tryRotate(d: Draft, dir: 1 | -1): boolean {
  const p = d.active;
  if (!p) return false;
  // O's four states are identical, so rotating it is a no-op — not a failed rotation, an
  // absent one. It must not restart the lock timer, or an O can be held on the surface
  // for ever by tapping rotate.
  if (!SHAPE_DEF[p.shape].rotates) return false;

  const from = p.rot;
  const to = (((p.rot + dir) % 4) + 4) % 4 as Rotation;
  for (const [dx, dy] of kickOffsets(p.shape, from, to)) {
    if (!collides(d.well, p.shape, to, p.x + dx, p.y + dy)) {
      d.active = { ...p, rot: to, x: p.x + dx, y: p.y + dy };
      return true;
    }
  }
  return false;
}

/** Put `shape` at the spawn position. Sets `over` if it overlaps an occupied cell. */
function spawn(d: Draft, shape: Shape): void {
  const id = d.pieceCounter + 1;
  d.pieceCounter = id;
  const x = spawnX(shape);
  const y = SPAWN_Y;

  // THE ONLY TERMINATOR. Checked identically for a piece from the queue and one out of
  // the hold slot; there is deliberately no separate lock-out rule.
  if (collides(d.well, shape, 0, x, y)) {
    d.active = null;
    d.over = true;
    return;
  }
  d.active = { shape, rot: 0, x, y, id };
  d.gravityCounter = 0;
  d.lockTimer = -1;
  d.lockResets = 0;
}

function spawnFromQueue(d: Draft): void {
  const topped = refillQueue(d.rng, d.bag, d.queue);
  d.rng = topped.rng;
  d.bag = topped.bag;
  const shape = topped.queue[0];
  const rest = topped.queue.slice(1);
  const refilled = refillQueue(d.rng, d.bag, rest);
  d.rng = refilled.rng;
  d.bag = refilled.bag;
  d.queue = refilled.queue;
  spawn(d, shape);
}

/** Full rows are removed and everything above them shifts down. Returns rows cleared. */
function clearLines(d: Draft): number {
  const full: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    let complete = true;
    for (let x = 0; x < COLS; x++) {
      if (d.well[idx(x, y)] === EMPTY) {
        complete = false;
        break;
      }
    }
    if (complete) full.push(y);
  }
  if (full.length === 0) return 0;

  mutableWell(d);
  const isFull = new Set(full);
  // Walk upward, compacting surviving rows toward the bottom.
  let write = ROWS - 1;
  for (let read = ROWS - 1; read >= 0; read--) {
    if (isFull.has(read)) continue;
    if (write !== read) {
      for (let x = 0; x < COLS; x++) {
        d.well[idx(x, write)] = d.well[idx(x, read)];
        d.wellPiece[idx(x, write)] = d.wellPiece[idx(x, read)];
        d.wellCellIndex[idx(x, write)] = d.wellCellIndex[idx(x, read)];
      }
    }
    write -= 1;
  }
  for (let y = write; y >= 0; y--) {
    for (let x = 0; x < COLS; x++) {
      d.well[idx(x, y)] = EMPTY;
      d.wellPiece[idx(x, y)] = 0;
      d.wellCellIndex[idx(x, y)] = 0;
    }
  }
  return full.length;
}

/**
 * Write the active piece into the well, clear, score, level up, and spawn the successor —
 * all on this tick. There is no entry delay and no clear delay: they would be two more
 * frame counts the replayer has to reproduce, and the renderer can have the feel instead.
 */
function lockPiece(d: Draft): void {
  const p = d.active;
  if (!p) return;

  mutableWell(d);
  const code = cellCode(p.shape);
  cellsOf(p.shape, p.rot).forEach(([cx, cy], cellIndex) => {
    const i = idx(p.x + cx, p.y + cy);
    d.well[i] = code;
    d.wellPiece[i] = p.id;
    d.wellCellIndex[i] = cellIndex;
  });

  const cleared = clearLines(d);
  // THE MULTIPLIER IS THE LEVEL THE PIECE WAS PLAYED UNDER — read before these lines are
  // counted toward the next level-up. This ordering is the single likeliest place for a
  // verifier to disagree with a client, on the one run that crossed a threshold.
  if (cleared > 0) {
    d.score += LINE_SCORES[cleared] * d.level;
    d.lines += cleared;
    d.level = levelForLines(d.lines);
  }

  d.active = null;
  d.holdUsed = false;
  d.lockedThisTick = true;
  spawnFromQueue(d);
}

function applyHold(d: Draft): void {
  const p = d.active;
  if (!p || d.holdUsed) return;
  const outgoing = p.shape;
  const incoming = d.hold;
  d.hold = outgoing;
  d.holdUsed = true;
  if (incoming === null) {
    spawnFromQueue(d);
  } else {
    // The incoming piece arrives in its SPAWN state at the spawn position — not in the
    // rotation or column the outgoing one was in — and it takes the same top-out check.
    spawn(d, incoming);
  }
}

function applyAction(d: Draft, action: Action): void {
  if (!d.active || d.over) return;
  switch (action) {
    case "Hold":
      applyHold(d);
      return;
    case "RotateCW":
      if (tryRotate(d, 1)) noteStateChange(d);
      return;
    case "RotateCCW":
      if (tryRotate(d, -1)) noteStateChange(d);
      return;
    case "MoveLeft":
      // A move into a wall or into the stack does not move the piece, so it is not a
      // state change and resets nothing. This is the common instance of that rule: a
      // player holding left at the well edge is what everybody does while deciding.
      if (tryMove(d, -1, 0)) noteStateChange(d);
      return;
    case "MoveRight":
      if (tryMove(d, 1, 0)) noteStateChange(d);
      return;
    case "SoftDrop":
      // Downward movement needs no reset: while the piece can move down it is not
      // resting, so the timer is not running. One point per cell actually travelled.
      if (tryMove(d, 0, 1)) {
        d.score += SOFT_DROP_POINTS;
        d.gravityCounter = 0;
      }
      return;
    case "HardDrop": {
      let cells = 0;
      while (tryMove(d, 0, 1)) cells += 1;
      d.score += cells * HARD_DROP_POINTS;
      // Locks on the tick it lands: no lock delay, no reset, no way back.
      lockPiece(d);
      return;
    }
  }
}

/**
 * Advance the simulation by exactly one tick.
 *
 * `frame` must equal `state.ticks`. It is not used to derive anything — it is an alignment
 * check, because a replayer that feeds ticks out of order is a caller bug that would
 * otherwise produce a plausible, wrong, silently different run.
 */
export function step(
  state: GameState,
  inputs: readonly Action[] = [],
  frame: number = state.ticks,
): GameState {
  // A finished run is finished. Feeding it more frames changes nothing, and in particular
  // does not advance the tick count a duration is derived from.
  //
  // This is checked BEFORE the alignment check on purpose: a caller looping a frame
  // counter to the end of a trace will run past the tick the run ended on, and that is
  // ordinary, not a bug. Nothing can change after `over`, so there is nothing to protect.
  if (state.over) return state;

  if (frame !== state.ticks) {
    throw new Error(`tetrice: frame ${frame} fed to a state at tick ${state.ticks}`);
  }

  const d = toDraft(state);

  const seen = new Set<Action>(inputs);
  for (const action of ACTION_ORDER) {
    if (seen.has(action)) applyAction(d, action);
  }

  // ─── gravity ───────────────────────────────────────────────────────────────
  if (!d.over && d.active && !d.lockedThisTick) {
    d.gravityCounter += 1;
    const perRow = gravityFramesForLevel(d.level);
    while (d.gravityCounter >= perRow) {
      if (!tryMove(d, 0, 1)) break;
      d.gravityCounter -= perRow;
    }
  }

  // ─── lock delay ────────────────────────────────────────────────────────────
  if (!d.over && d.active && !d.lockedThisTick) {
    const p = d.active;
    const resting = collides(d.well, p.shape, p.rot, p.x, p.y + 1);
    if (!resting) {
      d.lockTimer = -1;
    } else {
      d.lockTimer = d.lockTimer < 0 ? 1 : d.lockTimer + 1;
      if (d.lockTimer >= LOCK_DELAY_FRAMES) lockPiece(d);
    }
  }

  return {
    engineVersion: state.engineVersion,
    seed: state.seed,
    rng: d.rng,
    bag: d.bag,
    queue: d.queue,
    well: d.well,
    wellPiece: d.wellPiece,
    wellCellIndex: d.wellCellIndex,
    active: d.active,
    hold: d.hold,
    holdUsed: d.holdUsed,
    gravityCounter: d.gravityCounter,
    lockTimer: d.lockTimer,
    lockResets: d.lockResets,
    score: d.score,
    lines: d.lines,
    level: d.level,
    ticks: state.ticks + 1,
    over: d.over,
    pieceCounter: d.pieceCounter,
  };
}

/** Run a whole tick-indexed action log. This is exactly what the replayer will call. */
export function run(
  initial: GameState,
  log: ReadonlyMap<number, readonly Action[]> | readonly (readonly Action[])[],
  ticks: number,
): GameState {
  let s = initial;
  const at = (t: number): readonly Action[] =>
    Array.isArray(log) ? (log[t] ?? []) : ((log as ReadonlyMap<number, readonly Action[]>).get(t) ?? []);
  for (let t = 0; t < ticks; t++) {
    s = step(s, at(t), t);
    if (s.over) break;
  }
  return s;
}
