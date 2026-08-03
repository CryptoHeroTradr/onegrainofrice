/**
 * Grains visitor session route: GET/POST /onegrainofrice/grains/session.
 *
 * Ensures the caller has a signed `grain_vid` cookie. If a valid one is already
 * present it is left untouched; otherwise a fresh UUID is minted, signed with
 * GRAINS_COOKIE_SECRET (shared cookie helper), and set as an httpOnly,
 * SameSite=Lax cookie with a long lifetime. The client hook calls this BEFORE
 * opening the WebSocket so the upgrade request carries a valid cookie (the WS
 * server rejects unsigned connections rather than minting one).
 *
 * Node runtime (uses node:crypto via the cookie helper). Never cached.
 */

import { randomUUID } from "node:crypto";
import { BASE_PATH } from "@/lib/basePath";
import {
  VID_COOKIE_NAME,
  signVid,
  parseCookieHeader,
  verifyVid,
} from "@/lib/grains/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cookie scoped to the app's basePath so it is sent on /grains and /grains/ws
// (the WS upgrade) but not to sibling apps on the same host. ~400 days (the
// browser cap); the vid is stable so returning visitors keep their grain total.
const COOKIE_PATH = BASE_PATH || "/";
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function isSecure(req: Request): boolean {
  // Behind nginx the original scheme arrives in X-Forwarded-Proto; fall back to
  // the request URL. Secure cookies are dropped over plain http (local dev).
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

function buildSetCookie(value: string, secure: boolean): string {
  const parts = [
    `${VID_COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function handle(req: Request): Response {
  const existing = verifyVid(parseCookieHeader(req.headers.get("cookie"))[VID_COOKIE_NAME]);

  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });

  if (existing) {
    return new Response(JSON.stringify({ ok: true, minted: false }), { headers });
  }

  const vid = randomUUID();
  headers.append("set-cookie", buildSetCookie(signVid(vid), isSecure(req)));
  return new Response(JSON.stringify({ ok: true, minted: true }), { headers });
}

export function GET(req: Request): Response {
  return handle(req);
}

export function POST(req: Request): Response {
  return handle(req);
}
