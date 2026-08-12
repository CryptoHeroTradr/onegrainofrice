/**
 * TETRICE — the input log. THIS IS THE ARTIFACT, not a debugging aid.
 *
 * Phase 5 submits it and the server replays it, so its shape is a contract:
 * **`[frame, actionBitmask]`, one entry only for frames where the action set CHANGES.**
 * A run that holds nothing for 200 ticks writes nothing for 200 ticks.
 *
 * It carries `(seed, entries, ticks)` and NOTHING time-typed — no timestamps, no elapsed
 * ms, no wall clock. The replayer advances tick by tick and has no way to reconstruct a
 * clock, so a time field would be a client/server divergence by construction (spec:
 * *Hard constraints*). Duration is derived server-side from the tick count.
 *
 * DAS and ARR are NOT here and not in the engine. The input layer (Phase 4) converts a
 * held key into individual actions on individual ticks; this file records what it emitted.
 */

import { createInitialState, serialize, type GameState } from "../engine/state";
import { step, type Action } from "../engine/step";

/** Bit per action. The order is part of the format — appending is safe, reordering is not. */
export const ACTION_BITS: Record<Action, number> = {
  MoveLeft: 1 << 0,
  MoveRight: 1 << 1,
  RotateCW: 1 << 2,
  RotateCCW: 1 << 3,
  SoftDrop: 1 << 4,
  HardDrop: 1 << 5,
  Hold: 1 << 6,
};

const BY_BIT = Object.entries(ACTION_BITS) as Array<[Action, number]>;

export function maskOf(actions: readonly Action[]): number {
  let m = 0;
  for (const a of actions) m |= ACTION_BITS[a];
  return m;
}

export function actionsOf(mask: number): Action[] {
  const out: Action[] = [];
  for (const [action, bit] of BY_BIT) if (mask & bit) out.push(action);
  return out;
}

/** `[frame, mask]`. */
export type LogEntry = readonly [number, number];

export interface RunLog {
  readonly seed: number;
  readonly engineVersion: number;
  readonly ticks: number;
  readonly entries: readonly LogEntry[];
}

export class InputRecorder {
  private entries: LogEntry[] = [];
  private last = -1;

  /** Call once per simulated tick, before stepping. */
  record(frame: number, mask: number): void {
    if (mask === this.last) return;
    this.entries.push([frame, mask]);
    this.last = mask;
  }

  build(seed: number, engineVersion: number, ticks: number): RunLog {
    return { seed, engineVersion, ticks, entries: [...this.entries] };
  }

  get size(): number {
    return this.entries.length;
  }
}

/** Expand the sparse log back into a per-tick action set. */
export function actionsAt(entries: readonly LogEntry[], ticks: number): Action[][] {
  const out: Action[][] = Array.from({ length: ticks }, () => []);
  let mask = 0;
  let next = 0;
  for (let t = 0; t < ticks; t++) {
    while (next < entries.length && entries[next][0] === t) {
      mask = entries[next][1];
      next += 1;
    }
    out[t] = actionsOf(mask);
  }
  return out;
}

/** Replay a log from its seed. This is what the score route will do, in Node. */
export function replay(log: RunLog): GameState {
  let s = createInitialState(log.seed);
  const per = actionsAt(log.entries, log.ticks);
  for (let t = 0; t < log.ticks && !s.over; t++) s = step(s, per[t], t);
  return s;
}

/**
 * THE SELF-CHECK. Re-run the log through the engine and compare with the state the player
 * actually played out.
 *
 * GRAINSNAKE does this and it is how non-determinism gets caught in dev rather than as a
 * rejected submission later. It runs on a FINISHED run only, so it costs nothing during
 * play. A mismatch means the log and the run disagree — which makes the log worthless, so
 * it is loud.
 */
export function selfCheck(log: RunLog, played: GameState): boolean {
  const replayed = replay(log);
  const a = serialize(played);
  const b = serialize(replayed);
  if (a === b) return true;
  console.error(
    "[tetrice] SELF-CHECK FAILED — the input log does not replay to the run that was played.\n" +
      `  seed ${log.seed}, ticks ${log.ticks}, ${log.entries.length} entries\n` +
      `  played  : score ${played.score} lines ${played.lines} ticks ${played.ticks} over ${played.over}\n` +
      `  replayed: score ${replayed.score} lines ${replayed.lines} ticks ${replayed.ticks} over ${replayed.over}\n` +
      "  This log would be refused by the score route. Do not ship a build that does this.",
  );
  return false;
}
