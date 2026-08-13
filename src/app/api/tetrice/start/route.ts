/**
 * POST /api/tetrice/start — begin a run.
 *
 * Returns `{ runId, seed, issuedAt, engineVersion }`. **The seed is generated here and
 * stored here.** There is no request body, so there is nothing for a client to express a
 * preference in, and the submit path will only accept a run id this route issued.
 *
 * ── WHY THE SEED IS THE SERVER'S ────────────────────────────────────────────────────
 * Spec, *The randomizer*: this game's seed determines the entire sequence of pieces, which
 * is the single largest input to a score. A client that picks its own can run a thousand
 * seeds offline and play the one that deals four I pieces into a flat well — the board
 * would then rank luck the player selected rather than luck they were dealt.
 *
 * **What this does NOT stop, stated plainly because the checks that miss it all pass:**
 * calling this route repeatedly and keeping only the friendliest seed. Every submission
 * from that player carries a distinct, unspent, correctly-bound run id, so every check on
 * the submit path returns green. The rate limit here is tighter than the one on submit and
 * makes shopping slow and visible; it does not make it impossible. The spec's load-bearing
 * mitigation — one live seed per vid, voided at first input — needs a start beacon this
 * API shape does not have, and *The randomizer* records that it is not implemented rather
 * than leaving it to be inferred from a missing column.
 *
 * A FAILURE HERE MUST NOT BLOCK PLAY. The client falls back to a local seed and plays
 * UNRANKED; this route going down takes the leaderboard with it and nothing else.
 */

import { checkStartRate, hashIp, issueRun } from "@/lib/tetrice/db";
import { ENGINE_VERSION } from "@/games/tetrice/engine/rules";
import type { StartResponse } from "@/lib/tetrice/wire";
import { readVidFromCookieHeader } from "@/lib/grains/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADERS });
}

/** The client IP as nginx forwarded it. Only ever hashed, never stored. */
function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip")?.trim() || null;
}

export function POST(req: Request): Response {
  // Identity is the signed `grain_vid` cookie minted by /grains/session — HttpOnly, sent
  // automatically, never a field in a payload.
  const vid = readVidFromCookieHeader(req.headers.get("cookie"));
  if (!vid) return fail(401, "no session");

  const ipHash = hashIp(clientIp(req));

  try {
    const rate = checkStartRate(vid, ipHash);
    if (!rate.ok) return fail(429, "too many runs started — take a breath");

    const issued = issueRun(vid, ipHash);
    const body: StartResponse = { ...issued, engineVersion: ENGINE_VERSION };
    return new Response(JSON.stringify(body), { headers: JSON_HEADERS });
  } catch (err) {
    console.error("[tetrice] start failed", err);
    return fail(503, "unavailable");
  }
}
