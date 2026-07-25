/**
 * Grains game — server-only env access + validation.
 *
 * The app has no shared env-validation library (values are read ad-hoc from
 * process.env with `??` defaults). This module is the equivalent for the
 * `GRAINS_*` vars: it reads them once, applies safe defaults, and throws for the
 * two required secrets so misconfiguration fails loud at boot rather than
 * silently hashing with an empty salt.
 *
 * SERVER-ONLY. None of these are `NEXT_PUBLIC_`; importing this into client code
 * would leak the salt/cookie secret into the browser bundle. Only import from
 * route handlers, the WS server, and server `lib/` modules.
 */

import path from "node:path";

export interface GrainsEnv {
  /** Absolute path to the SQLite file. */
  dbPath: string;
  /** Port the realtime WS server listens on (Phase 2+). */
  wsPort: number;
  /** Secret salt mixed into the sha256 IP hash stored at rest. Required. */
  ipSalt: string;
  /** Secret used to sign the `grain_vid` visitor cookie. Required. */
  cookieSecret: string;
  /** Server-side clamp: max grains counted per visitor per second. */
  maxPerSec: number;
  /** Abuse cap: max simultaneous WS connections sharing one IP hash. */
  maxConnPerIp: number;
}

// Sensible defaults for the non-secret knobs.
const DEFAULT_WS_PORT = 3007;
const DEFAULT_MAX_PER_SEC = 20;
const DEFAULT_MAX_CONN_PER_IP = 8;
// Secrets shorter than this are almost certainly a placeholder/typo, not a real
// 32+ char secret. We warn rather than hard-fail on length so local dev with a
// short throwaway value still runs, but presence is mandatory.
const MIN_SECRET_LEN = 32;

function defaultDbPath(): string {
  // The VPS sets GRAINS_DB_PATH to an absolute, backup-scoped path. When unset
  // (dev / scripts), fall back to <cwd>/data/grains.db.
  return path.join(process.cwd(), "data", "grains.db");
}

function requireSecret(name: string, value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) {
    throw new Error(
      `[grains] Missing required secret ${name}. Set it in .env.local / the ` +
        `pm2 env (a random 32+ char string). It is never exposed to the client.`,
    );
  }
  if (v.length < MIN_SECRET_LEN) {
    // Loud but non-fatal: a short secret still "works" but is weak.
    console.warn(
      `[grains] ${name} is only ${v.length} chars; use a random 32+ char secret.`,
    );
  }
  return v;
}

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[grains] ${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

let cached: GrainsEnv | null = null;

/**
 * Read + validate the GRAINS_* env once (memoized). Throws if either secret is
 * missing. Call this at server boot (and it is called lazily by the DB module's
 * hashing/cookie helpers) so problems surface immediately.
 */
export function getGrainsEnv(): GrainsEnv {
  if (cached) return cached;
  cached = {
    dbPath: (process.env.GRAINS_DB_PATH?.trim() || defaultDbPath()),
    wsPort: parsePositiveInt("GRAINS_WS_PORT", process.env.GRAINS_WS_PORT, DEFAULT_WS_PORT),
    ipSalt: requireSecret("GRAINS_IP_SALT", process.env.GRAINS_IP_SALT),
    cookieSecret: requireSecret("GRAINS_COOKIE_SECRET", process.env.GRAINS_COOKIE_SECRET),
    maxPerSec: parsePositiveInt("GRAINS_MAX_PER_SEC", process.env.GRAINS_MAX_PER_SEC, DEFAULT_MAX_PER_SEC),
    maxConnPerIp: parsePositiveInt(
      "GRAINS_MAX_CONN_PER_IP",
      process.env.GRAINS_MAX_CONN_PER_IP,
      DEFAULT_MAX_CONN_PER_IP,
    ),
  };
  return cached;
}

/** Test/boot hook: clears the memoized env (e.g. after mutating process.env). */
export function resetGrainsEnvCache(): void {
  cached = null;
}
