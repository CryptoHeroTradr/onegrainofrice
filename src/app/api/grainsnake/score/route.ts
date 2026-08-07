/**
 * POST /api/grainsnake/score — submit a finished run.
 *
 * ── THE SCORE IS COMPUTED, NEVER ACCEPTED ───────────────────────────────────────
 * This is the difference between this route and RICE CHOMP's, and it is the whole
 * anti-forgery position. Chomp re-checks the arithmetic plausibility of a claimed
 * score and stores the claim; it stores the input trace UNVERIFIED because replaying
 * its simulation would have meant a second full implementation of a big engine.
 *
 * GRAINSNAKE's entire state is (cells, direction, queue, PRNG, counters) and the
 * replayer IS the step function — `@/lib/grainsnake/engine`, the same module the
 * browser ran, imported here and driven without a canvas. So there is nothing to
 * re-check: the run is re-simulated from `(seed, inputs, ticks)` and the score that
 * comes out is the score that gets stored. `SubmitBody` has no `score` field at all.
 *
 * **What this buys, precisely: it eliminates FORGED scores. It does not eliminate
 * BOTS.** The client necessarily holds the seed — it has to simulate to draw — so a
 * headless player can compute a perfect route offline and submit a log that replays
 * flawlessly, and it *should* pass, because it is a real run of this game. The honest
 * claim is "every score on this board is the score of a real run", never "of a human".
 *
 * Everything else is trusted no more than chomp trusts it: the name is re-sanitized
 * and re-filtered server-side whatever the browser did to it, the country comes from
 * nginx's GeoIP header rather than the payload, identity comes from the signed
 * `grain_vid` cookie rather than a field, and the duration is DERIVED from the tick
 * count rather than accepted.
 */

import {
  checkRate,
  hashIp,
  submitRun,
  type StoredRun,
} from "@/lib/grainsnake/db";
import { getGrainsnakeEnv } from "@/lib/grainsnake/env";
import { ENGINE_VERSION } from "@/lib/grainsnake/rules";
import { replay } from "@/lib/grainsnake/engine";
import type { Dir, InputEvent } from "@/lib/grainsnake/types";
import type { SubmitResponse } from "@/lib/grainsnake/wire";
// Pure text rules, no database and no state. Shared rather than duplicated on
// purpose: two profanity lists are two lists that drift, and the "share nothing with
// chomp" rule is about its DATABASE and its API namespace, neither of which this is.
import { checkName } from "@/lib/chomp/score";
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

/** Parse the input log for SHAPE. The replayer re-checks ordering and bounds. */
function parseInputs(raw: unknown): { ok: true; inputs: InputEvent[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: "inputs must be an array" };
  const inputs: InputEvent[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return { ok: false, reason: "bad input entry" };
    const e = entry as Record<string, unknown>;
    const tick = Number(e.tick);
    const dir = Number(e.dir);
    if (!Number.isInteger(tick) || tick < 0) return { ok: false, reason: "bad input tick" };
    if (!Number.isInteger(dir) || dir < 0 || dir > 3) return { ok: false, reason: "bad input dir" };
    inputs.push({ tick, dir: dir as Dir });
  }
  return { ok: true, inputs };
}

export async function POST(req: Request): Promise<Response> {
  const { maxBodyBytes } = getGrainsnakeEnv();

  // Refuse an oversized body before parsing it, so a hostile body never becomes a
  // hostile JSON.parse.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBodyBytes) return fail(413, "too large");

  const raw = await req.text();
  if (raw.length > maxBodyBytes) return fail(413, "too large");

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fail(400, "malformed");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, "malformed");
  }

  // --- identity ------------------------------------------------------------
  // The cookie is minted and signed by /grains/session, is HttpOnly, and rides along
  // automatically. No cookie means the client skipped the session call: a 401 with a fix.
  const vid = readVidFromCookieHeader(req.headers.get("cookie"));
  if (!vid) return fail(401, "no session");

  // --- name ----------------------------------------------------------------
  const name = checkName(body.name);
  if (!name.ok) return fail(400, name.reason);

  // --- the run -------------------------------------------------------------
  const seed = Number(body.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return fail(400, "bad seed");

  const ticks = Number(body.ticks);
  if (!Number.isInteger(ticks) || ticks < 0) return fail(400, "bad tick count");

  const engineVersion = Number(body.engineVersion);
  if (!Number.isInteger(engineVersion)) return fail(400, "bad engine version");
  // Refused, not rescored. A run played under rules this build does not implement
  // cannot be re-scored under today's without inventing a number for it.
  if (engineVersion !== ENGINE_VERSION) return fail(409, "unsupported engine version");

  const parsedInputs = parseInputs(body.inputs);
  if (!parsedInputs.ok) return fail(400, parsedInputs.reason);

  // --- rate limit, BEFORE the replay ---------------------------------------
  // Replay is the expensive part of this handler — it is a simulation loop — so the
  // cheap indexed counts go first. A flood costs two COUNTs and no CPU.
  const ipHash = hashIp(clientIp(req));
  try {
    const rate = checkRate(vid, ipHash);
    if (!rate.ok) return fail(429, "too many runs — take a breath");
  } catch (err) {
    console.error("[grainsnake] rate check failed", err);
    return fail(503, "unavailable");
  }

  // --- REPLAY. This is the verification. -----------------------------------
  // Bounds on ticks and input count are checked inside `replay()` BEFORE it simulates
  // anything, because a log is an input to a loop and the loop runs on this process.
  const verdict = replay(
    { seed, inputs: parsedInputs.inputs, ticks, engineVersion },
    ENGINE_VERSION,
  );
  if (!verdict.ok || !verdict.outcome) {
    return fail(422, verdict.reason ?? "run did not verify");
  }
  const outcome = verdict.outcome;

  // A run that neither ended nor filled the board did not finish, so there is nothing
  // to put on a board of finished runs.
  if (!outcome.dead && !outcome.filled) return fail(422, "run did not end");
  if (outcome.score <= 0) return fail(422, "nothing to submit");

  // --- store ---------------------------------------------------------------
  const run: StoredRun = {
    vid,
    name: name.name,
    // THE COMPUTED SCORE. Not a claim — there was never a claim.
    score: outcome.score,
    length: outcome.length,
    goldens: outcome.goldensTaken,
    foodEaten: outcome.foodEaten,
    ticks: outcome.ticks,
    seed,
    inputs: JSON.stringify(parsedInputs.inputs),
    engineVersion,
    filled: outcome.filled,
    // GeoIP comes from nginx, never from the body. A player cannot pick a country,
    // and nothing here makes a runtime call to a third party to find one.
    countryCode: req.headers.get("x-country-code")?.trim() || null,
    countryName: req.headers.get("x-country-name")?.trim() || null,
    ipHash,
  };

  try {
    const result = submitRun(run);
    const payload: SubmitResponse = { ok: true, score: outcome.score, ...result };
    return new Response(JSON.stringify(payload), { headers: JSON_HEADERS });
  } catch (err) {
    console.error("[grainsnake] submit failed", err);
    return fail(503, "unavailable");
  }
}
