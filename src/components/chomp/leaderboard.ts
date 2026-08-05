"use client";

/**
 * RICE CHOMP leaderboard — the client half: what a finished run looks like, and the
 * three calls that put it on the board.
 *
 * This is HOST CODE. Nothing under `engine/` may import it, and nothing here may be
 * imported by the engine — the leaderboard costs the simulation zero ticks, adds
 * nothing to the input trace, and a run played with the panel open is bit-identical
 * to one played without it. That is the same line the cutscenes, the audio cues and
 * the pit video sit behind, and it is asserted in `test/chomp-audio.test.ts`.
 *
 * The trace is READ from the engine's `inputLog` and encoded here; it is never
 * written back. `summarizeRun()` takes a state and returns a plain object.
 */

import { isScoreSubmittable, type GameState } from "./engine/game";
import { encodeTrace } from "@/lib/chomp/trace";
import type { LeaderboardResponse, SubmitBody, SubmitResponse } from "@/lib/chomp/wire";
import { BASE_PATH } from "@/lib/basePath";
import { asset } from "@/lib/asset";

/** Everything a submission needs, lifted off a finished run. */
export interface RunSummary {
  score: number;
  level: number;
  startLevel: number;
  ticks: number;
  grains: number;
  golden: number;
  pests: number;
  bonuses: number;
  seed: number;
  trace: string;
  /** False for a `?level=N` run. The board never sees one; see the note below. */
  submittable: boolean;
}

/**
 * Read a finished run into a submission payload.
 *
 * `seed` is not on the state — the engine consumes its seed into `rng` on the first
 * advance — so the host passes back the seed the run was CREATED with. Today that is
 * always DEFAULT_SEED; it travels anyway, because replay verification needs it and
 * the day the seed is per-run this is already right.
 *
 * READS ONLY. Nothing here writes to `state`, which is what lets the game-over card
 * call it on the live object rather than on a copy.
 */
export function summarizeRun(state: GameState, seed: number): RunSummary {
  return {
    score: state.score,
    level: state.level,
    startLevel: state.startLevel,
    ticks: state.tick,
    grains: state.grainsEaten,
    golden: state.powerEaten,
    pests: state.pestsEaten,
    bonuses: state.bonusesEaten,
    seed,
    trace: encodeTrace(state.inputLog),
    // THE CLIENT HALF OF THE DEBUG GATE. The server applies the same rule to the
    // payload (lib/chomp/score.ts) and a level-7 trace fails replay from level 1
    // regardless. Three independent stops, because one guard on a cheat path is not
    // a guard.
    submittable: isScoreSubmittable(state),
  };
}

/**
 * Make sure this browser carries a signed `grain_vid` cookie before submitting.
 *
 * The same route, cookie and secret the grains game uses — the cookie is HttpOnly and
 * scoped to the basePath, so it rides along on /api/chomp/* automatically and cannot
 * be set by script. Called before a submit rather than on page load: a player who
 * never finishes a run never needs one.
 */
export async function ensureSession(): Promise<void> {
  try {
    await fetch(`${BASE_PATH}/grains/session`, { method: "POST", cache: "no-store" });
  } catch {
    // Offline, or the route is down. The submit below will fail with a message the
    // player can act on; failing here would just be a worse version of the same.
  }
}

/**
 * In-flight request sharing. Measured, not anticipated: opening the board fired the
 * request TWICE.
 *
 * Both forms of the panel are mounted — the docked one and the overlay one — and CSS
 * decides which is displayed (see ChompScreen for why that is the right trade). But
 * `display: none` is a rendering decision, not a React one: the hidden component still
 * mounts, still runs its effect, and still fetched. Two identical no-store GETs, two
 * pairs of indexed reads, one of them for a panel nobody can see.
 *
 * Callers still pass an AbortSignal and still check it before using the result. What
 * they no longer do is cancel the underlying request, because it may not be theirs.
 * For a small JSON GET that is the right way round.
 */
let inFlight: Promise<LeaderboardResponse> | null = null;

/** The board plus this player's own row. Throws on anything but a 200. */
export function fetchBoard(signal?: AbortSignal): Promise<LeaderboardResponse> {
  void signal; // the caller's, for deciding whether to apply the result — see above
  if (inFlight) return inFlight;
  const req = (async () => {
    const res = await fetch(asset("/api/chomp/leaderboard"), { cache: "no-store" });
    if (!res.ok) throw new Error(`leaderboard ${res.status}`);
    return (await res.json()) as LeaderboardResponse;
  })();
  inFlight = req;
  // Cleared on settle either way, so a failed load does not poison the next attempt.
  void req.then(
    () => {
      if (inFlight === req) inFlight = null;
    },
    () => {
      if (inFlight === req) inFlight = null;
    },
  );
  return req;
}

export type SubmitOutcome =
  | { ok: true; result: SubmitResponse }
  | { ok: false; error: string };

/** Post a run. Never throws — the caller wants a message, not an exception. */
export async function submitScore(name: string, run: RunSummary): Promise<SubmitOutcome> {
  const body: SubmitBody = {
    name,
    score: run.score,
    level: run.level,
    startLevel: run.startLevel,
    ticks: run.ticks,
    grains: run.grains,
    golden: run.golden,
    pests: run.pests,
    bonuses: run.bonuses,
    seed: run.seed,
    trace: run.trace,
  };
  try {
    await ensureSession();
    const res = await fetch(asset("/api/chomp/score"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err =
        json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
          ? (json as { error: string }).error
          : `submission failed (${res.status})`;
      return { ok: false, error: err };
    }
    return { ok: true, result: json as SubmitResponse };
  } catch {
    return { ok: false, error: "Could not reach the board. Try again." };
  }
}
