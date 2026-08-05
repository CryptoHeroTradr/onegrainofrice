import { NextResponse } from "next/server";
import { readJsonOr } from "@/lib/readJson";

/**
 * SERVER-SIDE ONLY. The one place this website talks to the bot's bridge.
 *
 * The shared secret lives in the server environment and is read here; nothing in this module is
 * importable from a client component without Next refusing to build it, and no handler built on it
 * ever puts the secret in a response. Same discipline as the RPC proxy and the Mini App route.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS INTERPRET. The browser holds the wallet, so the browser
 * assembles the proof; these handlers forward an already-signed body and return what the bot says.
 * A proxy that started composing signed messages on the user's behalf would be a proxy that could
 * authorise things the user never saw.
 *
 * 404 IS PASSED THROUGH, AND THAT MATTERS MORE THAN IT LOOKS. The bot ships with
 * SITE_BRIDGE_WRITES=false, so its six mutation routes are not mounted and answer 404. That status
 * is the only way the browser can tell "writes are switched off" from "the bot is broken", and the
 * dashboard renders those two very differently. Collapsing it into a 502 would turn the normal
 * production configuration into an error banner.
 */

const BOT_BRIDGE_URL = process.env.BOT_BRIDGE_URL ?? "http://127.0.0.1:3012";
const BRIDGE_SECRET = process.env.SITE_BRIDGE_SECRET ?? "";

/** The bot is on localhost. A slow reply means it is wedged, not far away. */
const TIMEOUT_MS = 6_000;

export const bridgeConfigured = (): boolean => BRIDGE_SECRET.length > 0;

export const notConfigured = (): NextResponse =>
  NextResponse.json(
    { ok: false, error: "The bot link isn't configured on this server yet." },
    { status: 503 },
  );

/**
 * Forward one call to the bridge and hand back its status and body.
 *
 * The bot's error text is written for an operator, so callers decide what (if anything) of it to
 * show a user — except where the bot's message IS the user-facing one, which is the case for a
 * refused mutation: those sentences are the Telegram panel's own words, and showing them verbatim
 * is the point of the whole "one command layer" design.
 */
export async function bridgeCall(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BOT_BRIDGE_URL}${path}`, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        "x-site-bridge-secret": BRIDGE_SECRET,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
      cache: "no-store",
    });
    const json = await readJsonOr<Record<string, unknown> | null>(res, null);
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null }; // unreachable / timed out — distinct from any bot status
  } finally {
    clearTimeout(timer);
  }
}

/** The bot could not be reached at all. Never conflated with a status the bot chose to return. */
export const unreachable = (): NextResponse =>
  NextResponse.json({ ok: false, error: "The bot isn't reachable right now." }, { status: 502 });

/**
 * Relay the bot's answer to the browser.
 *
 * The status is preserved (404 especially — see the header), and so is the bot's `error` string for
 * the statuses where that string is written for the user: a refusal explains a guard they tripped.
 */
export function relay(status: number, json: Record<string, unknown> | null): NextResponse {
  if (json === null) return unreachable();
  return NextResponse.json(json, { status });
}
