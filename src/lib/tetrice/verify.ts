/**
 * TETRICE — THE VERIFIER. One implementation, run on both sides.
 *
 * The route imports this; so does the browser, on every finished run. That is not
 * belt-and-braces — it is the only way the client self-check means anything. A self-check
 * that ran *different* code from the server would go green on runs the server then
 * rejects, which is worse than no self-check at all.
 *
 * ── IT CONTAINS NO SECOND ENGINE ────────────────────────────────────────────────────
 * The replay itself is `replay()` from `@/games/tetrice/client/inputLog` — which is the
 * `step()` function the browser ran, driven without a canvas. Nothing here re-derives a
 * rule, and nothing here knows what a score is worth. **There is no second implementation
 * to drift** (spec, *Anti-cheat*). This module adds only the things a verifier needs and a
 * player does not: bounds before the loop, and a check that the log ENDS where the run did.
 *
 * ── THE ONE PLACE THE VERIFIER MUST DISAGREE WITH THE ENGINE ────────────────────────
 * `step()` returns the state unchanged once `over` is set — it absorbs trailing input
 * silently, by design, because a replayer looping to the end of a trace will run past the
 * tick the run ended on and that is ordinary rather than a bug.
 *
 * **That is right for the engine and wrong here.** Absorbed input is exactly what a
 * tampered log looks like: append frames after the top-out and an engine that no-ops will
 * happily return the same state, so a verifier that only compared final states would
 * accept it. So this module checks the shape of the ending explicitly, and it is the one
 * rejection that cannot be delegated to the engine:
 *
 *   - the replay must end with `over` set — a run that never topped out did not finish;
 *   - it must have consumed EXACTLY `log.ticks` ticks — fewer means the run ended before
 *     the log did, which is trailing input past the top-out tick;
 *   - no entry may name a frame at or beyond `log.ticks` — the same tampering, done
 *     without adjusting the tick count.
 *
 * `test/tetrice-replay.test.ts` asserts all three against logs built to violate them.
 *
 * PURE. No `node:*`, no DOM, no database — it is imported by a client component.
 */

import { ENGINE_VERSION } from "@/games/tetrice/engine/rules";
import { replay, type LogEntry, type RunLog } from "@/games/tetrice/client/inputLog";
import type { GameState } from "@/games/tetrice/engine/state";

/**
 * The longest run this build will verify: 108,000 ticks — **30 minutes at 60 Hz**.
 *
 * Derived, not chosen. The engine replays at ~182,000 ticks/second on this box in its
 * worst case (an action on every tick, measured 2026-08-13), so this bounds ONE replay at
 * roughly 0.6 s of CPU. That matters because this is a single-process app: a route handler
 * that occupies the event loop for seconds is a route handler that stalls every other
 * request, and the submit path is reachable by anyone with a cookie.
 *
 * The rate limiter runs BEFORE the replay for the same reason, so the worst case is
 * `maxRunsPerIp` replays per window rather than an unbounded stream of them.
 *
 * **The honest cost of this bound: a genuine run longer than 30 minutes is refused**, with
 * a message saying so rather than a silent failure. A real player hitting it is the
 * evidence that would justify raising it.
 *
 * **Deliberately NOT an env var.** Every other tunable in this feature is one, and this one
 * must not be: the client runs this same verifier on every finished run, and an env
 * override would move the server's bound without moving the browser's — so the self-check
 * would pass on a run the route then refuses, which is precisely the divergence this
 * module exists to prevent. Raising it is a code change, so both sides move together.
 */
export const MAX_REPLAY_TICKS = 108_000;

/**
 * At most one entry per tick, and that is structural rather than a second policy: entries
 * are strictly ascending by frame and every frame is `< ticks`. Stating it as its own
 * constant keeps the check readable and keeps the body-size arithmetic in `env.ts` honest.
 */
export const MAX_LOG_ENTRIES = MAX_REPLAY_TICKS;

/** Why a log was refused, and — because the caller is an HTTP route — at what status. */
export type VerifyFailure =
  | { code: "engine-version"; status: 409; reason: string }
  | { code: "malformed"; status: 400; reason: string }
  | { code: "did-not-verify"; status: 422; reason: string };

export interface VerifiedRun {
  score: number;
  level: number;
  lines: number;
  ticks: number;
  /** DERIVED from ticks, here and nowhere else. Never accepted from a client. */
  durationMs: number;
  /** The final state, for callers that want to compare it (the client self-check does). */
  state: GameState;
}

export type VerifyResult = { ok: true; run: VerifiedRun } | ({ ok: false } & VerifyFailure);

const fail = (f: VerifyFailure): VerifyResult => ({ ok: false, ...f });

/** Ticks → milliseconds at the fixed 60 Hz simulation rate. One direction only. */
export function durationMsFromTicks(ticks: number): number {
  return Math.round((ticks * 1000) / 60);
}

