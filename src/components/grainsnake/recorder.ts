/**
 * GRAINSNAKE — recording a run, and checking it back.
 *
 * HOST CODE. The simulation costs nothing for any of this: the recorder observes what
 * was fed to `stepMut` and writes it down. A run played with recording on is
 * bit-identical to one played without it, because recording reads and never writes.
 *
 * ── THE FORMAT IS `(seed, inputs, tick index)` AND NOTHING ELSE ─────────────────
 * No timestamp, no duration, no elapsed-ms. Not "discouraged" — there is no field for
 * one to arrive in (`ReplayLog` in `@/lib/grainsnake/types`). The host's accumulator
 * CLAMP is why: a backgrounded tab returns holding seconds of debt, the clamp drops
 * it so the run does not spend it in one frame, and the replayer never learns it
 * happened. Any time-derived field would therefore be a client/server divergence by
 * construction — not a bug to track down, the format working as specified and
 * mismatching on every genuine run that was ever tabbed away from.
 *
 * The clamp changes PACING only. It never changes the tick SEQUENCE: ticks are still
 * 0, 1, 2, … and an input is still stamped with the tick it was applied on, so a
 * clamped run and an unclamped one replay identically.
 */

import { ENGINE_VERSION } from "@/lib/grainsnake/rules";
import { outcomeOf, replay } from "@/lib/grainsnake/engine";
import type { Dir, GameState, InputEvent, ReplayLog } from "@/lib/grainsnake/types";

export interface Recorder {
  /** Note an input that was just handed to the engine at `tick`. */
  record(tick: number, dir: Dir): void;
  /** The log so far, sealed at the run's current tick count. */
  seal(state: GameState): ReplayLog;
  reset(seed: number): void;
}

export function createRecorder(seed: number): Recorder {
  let inputs: InputEvent[] = [];
  let currentSeed = seed;
  let lastTick = -1;

  return {
    record(tick, dir) {
      // Strictly ascending, which the replayer enforces too. One input is applied per
      // tick by construction — the host offers at most one — so a repeat here would
      // mean the caller double-recorded, and dropping it silently is better than
      // shipping a log that the verifier will refuse.
      if (tick <= lastTick) return;
      lastTick = tick;
      inputs.push({ tick, dir });
    },
    seal(state) {
      return { seed: currentSeed, inputs: inputs.slice(), ticks: state.tick, engineVersion: ENGINE_VERSION };
    },
    reset(nextSeed) {
      inputs = [];
      lastTick = -1;
      currentSeed = nextSeed;
    },
  };
}

export interface VerifyResult {
  ok: boolean;
  playedScore: number;
  replayedScore: number | null;
  reason?: string;
}

/**
 * Re-run the recorded log through the SAME step function and check the score matches.
 *
 * **THIS IS THE PHASE 7 VERIFIER, RUNNING EARLY AND FOR FREE.** The server-side check
 * will call `replay()` from a route handler with no canvas anywhere; calling it here,
 * on every finished run, means a divergence between play and replay is found by
 * whoever is playing rather than by a player whose score was refused.
 *
 * A mismatch is a bug in the engine or in the host's input plumbing — never in the
 * player — so it is logged loudly and the run is left alone.
 */
export function verifyRun(log: ReplayLog, played: GameState): VerifyResult {
  const playedScore = played.score;
  const verdict = replay(log, ENGINE_VERSION);
  if (!verdict.ok || !verdict.outcome) {
    return { ok: false, playedScore, replayedScore: null, reason: verdict.reason ?? "refused" };
  }
  const replayed = verdict.outcome;
  const live = outcomeOf(played);
  const ok =
    replayed.score === live.score &&
    replayed.length === live.length &&
    replayed.foodEaten === live.foodEaten &&
    replayed.goldensTaken === live.goldensTaken &&
    replayed.ticks === live.ticks;
  return {
    ok,
    playedScore,
    replayedScore: replayed.score,
    reason: ok ? undefined : "replayed outcome differs from the played run",
  };
}
