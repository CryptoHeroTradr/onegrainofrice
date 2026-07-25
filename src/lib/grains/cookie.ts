/**
 * Grains game — signed `grain_vid` visitor cookie (shared by the WS server and
 * the Phase 3 session route so both sign/verify identically).
 *
 * Format: `<vid>.<sig>` where sig = base64url(HMAC-SHA256(vid, GRAINS_COOKIE_SECRET)).
 * The vid itself is opaque (minted by the Phase 3 session route). The signature
 * lets the WS server trust a vid presented in a cookie without a DB round-trip
 * and without being able to be forged by a client that lacks the secret.
 *
 * SERVER-ONLY (reads GRAINS_COOKIE_SECRET). Never import into client code.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getGrainsEnv } from "./env";

export const VID_COOKIE_NAME = "grain_vid";

function sign(vid: string): Buffer {
  const { cookieSecret } = getGrainsEnv();
  return createHmac("sha256", cookieSecret).update(vid).digest();
}

/** Produce the signed cookie value `<vid>.<sig>` for a given vid. */
export function signVid(vid: string): string {
  return `${vid}.${sign(vid).toString("base64url")}`;
}

/**
 * Verify a signed cookie value and return the vid if the signature is valid,
 * else null. Constant-time comparison. Does NOT mint a vid — callers that get
 * null must send the client to the session route first.
 */
export function verifyVid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot >= raw.length - 1) return null;

  const vid = raw.slice(0, dot);
  const provided = raw.slice(dot + 1);

  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(provided, "base64url");
  } catch {
    return null;
  }

  const expected = sign(vid);
  if (providedBuf.length !== expected.length) return null;
  return timingSafeEqual(providedBuf, expected) ? vid : null;
}

/** Parse a raw `Cookie:` header into a name→value map (values URL-decoded). */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    // Strip optional surrounding quotes, then URL-decode.
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw value if it isn't valid percent-encoding */
    }
    out[name] = value;
  }
  return out;
}

/** Convenience: pull + verify the grain_vid from a raw Cookie header. */
export function readVidFromCookieHeader(header: string | null | undefined): string | null {
  return verifyVid(parseCookieHeader(header)[VID_COOKIE_NAME]);
}
