"use client";

/**
 * TETRICE — the client's half of the run lifecycle. Fetch calls and nothing else.
 *
 * No rule, no scoring, no verification decision: this module asks the server for a run,
 * posts the log back, and reads the board. It is separate from `TetriceScreen` so the
 * screen keeps exactly one job — drawing what the engine says — and so this file can be
 * read on its own when the question is "what does the client send".
 *
 * ── EVERY CALL HERE FAILS SOFT ─────────────────────────────────────────────────────
 * A leaderboard is not the game (constraint 7). A failed `/start` means the run plays on
 * a local seed and is UNRANKED — the HUD says so — rather than the game refusing to begin
 * because a network call had a bad minute. A failed submit leaves the run playable and the
 * error on screen.
 */

import { BASE_PATH } from "@/lib/basePath";
import { ENGINE_VERSION } from "../engine/rules";
import type { RunLog } from "./inputLog";
import type { LeaderboardResponse, StartResponse, SubmitResponse } from "@/lib/tetrice/wire";

/** What the screen needs to know about the run it is about to play. */
export interface RunTicket {
  runId: string | null;
  seed: number;
  /** False when the seed is local: the run is playable and unsubmittable. */
  ranked: boolean;
}

/** A locally generated seed, for the unranked fallback only. */
function localSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 0;
}

/**
 * Ask the server for a run.
 *
 * The session call comes first and is fire-and-forget: `/api/tetrice/start` needs the
 * signed `grain_vid` cookie, and a visitor who has never touched the grains game does not
 * have one yet. If it fails, `start` will 401 and the run falls back to unranked — which
 * is the same path every other failure here takes.
 */
export async function startRun(): Promise<RunTicket> {
  try {
    await fetch(`${BASE_PATH}/grains/session`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    /* no session, no ranked run — handled below, not here */
  }

  try {
    const res = await fetch(`${BASE_PATH}/api/tetrice/start`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as StartResponse;
      if (
        typeof body.runId === "string" &&
        Number.isInteger(body.seed) &&
        body.engineVersion === ENGINE_VERSION
      ) {
        return { runId: body.runId, seed: body.seed >>> 0, ranked: true };
      }
    }
  } catch {
    /* fall through to the unranked seed */
  }
  return { runId: null, seed: localSeed(), ranked: false };
}

export type SubmitOutcome =
  | { ok: true; result: SubmitResponse }
  | { ok: false; status: number; error: string };

/**
 * Post a finished run.
 *
 * **THE BODY CARRIES NO SCORE.** `{ runId, engineVersion, inputLog, name }` — that is the
 * whole submission, and the server computes everything else by replaying it. There is no
 * number here to disagree with the server about.
 */
export async function submitRun(
  runId: string,
  log: RunLog,
  name: string,
): Promise<SubmitOutcome> {
  try {
    const res = await fetch(`${BASE_PATH}/api/tetrice/submit`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId,
        engineVersion: log.engineVersion,
        inputLog: { seed: log.seed, engineVersion: log.engineVersion, ticks: log.ticks, entries: log.entries },
        name,
      }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok && body && (body as SubmitResponse).ok) {
      return { ok: true, result: body as SubmitResponse };
    }
    const error =
      body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "submit failed";
    return { ok: false, status: res.status, error };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

export async function fetchLeaderboard(): Promise<LeaderboardResponse | null> {
  try {
    const res = await fetch(`${BASE_PATH}/api/tetrice/leaderboard`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as LeaderboardResponse;
  } catch {
    return null;
  }
}
