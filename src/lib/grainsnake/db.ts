/**
 * GRAINSNAKE leaderboard — SQLite persistence.
 *
 * Structurally a copy of `src/lib/chomp/db.ts`, which is itself a copy of
 * `src/lib/grains/db.ts` — lazy singleton, WAL, one idempotent `migrate()` on open,
 * `PRAGMA table_info` guards for anything additive, one `handle.transaction(...)` per
 * multi-table write. Copying that shape is the point.
 *
 * ── THREE DATABASES, THREE SINGLE WRITERS, NOTHING SHARED ───────────────────────
 * `oneg-grains-ws` owns `grains.db` by explicit contract. The Next process owns
 * `chomp.db` AND `grainsnake.db` — it is `exec_mode: fork, instances: 1`, so it is a
 * single writer of both, and they are different files it owns outright.
 *
 * **NOTHING HERE OPENS chomp.db OR grains.db.** Not for names, not for identity, not
 * for anything: this feature has no read of either. (Chomp opens `grains.db`
 * `readonly: true` for its name prefill; GRAINSNAKE does not even do that — its name
 * is client-supplied and stored here.) `test/grainsnake-db.test.ts` asserts it.
 *
 * SERVER-ONLY — `better-sqlite3` (native) and `node:*`. Never import from a client
 * component.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getGrainsEnv } from "@/lib/grains/env";
import { getGrainsnakeEnv } from "./env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row of the board. */
export interface GrainsnakePlayerRow {
  name: string;
  best_score: number;
  best_length: number;
  best_goldens: number;
  games: number;
  country_code: string | null;
  filled: number;
}

export interface SubmitResult {
  runId: number;
  best: number;
  improved: boolean;
  rank: number;
  duplicate: boolean;
}

// ---------------------------------------------------------------------------
// Connection (lazy singleton)
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

export function getGrainsnakeDb(): Database.Database {
  if (db) return db;

  const { dbPath, walAutocheckpoint } = getGrainsnakeEnv();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const handle = new Database(dbPath);
  handle.pragma("journal_mode = WAL");
  handle.pragma("synchronous = NORMAL");
  handle.pragma("foreign_keys = ON");
  handle.pragma("busy_timeout = 5000");
  // EXPLICIT, not inherited — this database's WAL ceiling is a decision on the record.
  handle.pragma(`wal_autocheckpoint = ${walAutocheckpoint}`);

  migrate(handle);

  db = handle;
  return db;
}

// ---------------------------------------------------------------------------
// Schema / migration (idempotent)
// ---------------------------------------------------------------------------

