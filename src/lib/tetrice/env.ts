/**
 * TETRICE leaderboard — server-only env access + tunables.
 *
 * Mirrors `src/lib/grainsnake/env.ts`, which mirrors `src/lib/chomp/env.ts`, and the
 * mirroring is the point: the next person to read any of the three already knows this
 * one. Like both of them it **requires no new secrets** — identity is the same signed
 * `grain_vid` cookie the grains game mints, so the cookie secret and the IP salt are read
 * through `getGrainsEnv()` rather than duplicated under a `TETRICE_` name. Two secrets for
 * one cookie is two things to rotate and one of them will be forgotten.
 *
 * SERVER-ONLY. None of these are `NEXT_PUBLIC_`.
 */

import path from "node:path";
import { getGrainsEnv } from "@/lib/grains/env";

export interface TetriceEnv {
  /** Absolute path to TETRICE's own SQLite file. Never chomp.db, never grainsnake.db. */
  dbPath: string;
  walAutocheckpoint: number;
  maxRunsPerVid: number;
  maxRunsPerIp: number;
  /** Seeds are cheaper to ask for than runs are to play, so this bucket is tighter. */
  maxStartsPerVid: number;
  maxStartsPerIp: number;
  rateWindowMs: number;
  maxBodyBytes: number;
}

const DEFAULT_WAL_AUTOCHECKPOINT = 1000;

/**
 * A run takes minutes. Six a minute is generous for a human and two orders of magnitude
 * below what a script would want; the IP cap is higher because a school, an office or a
 * phone network is one address.
 */
const DEFAULT_MAX_RUNS_PER_VID = 6;
const DEFAULT_MAX_RUNS_PER_IP = 30;

/**
 * **THE START ROUTE IS RATE-LIMITED MORE TIGHTLY THAN SUBMIT**, per the spec (*Leaderboard*):
 * it is the cheapest thing on the site to call in a loop, and calling it in a loop is the
 * exact shape of the seed-shopping attack *The randomizer* describes — request a hundred
 * seeds, evaluate each offline against the engine the client already holds, play the one
 * that deals a friendly opening.
 *
 * This does not *stop* shopping; nothing does, for a client that holds the engine. It puts
 * a floor under what it costs: at 10 per minute, evaluating a hundred candidates takes ten
 * minutes of visible, rate-limited traffic instead of one unnoticed burst. The spec's
 * load-bearing mitigation is one-live-seed-per-vid, which is NOT implemented in this phase
 * — see the amendment in *The randomizer*, which says so rather than leaving the reader to
 * infer it from a missing column.
 */
const DEFAULT_MAX_STARTS_PER_VID = 10;
const DEFAULT_MAX_STARTS_PER_IP = 40;

const DEFAULT_RATE_WINDOW_MS = 60_000;

/**
 * A submission carries a tick-indexed input log, and **its size is dominated by auto-repeat
 * rather than by the player**. The recorder writes one entry per CHANGE of the action mask
 * (`client/inputLog.ts`), and DAS/ARR emit `MoveLeft` on one frame and nothing on the next
 * — so a held direction produces roughly one entry per frame, not one per press. The
 * worst-case log is therefore one entry per tick.
 *
 * At `MAX_REPLAY_TICKS` (108,000 — see `verify.ts`) that is ~1.3 MB of JSON. 1.5 MB is that
 * bound plus the ids and the name. **The real defence is the entry cap, not this number**:
 * `content-length` is refused before the body is read, and the entry and tick caps are
 * checked before anything is simulated.
 */
const DEFAULT_MAX_BODY_BYTES = 1_500_000;

/**
 * The env var by which a process DECLARES it is the single writer of the default database
 * path. It lives in `ecosystem.config.js`'s env block for the `onegrainofrice` app —
 * deliberately NOT in `.env.local`.
 *
 * That placement is the whole mechanism: the preview server runs from the SAME working
 * directory and reads the SAME `.env.local`, so anything put there is inherited by the
 * preview and is useless as a discriminator. Only pm2's env differs between the two, so the
 * flag has to be declared there.
 */
const OWNER_FLAG = "TETRICE_DB_OWNER";

function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "tetrice.db");
}

/**
 * Resolve the database path, refusing to default into a file this process has not claimed.
 * Same guard, same reasoning as chomp's and grainsnake's — a declared flag rather than a
 * lockfile or a process scan, because **a guard that can take down production is worse than
 * the hazard it prevents**: a lockfile does not release on `SIGKILL`, and process scanning
 * cannot tell "held by live" from "held by the thing I am about to become". The worst case
 * here is a process that refuses to start with a message naming its own fix.
 */
function resolveDbPath(): string {
  const explicit = process.env.TETRICE_DB_PATH?.trim();
  if (explicit) return explicit;

  if (process.env[OWNER_FLAG]?.trim() === "1") return defaultDbPath();

  throw new Error(
    `[tetrice] Refusing to open the default database path.\n` +
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
      `        TETRICE_DB_PATH=/tmp/tetrice-preview.db <your command>\n` +
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
    throw new Error(`[tetrice] ${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

let cached: TetriceEnv | null = null;

export function getTetriceEnv(): TetriceEnv {
  if (cached) return cached;
  // Touch the grains env so a missing GRAINS_COOKIE_SECRET / GRAINS_IP_SALT fails loudly
  // here rather than deep inside a signature check.
  getGrainsEnv();
  cached = {
    dbPath: resolveDbPath(),
    walAutocheckpoint: parsePositiveInt(
      "TETRICE_WAL_AUTOCHECKPOINT",
      process.env.TETRICE_WAL_AUTOCHECKPOINT,
      DEFAULT_WAL_AUTOCHECKPOINT,
    ),
    maxRunsPerVid: parsePositiveInt(
      "TETRICE_MAX_RUNS_PER_VID",
      process.env.TETRICE_MAX_RUNS_PER_VID,
      DEFAULT_MAX_RUNS_PER_VID,
    ),
    maxRunsPerIp: parsePositiveInt(
      "TETRICE_MAX_RUNS_PER_IP",
      process.env.TETRICE_MAX_RUNS_PER_IP,
      DEFAULT_MAX_RUNS_PER_IP,
    ),
    maxStartsPerVid: parsePositiveInt(
      "TETRICE_MAX_STARTS_PER_VID",
      process.env.TETRICE_MAX_STARTS_PER_VID,
      DEFAULT_MAX_STARTS_PER_VID,
    ),
    maxStartsPerIp: parsePositiveInt(
      "TETRICE_MAX_STARTS_PER_IP",
      process.env.TETRICE_MAX_STARTS_PER_IP,
      DEFAULT_MAX_STARTS_PER_IP,
    ),
    rateWindowMs: parsePositiveInt(
      "TETRICE_RATE_WINDOW_MS",
      process.env.TETRICE_RATE_WINDOW_MS,
      DEFAULT_RATE_WINDOW_MS,
    ),
    maxBodyBytes: parsePositiveInt(
      "TETRICE_MAX_BODY_BYTES",
      process.env.TETRICE_MAX_BODY_BYTES,
      DEFAULT_MAX_BODY_BYTES,
    ),
  };
  return cached;
}

/** Test/boot hook: clears the memoized env (e.g. after mutating process.env). */
export function resetTetriceEnvCache(): void {
  cached = null;
}
