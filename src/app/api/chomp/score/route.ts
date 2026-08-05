/**
 * POST /api/chomp/score — submit a finished run.
 *
 * TRUSTS NOTHING FROM THE CLIENT. Every number in the body is re-checked against
 * what the game can actually produce (`@/lib/chomp/score`), the name is re-sanitized
 * and re-filtered server-side whatever the browser did to it, the country comes from
 * nginx's GeoIP header rather than the payload, and identity comes from the signed
 * `grain_vid` cookie rather than a field.
 *
 * `@/lib/chomp/score`'s header lists, by name, what this pipeline does NOT catch.
 * Read it before adding a check here, and add anything new to that list.
 *
 * The one number this route DERIVES rather than accepts is duration: the body carries
 * simulation `ticks` and the row stores `ticks * 1000 / 60`. A client-supplied
 * wall-clock duration would be a second, forgeable, un-cross-checkable field saying
 * the same thing as the first, and the engine's tick count is the authoritative
 * clock anyway.
 */

import {
  checkRate,
  hashIp,
  submitRun,
  type StoredRun,
} from "@/lib/chomp/db";
import { checkName, checkRun } from "@/lib/chomp/score";
import { decodeTrace } from "@/lib/chomp/trace";
import { getChompEnv } from "@/lib/chomp/env";
import { readVidFromCookieHeader } from "@/lib/grains/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * The client IP, as nginx forwarded it. `X-Forwarded-For` is a list and the first
 * entry is the original client; behind our own single proxy that is the only one.
 * Only ever hashed, never stored.
 */
function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip")?.trim() || null;
}

export async function POST(req: Request): Promise<Response> {
  const { maxBodyBytes } = getChompEnv();

  // Refuse an oversized body before parsing it. The trace is the only field that can
  // be large and it has its own cap in decodeTrace(); this is the outer bound so a
  // hostile body never becomes a hostile JSON.parse.
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
  // The cookie is minted and signed by /grains/session, is HttpOnly, and is scoped
  // to the basePath — so it rides along on this request and cannot be set by script.
  // No cookie means the client skipped the session call; that is a 401 with a fix,
  // not an error.
  const vid = readVidFromCookieHeader(req.headers.get("cookie"));
  if (!vid) return fail(401, "no session");

  // --- name ----------------------------------------------------------------
  const name = checkName(body.name);
  if (!name.ok) return fail(400, name.reason);

  // --- trace ---------------------------------------------------------------
  // Parsed for SHAPE only, and then stored exactly as sent. Nothing here replays it;
  // see the note in lib/chomp/score.ts about what that leaves open and why the column
  // exists before the checker does.
  const trace = decodeTrace(body.trace);
  if (!trace.ok) return fail(400, trace.reason);

  // --- the run's own numbers ----------------------------------------------
  const claim = {
    score: Number(body.score),
    level: Number(body.level),
    startLevel: Number(body.startLevel),
    ticks: Number(body.ticks),
    grains: Number(body.grains),
    golden: Number(body.golden),
    pests: Number(body.pests),
    bonuses: Number(body.bonuses),
  };
  const verdict = checkRun(claim);
  if (!verdict.ok) return fail(422, verdict.reason);

  // The last input cannot land after the run ended. Cheap, and it is the only place
  // the trace and the claimed duration are cross-checked at all.
  if (trace.lastTick > claim.ticks) return fail(422, "trace outlasts the run");

  const seed = Number(body.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return fail(400, "bad seed");

  // --- rate limit ----------------------------------------------------------
  const ipHash = hashIp(clientIp(req));
  try {
    const rate = checkRate(vid, ipHash);
    if (!rate.ok) return fail(429, "too many runs — take a breath");
  } catch (err) {
    console.error("[chomp] rate check failed", err);
    return fail(503, "unavailable");
  }

  // --- store ---------------------------------------------------------------
  const run: StoredRun = {
    vid,
    name: name.name,
    score: claim.score,
    level: claim.level,
    grains: claim.grains,
    golden: claim.golden,
    pests: claim.pests,
    bonuses: claim.bonuses,
    ticks: claim.ticks,
    seed,
    trace: typeof body.trace === "string" ? body.trace : "",
    // GeoIP comes from nginx, never from the body. A player cannot pick a country.
    countryCode: req.headers.get("x-country-code")?.trim() || null,
    countryName: req.headers.get("x-country-name")?.trim() || null,
    ipHash,
  };

  try {
    const result = submitRun(run);
    return new Response(JSON.stringify({ ok: true, ...result }), { headers: JSON_HEADERS });
  } catch (err) {
    console.error("[chomp] submit failed", err);
    return fail(503, "unavailable");
  }
}
