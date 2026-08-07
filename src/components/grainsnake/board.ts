"use client";

/**
 * GRAINSNAKE leaderboard — the client half: the persisted name, and the three calls
 * that put a run on the board.
 *
 * HOST CODE. Nothing under `@/lib/grainsnake/engine` may import it, and nothing here
 * may be imported by the engine — the leaderboard costs the simulation zero ticks,
 * adds nothing to the input log, and a run played with the panel open is bit-identical
 * to one played without it.
 *
 * The log is READ from the recorder and sent; it is never written back.
 */

import { BASE_PATH } from "@/lib/basePath";
import { readJson, readJsonOr } from "@/lib/readJson";
import { NAME_MAX_LEN, NAME_MIN_LEN, sanitizeChompName } from "@/lib/chomp/score";
import type { LeaderboardResponse, SubmitBody, SubmitResponse } from "@/lib/grainsnake/wire";

export { NAME_MAX_LEN, NAME_MIN_LEN };

const NAME_KEY = "grainsnake:name";

/**
 * The player's name, persisted locally.
 *
 * Sanitised on the way OUT of storage as well as in: a name written by an older build
 * (or by hand in devtools) must not become the one thing on this page that was never
 * checked. The server re-sanitises and re-filters it again regardless — this copy
 * exists so a player finds out their name is too short while typing rather than after
 * a submit round-trip.
 */
export function readName(): string {
  if (typeof window === "undefined") return "";
  try {
    return sanitizeChompName(window.localStorage.getItem(NAME_KEY)) ?? "";
  } catch {
    return "";
  }
}

export function writeName(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage blocked — the name just will not survive a reload */
  }
}

/**
 * Make sure this browser carries a signed `grain_vid` cookie before submitting.
 *
 * The same route, cookie and secret the other two games use — HttpOnly and scoped to
 * the basePath, so it rides along on /api/grainsnake/* automatically and cannot be set
 * by script. Called before a submit rather than on page load: a player who never
 * finishes a run never needs one.
 */
export async function ensureSession(): Promise<void> {
  try {
    await fetch(`${BASE_PATH}/grains/session`, { method: "POST", credentials: "same-origin" });
  } catch {
    /* offline; the submit below will report the real failure */
  }
}

let inFlight: Promise<LeaderboardResponse | null> | null = null;

/**
 * Fetch the board. SHARES an in-flight request, because the panel is mounted in two
 * CSS-chosen forms and `display:none` is a rendering decision rather than a React one
 * — the hidden copy still mounts, still runs its effect and would still fetch. Chomp
 * learned that by measuring two requests per open.
 */
export function fetchBoard(): Promise<LeaderboardResponse | null> {
  if (inFlight) return inFlight;
  inFlight = fetch(`${BASE_PATH}/api/grainsnake/leaderboard`, {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then((res) => (res.ok ? readJsonOr<LeaderboardResponse | null>(res, null) : null))
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export interface SubmitOutcome {
  ok: boolean;
  error?: string;
  result?: SubmitResponse;
}

/**
 * Submit a finished run.
 *
 * **THERE IS NO SCORE IN THE BODY.** The server re-simulates `(seed, inputs, ticks)`
 * with the same step function this browser ran and computes the score itself, so
 * there is nothing here for a player to edit in devtools that would change what gets
 * stored. The response carries the VERIFIED score, which is what the UI then shows —
 * if the two ever disagreed, the server's is the true one and the client's was a bug.
 */
export async function submitRun(body: SubmitBody): Promise<SubmitOutcome> {
  await ensureSession();
  try {
    const res = await fetch(`${BASE_PATH}/api/grainsnake/score`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // `res.json()` on a 413 throws in a way that reads as a network error, which is
    // the bug chomp hit; read the status first.
    const payload = await readJson<Record<string, unknown>>(res).catch(() => null);
    if (!res.ok) {
      const error = typeof payload?.error === "string" ? payload.error : `submit failed (${res.status})`;
      return { ok: false, error };
    }
    return { ok: true, result: payload as unknown as SubmitResponse };
  } catch {
    return { ok: false, error: "could not reach the board" };
  }
}
