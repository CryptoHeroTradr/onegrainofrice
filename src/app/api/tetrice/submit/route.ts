/**
 * POST /api/tetrice/submit — submit a finished run.
 *
 * ── THE SCORE IS COMPUTED, NEVER ACCEPTED. THERE IS NO SCORE FIELD. ─────────────────
 * `SubmitBody` is `{ runId, engineVersion, inputLog, name }`. The handler loads the seed
 * **it stored** for that run id, replays the log through the same `step()` the browser ran,
 * and stores the score that comes out — along with the level, the lines and a duration
 * derived from the tick count. Nothing in the payload is a number about the run.
 *
 * **What this buys, precisely: it eliminates FORGED scores. It does not eliminate BOTS.**
 * The client necessarily holds the seed — it has to simulate to draw — so a headless player
 * can compute a route offline and submit a log that replays flawlessly, and it *should*
 * pass, because it is a real run of this game. The honest claim is "every score on this
 * board is the score of a real run", never "of a human".
 *
 * ── THE REJECTIONS, EACH WITH ITS OWN STATUS ────────────────────────────────────────
 * | condition | status |
 * |---|---|
 * | no session cookie | 401 |
 * | body malformed, oversized, or a bad name | 400 / 413 |
 * | unknown `engineVersion` | **409** — never rescore an old log under new rules |
 * | unknown / already-submitted / expired `runId` | **409** — a run id is single-use |
 * | log too long, or a frame index that goes backwards | **400** |
 * | replay tops out before the log ends, or ends without topping out | **422** |
 * | zero-score run | **422** |
 * | too many submissions in the window | 429 |
 *
 * The 409s are one status for one reason: all three mean *this submission can never
 * succeed, and retrying it will not help* — as against a 422, which says the log itself is
 * not a finished run. A 404 for an unknown run id would leak which ids exist.
 *
 * Everything else is trusted no more than chomp trusts it: the name is re-sanitized and
 * re-filtered server-side whatever the browser did to it, the country comes from nginx's
 * GeoIP header rather than the payload, and identity comes from the signed cookie.
 */

import {
  checkSubmitRate,
  claimRun,
  hashIp,
  submitRun,
  type StoredRun,
} from "@/lib/tetrice/db";
import { getTetriceEnv } from "@/lib/tetrice/env";
import { parseRunLog, verifyRunLog } from "@/lib/tetrice/verify";
import { ENGINE_VERSION } from "@/games/tetrice/engine/rules";
import type { SubmitResponse } from "@/lib/tetrice/wire";
// Pure text rules, no database and no state. Shared rather than duplicated on purpose: two
// profanity lists are two lists that drift, and the "share nothing with chomp" rule is
// about its DATABASE and its API namespace, neither of which this is.
import { checkName } from "@/lib/chomp/score";
import { readVidFromCookieHeader } from "@/lib/grains/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADERS });
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip")?.trim() || null;
}

export async function POST(req: Request): Promise<Response> {
  const { maxBodyBytes } = getTetriceEnv();

  // Refuse an oversized body before parsing it, so a hostile body never becomes a hostile
  // JSON.parse.
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
  const vid = readVidFromCookieHeader(req.headers.get("cookie"));
  if (!vid) return fail(401, "no session");

  // --- name ----------------------------------------------------------------
  const name = checkName(body.name);
  if (!name.ok) return fail(400, name.reason);

  // --- shape ---------------------------------------------------------------
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId || runId.length > 64) return fail(400, "bad run id");

  const engineVersion = Number(body.engineVersion);
  if (!Number.isInteger(engineVersion)) return fail(400, "bad engine version");
  // Checked here as well as inside the verifier so an old log is refused BEFORE a run id
  // is spent on it. Same status, same reason; the difference is that a player whose build
  // is stale keeps their run id.
  if (engineVersion !== ENGINE_VERSION) return fail(409, "unsupported engine version");

  const parsedLog = parseRunLog(body.inputLog);
  if (!parsedLog.ok) return fail(400, parsedLog.reason);

  // --- rate limit, BEFORE the replay ---------------------------------------
  // Replay is the expensive part of this handler — it is a simulation loop, bounded at
  // ~0.6 s of CPU by MAX_REPLAY_TICKS — so the cheap indexed counts go first. A flood
  // costs two COUNTs and no CPU.
  const ipHash = hashIp(clientIp(req));
  try {
    const rate = checkSubmitRate(vid, ipHash);
    if (!rate.ok) return fail(429, "too many runs — take a breath");
  } catch (err) {
    console.error("[tetrice] rate check failed", err);
    return fail(503, "unavailable");
  }

  // --- claim the run id ----------------------------------------------------
  // Single-use, atomically, and BEFORE the replay: a replay is CPU this process cannot
  // get back, so an id that can never succeed should not buy one.
  let claim;
  try {
    claim = claimRun(runId, vid);
  } catch (err) {
    console.error("[tetrice] claim failed", err);
    return fail(503, "unavailable");
  }
  if (!claim.ok) {
    // One message for all four cases. "Already submitted" tells a prober that an id
    // exists and that someone used it; "unknown run" tells them it does not. Neither is
    // worth telling them, and the honest client never sees this at all.
    return fail(409, "run id is not submittable");
  }

  // --- THE REPLAY. This is the verification. -------------------------------
  // The seed comes from the row this route just claimed, NOT from the log: a log carries
  // a seed field because the client needs one to replay its own run, and trusting it here
  // would make the stored seed decorative.
  const verdict = verifyRunLog({ ...parsedLog.log, seed: claim.seed }, ENGINE_VERSION);
  if (!verdict.ok) return fail(verdict.status, verdict.reason);
  const run = verdict.run;

  // --- store ---------------------------------------------------------------
  const stored: StoredRun = {
    runId,
    vid,
    name: name.name,
    // THE COMPUTED NUMBERS. Not claims — there were never any claims.
    score: run.score,
    level: run.level,
    lines: run.lines,
    ticks: run.ticks,
    durationMs: run.durationMs,
    seed: claim.seed,
    inputs: JSON.stringify(parsedLog.log.entries),
    engineVersion,
    // GeoIP comes from nginx, never from the body. A player cannot pick a country, and
    // nothing here makes a runtime call to a third party to find one.
    countryCode: req.headers.get("x-country-code")?.trim() || null,
    countryName: req.headers.get("x-country-name")?.trim() || null,
    ipHash,
  };

  try {
    const result = submitRun(stored);
    // Built field by field rather than spread: `result.rowId` is this database's primary
    // key and stays off the wire. The client already knows its run id and has no use for
    // an internal row number.
    const payload: SubmitResponse = {
      ok: true,
      score: run.score,
      level: run.level,
      lines: run.lines,
      durationMs: run.durationMs,
      best: result.best,
      improved: result.improved,
      rank: result.rank,
      duplicate: result.duplicate,
    };
    return new Response(JSON.stringify(payload), { headers: JSON_HEADERS });
  } catch (err) {
    console.error("[tetrice] submit failed", err);
    return fail(503, "unavailable");
  }
}