function migrate(handle: Database.Database): void {
  handle.exec(`
    -- Every accepted run. Append-only: the audit trail, the only place the input log
    -- lives, and — see the note at the bottom of this file — the ONLY source there
    -- will ever be for the death-length distribution the tier thresholds need.
    CREATE TABLE IF NOT EXISTS grainsnake_runs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      vid            TEXT    NOT NULL,
      name           TEXT    NOT NULL,
      score          INTEGER NOT NULL,
      length         INTEGER NOT NULL DEFAULT 0,
      goldens        INTEGER NOT NULL DEFAULT 0,
      food_eaten     INTEGER NOT NULL DEFAULT 0,
      ticks          INTEGER NOT NULL DEFAULT 0,
      -- DERIVED from ticks (ticks * 1000 / 60), never accepted from the client. The
      -- host's accumulator clamp drops wall-clock the replayer cannot see, so a
      -- client-measured duration is a different quantity, not a second view of this one.
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      seed           INTEGER NOT NULL DEFAULT 0,
      -- The input log, as submitted: (tick, dir) pairs. Verified BEFORE it is stored.
      inputs         TEXT,
      inputs_hash    TEXT,
      -- The rules this run was played and verified under. Never re-verified, never
      -- rescored: an unknown version is refused on the way in.
      engine_version INTEGER NOT NULL,
      filled         INTEGER NOT NULL DEFAULT 0,
      country_code   TEXT,
      country_name   TEXT,
      ip_hash        TEXT,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gs_runs_score   ON grainsnake_runs (score DESC);
    CREATE INDEX IF NOT EXISTS idx_gs_runs_created ON grainsnake_runs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gs_runs_vid     ON grainsnake_runs (vid, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gs_runs_iphash  ON grainsnake_runs (ip_hash, created_at DESC);
    -- The death-length distribution is a query over this column. Indexed so it stays one.
    CREATE INDEX IF NOT EXISTS idx_gs_runs_length  ON grainsnake_runs (length);
    -- Dedupe: the same player re-posting the same run (a double click, a retry after a
    -- dropped response) must not become two rows. UNIQUE makes that a database
    -- property rather than a check someone can forget to run.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gs_runs_dedupe ON grainsnake_runs (vid, inputs_hash);

    -- Best-per-player, denormalised so the board is ONE indexed read.
    CREATE TABLE IF NOT EXISTS grainsnake_players (
      vid           TEXT PRIMARY KEY,
      display_name  TEXT,
      best_score    INTEGER NOT NULL DEFAULT 0,
      best_length   INTEGER NOT NULL DEFAULT 0,
      -- GOLDENS IS ITS OWN COLUMN, NOT FOLDED INTO THE SCORE. Per the spec's
      -- *Scoring*: the base score is a strictly increasing function of length, so it
      -- is order-isomorphic to it — goldens are the ONLY quantity a player controls
      -- independently of how long they survived, and therefore the board's only real
      -- second axis. Hiding it inside the total wastes it.
      best_goldens  INTEGER NOT NULL DEFAULT 0,
      best_run_id   INTEGER,
      games         INTEGER NOT NULL DEFAULT 0,
      -- 1 once this player has ever filled the board. A thing nobody has done should
      -- be recognisable rather than merely numerically large.
      filled        INTEGER NOT NULL DEFAULT 0,
      country_code  TEXT,
      country_name  TEXT,
      first_seen    INTEGER,
      last_seen     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_gs_players_best ON grainsnake_players (best_score DESC);
  `);

  // --- additive migrations (safe to re-run) --------------------------------
  // There are none, and this is where the next one goes. The pattern is the live
  // `display_name` migration in `src/lib/grains/db.ts`: read `PRAGMA table_info`,
  // check the real column list, `ALTER TABLE ... ADD COLUMN` only if it is missing.
  // A column added AFTER the table has shipped cannot ride in the CREATE above.
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * sha256(ip + GRAINS_IP_SALT) — the same construction and salt the other two games
 * use, so there is one answer to "what is this visitor's IP hash" on this box. The
 * raw address is never stored.
 *
 * Implemented here rather than imported from `@/lib/chomp/db` deliberately: that
 * module also exports `getChompDb()`, and the one thing this feature must never do is
 * acquire a handle to a database it does not own. Four lines of duplication buys the
 * guarantee that this import graph cannot reach that function.
 */
export function hashIp(ip: string | null | undefined): string | null {
  const raw = (ip ?? "").trim();
  if (!raw) return null;
  const { ipSalt } = getGrainsEnv();
  return createHash("sha256").update(raw + ipSalt).digest("hex");
}

/** Stable identity of a run's inputs, for the dedupe index. */
export function inputsHash(seed: number, ticks: number, inputs: string): string {
  return createHash("sha256").update(`${seed}:${ticks}:${inputs}`).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateVerdict {
  ok: boolean;
  scope?: "vid" | "ip";
}

/**
 * Count accepted runs in the last window. Reads only — a refusal writes nothing, so a
 * flood costs two indexed counts and no disk.
 *
 * **THE IP BUCKET IS THE REAL CEILING.** `/grains/session` mints a signed vid to
 * anyone who asks, so the per-vid limit is a speed bump; a proxy pool defeats the IP
 * limit too. Both are stated honestly rather than claimed as protection.
 */
export function checkRate(vid: string, ipHash: string | null): RateVerdict {
  const { maxRunsPerVid, maxRunsPerIp, rateWindowMs } = getGrainsnakeEnv();
  const since = Date.now() - rateWindowMs;
  const handle = getGrainsnakeDb();

  const byVid = handle
    .prepare(`SELECT COUNT(*) AS n FROM grainsnake_runs WHERE vid = ? AND created_at >= ?`)
    .get(vid, since) as { n: number };
  if (byVid.n >= maxRunsPerVid) return { ok: false, scope: "vid" };

  if (ipHash) {
    const byIp = handle
      .prepare(`SELECT COUNT(*) AS n FROM grainsnake_runs WHERE ip_hash = ? AND created_at >= ?`)
      .get(ipHash, since) as { n: number };
    if (byIp.n >= maxRunsPerIp) return { ok: false, scope: "ip" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface StoredRun {
  vid: string;
  name: string;
  /** THE VERIFIED SCORE — computed by the replayer, never the client's claim. */
  score: number;
  length: number;
  goldens: number;
  foodEaten: number;
  ticks: number;
  seed: number;
  inputs: string;
  engineVersion: number;
  filled: boolean;
  countryCode: string | null;
  countryName: string | null;
  ipHash: string | null;
}

/**
 * Store a verified run and update the board, in ONE transaction — two tables that
 * disagree about a player's best score are worse than no board at all.
 */
export function submitRun(run: StoredRun): SubmitResult {
  const handle = getGrainsnakeDb();
  const hash = inputsHash(run.seed, run.ticks, run.inputs);
  const now = Date.now();
  // DERIVED, one way, here and nowhere else.
  const durationMs = Math.round((run.ticks * 1000) / 60);

  const tx = handle.transaction((): SubmitResult => {
    const existing = handle
      .prepare(`SELECT id FROM grainsnake_runs WHERE vid = ? AND inputs_hash = ?`)
      .get(run.vid, hash) as { id: number } | undefined;

    let runId: number;
    let duplicate = false;
    if (existing) {
      runId = existing.id;
      duplicate = true;
    } else {
      const info = handle
        .prepare(
          `INSERT INTO grainsnake_runs
             (vid, name, score, length, goldens, food_eaten, ticks, duration_ms, seed,
              inputs, inputs_hash, engine_version, filled, country_code, country_name,
              ip_hash, created_at)
           VALUES
             (@vid, @name, @score, @length, @goldens, @foodEaten, @ticks, @durationMs, @seed,
              @inputs, @hash, @engineVersion, @filledInt, @countryCode, @countryName,
              @ipHash, @now)`,
        )
        .run({ ...run, filledInt: run.filled ? 1 : 0, durationMs, hash, now });
      runId = Number(info.lastInsertRowid);
    }

    const prev = handle
      .prepare(`SELECT best_score FROM grainsnake_players WHERE vid = ?`)
      .get(run.vid) as { best_score: number } | undefined;
    const previousBest = prev?.best_score ?? 0;
    const improved = !duplicate && run.score > previousBest;

    if (!duplicate) {
      // The name follows the LATEST submission: this game asks for a name per run, so
      // the most recent one is the player's current answer.
      handle
        .prepare(
          `INSERT INTO grainsnake_players
             (vid, display_name, best_score, best_length, best_goldens, best_run_id,
              games, filled, country_code, country_name, first_seen, last_seen)
           VALUES
             (@vid, @name, @score, @length, @goldens, @runId,
              1, @filledInt, @countryCode, @countryName, @now, @now)
           ON CONFLICT(vid) DO UPDATE SET
             display_name = @name,
             best_score   = MAX(grainsnake_players.best_score, @score),
             best_length  = CASE WHEN @score > grainsnake_players.best_score
                                 THEN @length ELSE grainsnake_players.best_length END,
             best_goldens = CASE WHEN @score > grainsnake_players.best_score
                                 THEN @goldens ELSE grainsnake_players.best_goldens END,
             best_run_id  = CASE WHEN @score > grainsnake_players.best_score
                                 THEN @runId ELSE grainsnake_players.best_run_id END,
             games        = grainsnake_players.games + 1,
             -- Once filled, always filled: it is a lifetime achievement, not a
             -- property of the best run.
             filled       = MAX(grainsnake_players.filled, @filledInt),
             country_code = COALESCE(excluded.country_code, grainsnake_players.country_code),
             country_name = COALESCE(excluded.country_name, grainsnake_players.country_name),
             last_seen    = @now`,
        )
        .run({ ...run, filledInt: run.filled ? 1 : 0, runId, now });
    }

    const best = Math.max(previousBest, duplicate ? previousBest : run.score);
    return { runId, best, improved, rank: playerRank(handle, run.vid), duplicate };
  });

  return tx();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** COUNT(better) + 1, which keeps it on the `best_score DESC` index. */
function playerRank(handle: Database.Database, vid: string): number {
  const row = handle
    .prepare(
      `SELECT COUNT(*) AS n FROM grainsnake_players
        WHERE best_score > (SELECT best_score FROM grainsnake_players WHERE vid = ?)`,
    )
    .get(vid) as { n: number } | undefined;
  const me = handle.prepare(`SELECT 1 FROM grainsnake_players WHERE vid = ?`).get(vid);
  return me ? (row?.n ?? 0) + 1 : 0;
}

/** THE board query, and the only one. One indexed read, no filter, no post-processing. */
export function getTopPlayers(n: number): GrainsnakePlayerRow[] {
  const limit = Math.max(0, Math.floor(n));
  return getGrainsnakeDb()
    .prepare(
      `SELECT display_name AS name, best_score, best_length, best_goldens, games,
              country_code, filled
         FROM grainsnake_players
        WHERE best_score > 0
        ORDER BY best_score DESC, last_seen ASC
        LIMIT ?`,
    )
    .all(limit) as GrainsnakePlayerRow[];
}

export interface YouRow {
  name: string | null;
  best: number;
  bestLength: number;
  bestGoldens: number;
  games: number;
  rank: number;
}

/** This player's own row, whether or not they are on the visible board. */
export function getYou(vid: string): YouRow | null {
  const handle = getGrainsnakeDb();
  const row = handle
    .prepare(
      `SELECT display_name, best_score, best_length, best_goldens, games
         FROM grainsnake_players WHERE vid = ?`,
    )
    .get(vid) as
    | {
        display_name: string | null;
        best_score: number;
        best_length: number;
        best_goldens: number;
        games: number;
      }
    | undefined;
  if (!row) return null;
  return {
    name: row.display_name,
    best: row.best_score,
    bestLength: row.best_length,
    bestGoldens: row.best_goldens,
    games: row.games,
    rank: playerRank(handle, vid),
  };
}

/**
 * ── THE DEATH-LENGTH DISTRIBUTION, AND WHY THERE IS NO AGGREGATE TABLE ──────────
 * *Decided 2026-08-07, when the death path first got a server.*
 *
 * `docs/grainsnake-spec.md` (*Speed*) names this as the thing that resolves the tier
 * thresholds, and it is deliberately NOT a second table or a counter maintained on
 * write. `grainsnake_runs` is append-only and stores `length` on every accepted run,
 * indexed — so the distribution is a QUERY, not a schema:
 *
 *   SELECT length, COUNT(*) FROM grainsnake_runs GROUP BY length ORDER BY length;
 *
 * An aggregate table would be a second copy of data this one already holds, kept in
 * sync by hand, and wrong the first time someone deletes a row.
 *
 * **THE HONEST LIMIT, because it is the whole reason the card was held back once:**
 * this records SUBMITTED runs only. A player who dies and does not submit is invisible
 * here, and submission correlates with having done well — so the sample is biased
 * toward longer runs and the true distribution sits to the LEFT of this one. Closing
 * that would mean posting on every death, which is a request per death, a spam vector,
 * and a privacy decision nobody has taken. Not done, and named rather than forgotten.
 */
export function deathLengthHistogram(): Array<{ length: number; runs: number }> {
  return getGrainsnakeDb()
    .prepare(
      `SELECT length, COUNT(*) AS runs FROM grainsnake_runs GROUP BY length ORDER BY length`,
    )
    .all() as Array<{ length: number; runs: number }>;
}
