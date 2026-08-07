/**
 * GRAINSNAKE leaderboard — server-only env access + tunables.
 *
 * Mirrors `src/lib/chomp/env.ts` exactly, and the mirroring is the point: the next
 * person to read either file already knows this one. Like chomp's, it REQUIRES NO NEW
 * SECRETS — identity is the same signed `grain_vid` cookie the grains game mints, so
 * the cookie secret and the IP salt are read through `getGrainsEnv()` rather than
 * duplicated under a `GRAINSNAKE_` name. Two secrets for one cookie is two things to
 * rotate and one of them will be forgotten.
 *
 * SERVER-ONLY. None of these are `NEXT_PUBLIC_`.
 */

import path from "node:path";
import { getGrainsEnv } from "@/lib/grains/env";

export interface GrainsnakeEnv {
  /** Absolute path to GRAINSNAKE's own SQLite file. Never chomp.db, never grains.db. */
  dbPath: string;
  walAutocheckpoint: number;
  maxRunsPerVid: number;
  maxRunsPerIp: number;
  rateWindowMs: number;
  maxBodyBytes: number;
}

const DEFAULT_WAL_AUTOCHECKPOINT = 1000;
/**
 * A run takes minutes. Six a minute is generous for a human and two orders of
 * magnitude below what a script would want; the IP cap is higher because a school,
 * an office or a phone network is one address.
 */
const DEFAULT_MAX_RUNS_PER_VID = 6;
const DEFAULT_MAX_RUNS_PER_IP = 30;
const DEFAULT_RATE_WINDOW_MS = 60_000;
/**
 * A submission carries an input log, and a snake's log is one entry per TURN rather
 * than per tick — a long run is a few thousand `{tick,dir}` pairs, call it 40 KB.
 * 128 KB is comfortable headroom and still small enough that a flood costs nothing.
 * The replayer additionally caps ticks and entries before simulating anything.
 */
const DEFAULT_MAX_BODY_BYTES = 128 * 1024;

/**
 * The env var by which a process DECLARES it is the single writer of the default
 * database path. It lives in `ecosystem.config.js`'s env block for the
 * `onegrainofrice` app — deliberately NOT in `.env.local`.
 *
 * That placement is the whole mechanism: the preview server runs from the SAME
 * working directory and reads the SAME `.env.local`, so anything put there is
 * inherited by the preview and is useless as a discriminator. Only pm2's env differs
 * between the two, so the flag has to be declared there.
 */
const OWNER_FLAG = "GRAINSNAKE_DB_OWNER";

function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "grainsnake.db");
}

/**
 * Resolve the database path, refusing to default into a file this process has not
 * claimed. Same guard, same reasoning as chomp's — a declared flag rather than a
 * lockfile or a process scan, because **a guard that can take down production is
 * worse than the hazard it prevents**: a lockfile does not release on `SIGKILL`, and
 * process scanning cannot tell "held by live" from "held by the thing I am about to
 * become". The worst case here is a process that refuses to start with a message
 * naming its own fix.
 */
function resolveDbPath(): string {
  const explicit = process.env.GRAINSNAKE_DB_PATH?.trim();
  if (explicit) return explicit;

  if (process.env[OWNER_FLAG]?.trim() === "1") return defaultDbPath();

  throw new Error(
    `[grainsnake] Refusing to open the default database path.\n` +
      `\n` +
      `  ${defaultDbPath()}\n` +
      `\n` +
      `This process has not declared itself that file's owner, and the file has exactly\n` +
      `ONE legitimate writer: the pm2 app "onegrainofrice". A second writer is the exact\n` +
      `failure the separate-database design exists to prevent, and nothing else will\n` +
      `stop it — SQLite lets both processes appear to work.\n` +
      `\n` +
      `Fix, depending on which you are:\n` +
      `\n` +
      `  * A PREVIEW, a script, or any second copy on this box — name your own file:\n` +
      `        GRAINSNAKE_DB_PATH=/tmp/grainsnake-preview.db <your command>\n` +
      `\n` +
      `  * THE LIVE PROCESS — set ${OWNER_FLAG}=1 in ecosystem.config.js's env block for\n` +
      `    "onegrainofrice", then:\n` +
      `        pm2 restart ecosystem.config.js --only onegrainofrice --update-env\n` +
      `        pm2 save\n` +
      `    It does NOT go in .env.local: the preview shares that file, so a flag placed\n` +
      `    there would be inherited by the very process this guards against.\n`,
  );
}

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[grainsnake] ${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

let cached: GrainsnakeEnv | null = null;

export function getGrainsnakeEnv(): GrainsnakeEnv {
  if (cached) return cached;
  // Touch the grains env so a missing GRAINS_COOKIE_SECRET / GRAINS_IP_SALT fails
  // loudly here rather than deep inside a signature check.
  getGrainsEnv();
  cached = {
    dbPath: resolveDbPath(),
    walAutocheckpoint: parsePositiveInt(
      "GRAINSNAKE_WAL_AUTOCHECKPOINT",
      process.env.GRAINSNAKE_WAL_AUTOCHECKPOINT,
      DEFAULT_WAL_AUTOCHECKPOINT,
    ),
    maxRunsPerVid: parsePositiveInt(
      "GRAINSNAKE_MAX_RUNS_PER_VID",
      process.env.GRAINSNAKE_MAX_RUNS_PER_VID,
      DEFAULT_MAX_RUNS_PER_VID,
    ),
    maxRunsPerIp: parsePositiveInt(
      "GRAINSNAKE_MAX_RUNS_PER_IP",
      process.env.GRAINSNAKE_MAX_RUNS_PER_IP,
      DEFAULT_MAX_RUNS_PER_IP,
    ),
    rateWindowMs: parsePositiveInt(
      "GRAINSNAKE_RATE_WINDOW_MS",
      process.env.GRAINSNAKE_RATE_WINDOW_MS,
      DEFAULT_RATE_WINDOW_MS,
    ),
    maxBodyBytes: parsePositiveInt(
      "GRAINSNAKE_MAX_BODY_BYTES",
      process.env.GRAINSNAKE_MAX_BODY_BYTES,
      DEFAULT_MAX_BODY_BYTES,
    ),
  };
  return cached;
}

/** Test/boot hook: clears the memoized env (e.g. after mutating process.env). */
export function resetGrainsnakeEnvCache(): void {
  cached = null;
}
