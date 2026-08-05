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

/**
 * The env var by which a process DECLARES it is the single writer of the default
 * database path. It lives in `ecosystem.config.js`'s env block for the
 * `onegrainofrice` app — deliberately NOT in `.env.local`.
 *
 * That placement is the whole mechanism, so it is worth being explicit about why:
 * the preview server runs from the SAME working directory and reads the SAME
 * `.env.local` as the live process. Anything put in `.env.local` is therefore
 * inherited by the preview, which makes it useless as a discriminator. The only
 * thing that genuinely differs between the two is what pm2 injects, so the flag
 * has to be declared there.
 */
const OWNER_FLAG = "CHOMP_DB_OWNER";

function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "chomp.db");
}

/**
 * Resolve the database path, refusing to default into a file this process has not
 * claimed.
 *
 * **The hazard.** `data/chomp.db` has exactly one legitimate writer. Until this
 * guard existed that was enforced by remembering to set `CHOMP_DB_PATH` on any
 * second copy of the app — which is a habit, not a guard, and the grains WS
 * process's identical single-writer contract is protected by a test while this one
 * was protected by discipline. SQLite does not help: two writers on a WAL database
 * both appear to work, right up until they do not.
 *
 * **Why an explicit flag and not detection.** Two alternatives were considered and
 * rejected, and the reasoning is the general standard rather than a detail of this
 * feature (it is now in the spec's *Hard constraints*):
 *
 *  - *Scan for another process holding the file.* Linux-only, racy, and the
 *    database opens lazily on the first request rather than at boot, so the
 *    detection window is real. It also cannot tell "held by live" apart from
 *    "held by the thing I am about to become".
 *  - *Take an advisory lock.* Node has no `flock` in core, so this needs either a
 *    new dependency (the spec forbids them) or a lockfile — and a lockfile does not
 *    release on `SIGKILL` or a hard reboot, so a crash would leave the LIVE process
 *    refusing to start. **A guard that can take down production is worse than the
 *    hazard it prevents.**
 *
 * A declared flag has neither failure mode. The worst case is a process that
 * refuses to start with a message naming its own fix.
 *
 * **What this does not catch:** two pm2 apps both handed `CHOMP_DB_OWNER=1`. That
 * is a deliberate edit, visible in an `ecosystem.config.js` diff, directly beneath
 * the comment explaining why it is wrong.
 */
function resolveDbPath(): string {
  // An explicit path is always honoured and asks no questions. A caller who named
  // a file has, by naming it, taken responsibility for which file it is — that
  // covers the preview server, the test suite and any script.
  const explicit = process.env.CHOMP_DB_PATH?.trim();
  if (explicit) return explicit;

  if (process.env[OWNER_FLAG]?.trim() === "1") return defaultDbPath();

  throw new Error(
    `[chomp] Refusing to open the default database path.\n` +
      `\n` +
      `  ${defaultDbPath()}\n` +
      `\n` +
      `This process has not declared itself that file's owner, and the file has exactly\n` +
      `ONE legitimate writer: the pm2 app "onegrainofrice". A second writer is the exact\n` +
      `failure the two-database design exists to prevent, and nothing else will stop it —\n` +
      `SQLite lets both processes appear to work.\n` +
      `\n` +
      `Fix, depending on which you are:\n` +
      `\n` +
      `  * A PREVIEW, a script, or any second copy on this box — name your own file:\n` +
      `        CHOMP_DB_PATH=/tmp/chomp-preview.db <your command>\n` +
      `    (deploy/preview.sh does this for you)\n` +
      `\n` +
      `  * THE LIVE PROCESS — set ${OWNER_FLAG}=1 in ecosystem.config.js's env block for\n` +
      `    "onegrainofrice". It does NOT go in .env.local: the preview shares that file,\n` +
      `    so a flag placed there would be inherited by the very process this guards\n` +
      `    against.\n`,
  );
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
    dbPath: resolveDbPath(),
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
