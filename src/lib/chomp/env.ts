/**
 * RICE CHOMP leaderboard — server-only env access + tunables.
 *
 * Mirrors `src/lib/grains/env.ts`: read once, memoize, apply safe defaults. The
 * one deliberate difference is that this module REQUIRES NO NEW SECRETS.
 *
 * Identity here is the same signed `grain_vid` cookie the grains game mints, so
 * the cookie secret and the IP salt are read through `getGrainsEnv()` rather than
 * duplicated under a `CHOMP_` name. Two secrets for one cookie is two things to
 * rotate and one of them will be forgotten.
 *
 * SERVER-ONLY. None of these are `NEXT_PUBLIC_`. Only import from route handlers
 * and server `lib/` modules.
 */

import path from "node:path";
import { getGrainsEnv } from "@/lib/grains/env";

export interface ChompEnv {
  /** Absolute path to RICE CHOMP's own SQLite file. Never grains.db. */
  dbPath: string;
  /**
   * Pages of WAL allowed to accumulate before SQLite checkpoints. Set EXPLICITLY
   * rather than inherited: the grains WAL sits permanently at ~4 MB because that
   * is exactly SQLite's default (1000 pages × 4096 + framing), which took a
   * measurement to establish and briefly looked like a leak. The ceiling for this
   * database is a decision on the record. See docs/rice-chomp-plan.md §4.2.
   */
  walAutocheckpoint: number;
  /** Max accepted submissions per vid inside the rate-limit window. */
  maxRunsPerVid: number;
  /** Max accepted submissions per IP hash inside the same window. NAT/households. */
  maxRunsPerIp: number;
  /** The rate-limit window, in milliseconds. */
  rateWindowMs: number;
  /** Hard cap on a submitted body, in bytes. Anything larger is refused unread. */
  maxBodyBytes: number;
}

const DEFAULT_WAL_AUTOCHECKPOINT = 1000;
/**
 * A run takes minutes; six a minute is already generous for a human and is two
 * orders of magnitude below what a script would want. The IP cap is higher because
 * a school, an office or a phone network is one address.
 */
const DEFAULT_MAX_RUNS_PER_VID = 6;
const DEFAULT_MAX_RUNS_PER_IP = 30;
const DEFAULT_RATE_WINDOW_MS = 60_000;
/**
 * A ten-minute run turning at four junctions a second is ~2,400 trace entries at
 * three or four characters each — call it 10 KB. 64 KB is comfortable headroom and
 * still small enough that a flood of them costs nothing.
 */
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

function defaultDbPath(): string {
  // The VPS may set CHOMP_DB_PATH to an absolute, backup-scoped path. Unset (dev,
  // scripts, and in fact production today) it lands beside grains.db — a SEPARATE
  // file, which is the whole point: two databases, one writer each.
  return path.join(process.cwd(), "data", "chomp.db");
}

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[chomp] ${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

let cached: ChompEnv | null = null;

export function getChompEnv(): ChompEnv {
  if (cached) return cached;
  // Touch the grains env so a missing GRAINS_COOKIE_SECRET / GRAINS_IP_SALT fails
  // loudly here, at the first leaderboard request, rather than deep inside a
  // signature check that would just read as "your cookie is invalid".
  getGrainsEnv();
  cached = {
    dbPath: process.env.CHOMP_DB_PATH?.trim() || defaultDbPath(),
    walAutocheckpoint: parsePositiveInt(
      "CHOMP_WAL_AUTOCHECKPOINT",
      process.env.CHOMP_WAL_AUTOCHECKPOINT,
      DEFAULT_WAL_AUTOCHECKPOINT,
    ),
    maxRunsPerVid: parsePositiveInt(
      "CHOMP_MAX_RUNS_PER_VID",
      process.env.CHOMP_MAX_RUNS_PER_VID,
      DEFAULT_MAX_RUNS_PER_VID,
    ),
    maxRunsPerIp: parsePositiveInt(
      "CHOMP_MAX_RUNS_PER_IP",
      process.env.CHOMP_MAX_RUNS_PER_IP,
      DEFAULT_MAX_RUNS_PER_IP,
    ),
    rateWindowMs: parsePositiveInt(
      "CHOMP_RATE_WINDOW_MS",
      process.env.CHOMP_RATE_WINDOW_MS,
      DEFAULT_RATE_WINDOW_MS,
    ),
    maxBodyBytes: parsePositiveInt(
      "CHOMP_MAX_BODY_BYTES",
      process.env.CHOMP_MAX_BODY_BYTES,
      DEFAULT_MAX_BODY_BYTES,
    ),
  };
  return cached;
}

/** Test/boot hook: clears the memoized env (e.g. after mutating process.env). */
export function resetChompEnvCache(): void {
  cached = null;
}