/**
 * Parse an untrusted value into a `RunLog`. Shape only — the rules are checked by
 * `verifyRunLog`, which is the thing that must not be skippable.
 */
export function parseRunLog(raw: unknown): { ok: true; log: RunLog } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "inputLog must be an object" };
  const o = raw as Record<string, unknown>;

  const seed = Number(o.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return { ok: false, reason: "bad seed" };
  }
  const engineVersion = Number(o.engineVersion);
  if (!Number.isInteger(engineVersion)) return { ok: false, reason: "bad engine version" };

  const ticks = Number(o.ticks);
  if (!Number.isInteger(ticks) || ticks < 0) return { ok: false, reason: "bad tick count" };

  if (!Array.isArray(o.entries)) return { ok: false, reason: "entries must be an array" };
  const entries: LogEntry[] = [];
  for (const entry of o.entries) {
    if (!Array.isArray(entry) || entry.length !== 2) return { ok: false, reason: "bad log entry" };
    const frame = Number(entry[0]);
    const mask = Number(entry[1]);
    if (!Number.isInteger(frame) || frame < 0) return { ok: false, reason: "bad frame index" };
    if (!Number.isInteger(mask) || mask < 0 || mask > 0x7f) return { ok: false, reason: "bad action mask" };
    entries.push([frame, mask]);
  }

  return { ok: true, log: { seed, engineVersion, ticks, entries } };
}

/**
 * Verify a log and return what it scores.
 *
 * **Nothing in the caller's payload contributes to the result.** The score, level, lines and
 * duration all come out of the replay; a submission has no field for any of them.
 */
export function verifyRunLog(log: RunLog, expectedVersion: number = ENGINE_VERSION): VerifyResult {
  // ── refused, never rescored ───────────────────────────────────────────────────────
  // A run played under rules this build does not implement cannot be re-scored under
  // today's without inventing a number for it. 409, and the run stays playable.
  if (log.engineVersion !== expectedVersion) {
    return fail({ code: "engine-version", status: 409, reason: "unsupported engine version" });
  }

  // ── bounds, BEFORE anything is simulated ─────────────────────────────────────────
  // A log is an input to a loop and the loop runs in this process.
  if (log.ticks > MAX_REPLAY_TICKS) {
    return fail({ code: "malformed", status: 400, reason: "run too long to verify" });
  }
  if (log.entries.length > MAX_LOG_ENTRIES) {
    return fail({ code: "malformed", status: 400, reason: "too many log entries" });
  }

  for (let i = 0; i < log.entries.length; i++) {
    const [frame, mask] = log.entries[i];
    // Strictly ascending: one mask applies per frame, so a repeat or a step backwards is a
    // malformed log rather than a playable one.
    if (i > 0 && frame <= log.entries[i - 1][0]) {
      return fail({ code: "malformed", status: 400, reason: "frame indices not strictly ascending" });
    }
    // An entry the replay could never reach. This is trailing-input tampering done without
    // adjusting `ticks`, and it is structural, so it is a 400 rather than a 422.
    if (frame >= log.ticks) {
      return fail({ code: "malformed", status: 400, reason: "frame index past the end of the run" });
    }
    // A mask with no bits set is a no-op entry: the recorder only writes on CHANGE, so a
    // pair of identical masks cannot occur and neither can padding.
    if (i > 0 && mask === log.entries[i - 1][1]) {
      return fail({ code: "malformed", status: 400, reason: "repeated action mask" });
    }
  }

  // ── THE REPLAY. This is the verification. ────────────────────────────────────────
  const state = replay(log);

  // A run that did not top out did not finish, so there is nothing to put on a board of
  // finished runs. This also catches a truncated log: cut the last frames off a real run
  // and the replay simply stops mid-play.
  if (!state.over) {
    return fail({ code: "did-not-verify", status: 422, reason: "run did not end" });
  }
  // THE TRAILING-INPUT REJECTION. `replay()` stops the moment `over` is set, so a state
  // holding fewer ticks than the log claims means the log continued past the run's end —
  // the tampering `step()` absorbs silently and by design.
  if (state.ticks !== log.ticks) {
    return fail({
      code: "did-not-verify",
      status: 422,
      reason: "run topped out before the log ended",
    });
  }
  // A zero-score run is not a submission. It is also what an empty log replays to, so this
  // is the check that stops "top out immediately, submit nothing" from taking a board row.
  if (state.score <= 0) {
    return fail({ code: "did-not-verify", status: 422, reason: "nothing to submit" });
  }

  return {
    ok: true,
    run: {
      score: state.score,
      level: state.level,
      lines: state.lines,
      ticks: state.ticks,
      durationMs: durationMsFromTicks(state.ticks),
      state,
    },
  };
}
