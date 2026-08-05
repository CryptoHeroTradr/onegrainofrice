/**
 * RICE CHOMP leaderboard — SQLite persistence.
 *
 * Structurally a copy of `src/lib/grains/db.ts` — lazy singleton connection, WAL,
 * one idempotent `migrate()` on open, `PRAGMA table_info` guards for anything
 * additive, one `handle.transaction(...)` per multi-table write. Copying that shape
 * is the point: the next person to read either file already knows this one.
 *
 * ── THE SINGLE-WRITER CONTRACT, AND WHY THIS IS A SECOND FILE ───────────────────
 * `oneg-grains-ws` is the sole writer of `grains.db` by explicit contract
 * (`ecosystem.config.js`: "instances: 1 — this is the sole DB writer"). RICE CHOMP
 * does not join it. The Next process is `exec_mode: fork, instances: 1` too, so it
 * is likewise a single writer — of `data/chomp.db`, a different file it owns
 * outright. Two processes, two databases, one writer each, and the grains invariant
 * is untouched rather than merely respected.
 *
 * Nothing here opens `grains.db`. The ONE place this feature reads it is
 * `src/lib/chomp/grainsName.ts`, which opens it `readonly: true` and can therefore
 * never write to it even by accident. `test/chomp-score.test.ts` asserts both halves.
 *
 * SERVER-ONLY — `better-sqlite3` (native) and `node:*`. Never import from a client
 * component.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getGrainsEnv } from "@/lib/grains/env";
import { getChompEnv } from "./env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row of the Top Players board. */
export interface ChompPlayerRow {
  name: string;
  best_score: number;
  best_level: number;
  games: number;
  country_code: string | null;
}

/** One row of the Top Countries board. */
export interface ChompCountryRow {
  code: string;
  name: string | null;
  best_score: number;
  best_name: string | null;
  games: number;
}

/** What a submit did, from the writer's point of view. */
export interface SubmitResult {
  /** The row id of the stored run. */
  runId: number;
  /** This player's best score AFTER the write. */
  best: number;
  /** Whether this run beat their previous best. */
  improved: boolean;
  /** 1-based rank on the global board, or 0 if outside it. */
  rank: number;
  /** 1-based rank of the player's country, or 0. */
  countryRank: number;
  /** True when an identical run was already stored and this call changed nothing. */
  duplicate: boolean;
}

// ---------------------------------------------------------------------------
// Connection (lazy singleton)
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

function ensureDbDir(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

export function getChompDb(): Database.Database {
  if (db) return db;

  const { dbPath, walAutocheckpoint } = getChompEnv();
  ensureDbDir(dbPath);

  const handle = new Database(dbPath);
  handle.pragma("journal_mode = WAL");
  handle.pragma("synchronous = NORMAL");
  handle.pragma("foreign_keys = ON");
  handle.pragma("busy_timeout = 5000");
  // EXPLICIT, not inherited. grains.db sits permanently at a ~4 MB WAL because that
  // is precisely SQLite's default (1000 pages), which read as a leak until it was
  // measured. Stating it here makes this database's ceiling a decision on the record.
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
    -- Every accepted run. Append-only: the audit trail, and the only place the
    -- input trace lives. The two board tables below are derived from this and could
    -- be rebuilt from it.
    CREATE TABLE IF NOT EXISTS chomp_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vid           TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      score         INTEGER NOT NULL,
      level         INTEGER NOT NULL DEFAULT 1,
      grains        INTEGER NOT NULL DEFAULT 0,
      golden        INTEGER NOT NULL DEFAULT 0,
      pests         INTEGER NOT NULL DEFAULT 0,
      bonuses       INTEGER NOT NULL DEFAULT 0,
      ticks         INTEGER NOT NULL DEFAULT 0,
      duration_ms   INTEGER NOT NULL DEFAULT 0,
      seed          INTEGER NOT NULL DEFAULT 0,
      -- The compressed input trace, STORED UNVERIFIED. See lib/chomp/score.ts for
      -- exactly what that does and does not buy; the short version is that replay
      -- verification becomes a server-only change, applied retroactively to every
      -- run stored from today.
      trace         TEXT,
      trace_hash    TEXT,
      country_code  TEXT,
      country_name  TEXT,
      ip_hash       TEXT,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chomp_runs_score   ON chomp_runs (score DESC);
    CREATE INDEX IF NOT EXISTS idx_chomp_runs_created ON chomp_runs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chomp_runs_vid     ON chomp_runs (vid, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chomp_runs_iphash  ON chomp_runs (ip_hash, created_at DESC);
    -- Dedupe: the same player re-posting the same run (a double click, a retry after
    -- a dropped response) must not become two rows. UNIQUE makes that a database
    -- property rather than a check someone can forget to run.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chomp_runs_dedupe ON chomp_runs (vid, trace_hash);

    -- Best-per-player, denormalised so the board is ONE indexed read — the same
    -- reason getTopVisitors() reads visitors.total instead of aggregating.
    CREATE TABLE IF NOT EXISTS chomp_players (
      vid           TEXT PRIMARY KEY,
      display_name  TEXT,
      best_score    INTEGER NOT NULL DEFAULT 0,
      best_level    INTEGER NOT NULL DEFAULT 1,
      best_run_id   INTEGER,
      games         INTEGER NOT NULL DEFAULT 0,
      country_code  TEXT,
      country_name  TEXT,
      first_seen    INTEGER,
      last_seen     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_chomp_players_best ON chomp_players (best_score DESC);

    -- Per-country board. RANKED BY THE COUNTRY'S BEST RUN, not by a sum of every run
    -- it ever posted: this is a score-attack game, and a sum ranks whoever played
    -- most rather than whoever played best — which is also the one thing a script can
    -- inflate without ever needing a good run. total_score is kept because it is free
    -- and answers a different question, but nothing ranks on it.
    CREATE TABLE IF NOT EXISTS chomp_countries (
      code        TEXT PRIMARY KEY,
      name        TEXT,
      best_score  INTEGER NOT NULL DEFAULT 0,
      best_vid    TEXT,
      best_name   TEXT,
      total_score INTEGER NOT NULL DEFAULT 0,
      games       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chomp_countries_best ON chomp_countries (best_score DESC);
  `);

  // --- additive migrations (safe to re-run) --------------------------------
  // `best_name` is in the CREATE TABLE above, so on a fresh database this is a
  // no-op. It is here because a column added AFTER the table has shipped cannot be,
  // and this is the pattern for it (`display_name` on grains.visitors is the live
  // example): check the real column list, never assume. Keeping one live call means
  // the next additive column is a copied line rather than a decision.
  addColumnIfMissing(handle, "chomp_countries", "best_name", "TEXT");
}

function addColumnIfMissing(
  handle: Database.Database,
  table: string,
  column: string,
  decl: string,
): void {
  const cols = handle.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * sha256(ip + GRAINS_IP_SALT), the same construction and the same salt the grains
 * game uses, so there is one answer to "what is this visitor's IP hash" on this box.
 * The raw address is never stored. Returns null for an unknown IP so the column
 * holds NULL rather than a hash of the empty string.
 *
 * Deliberately implemented here rather than imported from `@/lib/grains/db`: that
 * module also exports `getDb()`, which opens grains.db read-WRITE, and the one thing
 * this feature must never do is acquire a handle that could write it. Four lines of
 * duplication buys the guarantee that this import graph cannot reach that function.
 */
export function hashIp(ip: string | null | undefined): string | null {
  const raw = (ip ?? "").trim();
  if (!raw) return null;
  const { ipSalt } = getGrainsEnv();
  return createHash("sha256").update(raw + ipSalt).digest("hex");
}

/** Stable identity of a run's inputs, for the dedupe index. */
export function traceHash(seed: number, ticks: number, trace: string): string {
  return createHash("sha256").update(`${seed}:${ticks}:${trace}`).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateVerdict {
  ok: boolean;
  /** Which bucket refused, for the log line. Never shown to the player. */
  scope?: "vid" | "ip";
}

/**
 * Count accepted runs in the last window. Reads only — a refusal writes nothing, so
 * a flood costs two indexed counts and no disk.
 *
 * This bounds submissions, not identities: `/grains/session` mints a signed vid to
 * anyone who asks, so the vid bucket is a speed bump and the IP bucket is the real
 * ceiling. Both are stated in score.ts's "what this does not catch".
 */
export function checkRate(vid: string, ipHash: string | null): RateVerdict {
  const { maxRunsPerVid, maxRunsPerIp, rateWindowMs } = getChompEnv();
  const since = Date.now() - rateWindowMs;
  const handle = getChompDb();

  const byVid = handle
    .prepare(`SELECT COUNT(*) AS n FROM chomp_runs WHERE vid = ? AND created_at >= ?`)
    .get(vid, since) as { n: number };
  if (byVid.n >= maxRunsPerVid) return { ok: false, scope: "vid" };

  if (ipHash) {
    const byIp = handle
      .prepare(`SELECT COUNT(*) AS n FROM chomp_runs WHERE ip_hash = ? AND created_at >= ?`)
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
  score: number;
  level: number;
  grains: number;
  golden: number;
  pests: number;
  bonuses: number;
  ticks: number;
  seed: number;
  trace: string;
  countryCode: string | null;
  countryName: string | null;
  ipHash: string | null;
}

/**
 * Store a validated run and update both boards, in ONE transaction — the same shape
 * as `addGrains()`, and for the same reason: three tables that disagree about a
 * player's best score are worse than no board at all.
 */
export function submitRun(run: StoredRun): SubmitResult {
  const handle = getChompDb();
  const hash = traceHash(run.seed, run.ticks, run.trace);
  const now = Date.now();
  const durationMs = Math.round((run.ticks * 1000) / 60);

  const tx = handle.transaction((): SubmitResult => {
    // An identical resubmission is a no-op that reports the truth, not an error:
    // the client cannot tell a dropped response from a rejected one, so a retry has
    // to be safe.
    const existing = handle
      .prepare(`SELECT id FROM chomp_runs WHERE vid = ? AND trace_hash = ?`)
      .get(run.vid, hash) as { id: number } | undefined;

    let runId: number;
    let duplicate = false;
    if (existing) {
      runId = existing.id;
      duplicate = true;
    } else {
      const info = handle
        .prepare(
          `INSERT INTO chomp_runs
             (vid, name, score, level, grains, golden, pests, bonuses, ticks,
              duration_ms, seed, trace, trace_hash, country_code, country_name,
              ip_hash, created_at)
           VALUES
             (@vid, @name, @score, @level, @grains, @golden, @pests, @bonuses, @ticks,
              @durationMs, @seed, @trace, @hash, @countryCode, @countryName,
              @ipHash, @now)`,
        )
        .run({ ...run, durationMs, hash, now });
      runId = Number(info.lastInsertRowid);
    }

    const prev = handle
      .prepare(`SELECT best_score FROM chomp_players WHERE vid = ?`)
      .get(run.vid) as { best_score: number } | undefined;
    const previousBest = prev?.best_score ?? 0;
    const improved = !duplicate && run.score > previousBest;

    if (!duplicate) {
      // The player row. The name follows the LATEST submission — this game asks for
      // a name per run, so the most recent one is the player's current answer, and a
      // board that showed a name they had already replaced would be a bug.
      handle
        .prepare(
          `INSERT INTO chomp_players
             (vid, display_name, best_score, best_level, best_run_id, games,
              country_code, country_name, first_seen, last_seen)
           VALUES
             (@vid, @name, @score, @level, @runId, 1,
              @countryCode, @countryName, @now, @now)
           ON CONFLICT(vid) DO UPDATE SET
             display_name = @name,
             best_score   = MAX(chomp_players.best_score, @score),
             best_level   = CASE WHEN @score > chomp_players.best_score
                                 THEN @level ELSE chomp_players.best_level END,
             best_run_id  = CASE WHEN @score > chomp_players.best_score
                                 THEN @runId ELSE chomp_players.best_run_id END,
             games        = chomp_players.games + 1,
             country_code = COALESCE(excluded.country_code, chomp_players.country_code),
             country_name = COALESCE(excluded.country_name, chomp_players.country_name),
             last_seen    = @now`,
        )
        .run({ ...run, runId, now });

      if (run.countryCode) {
        handle
          .prepare(
            `INSERT INTO chomp_countries
               (code, name, best_score, best_vid, best_name, total_score, games)
             VALUES (@code, @cname, @score, @vid, @name, @score, 1)
             ON CONFLICT(code) DO UPDATE SET
               name        = COALESCE(excluded.name, chomp_countries.name),
               best_score  = MAX(chomp_countries.best_score, @score),
               best_vid    = CASE WHEN @score > chomp_countries.best_score
                                  THEN @vid ELSE chomp_countries.best_vid END,
               best_name   = CASE WHEN @score > chomp_countries.best_score
                                  THEN @name ELSE chomp_countries.best_name END,
               total_score = chomp_countries.total_score + @score,
               games       = chomp_countries.games + 1`,
          )
          .run({
            code: run.countryCode,
            cname: run.countryName,
            score: run.score,
            vid: run.vid,
            name: run.name,
          });
      }
    }

    const best = Math.max(previousBest, duplicate ? previousBest : run.score);
    return {
      runId,
      best,
      improved,
      rank: playerRank(handle, run.vid),
      countryRank: run.countryCode ? countryRank(handle, run.countryCode) : 0,
      duplicate,
    };
  });

  return tx();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Rank is COUNT(better) + 1 rather than a window function, which keeps it on the
 * `best_score DESC` index and works on any SQLite this ships against.
 */
function playerRank(handle: Database.Database, vid: string): number {
  const row = handle
    .prepare(
      `SELECT COUNT(*) AS n FROM chomp_players
        WHERE best_score > (SELECT best_score FROM chomp_players WHERE vid = ?)`,
    )
    .get(vid) as { n: number } | undefined;
  const me = handle.prepare(`SELECT 1 FROM chomp_players WHERE vid = ?`).get(vid);
  return me ? (row?.n ?? 0) + 1 : 0;
}

function countryRank(handle: Database.Database, code: string): number {
  const row = handle
    .prepare(
      `SELECT COUNT(*) AS n FROM chomp_countries
        WHERE best_score > (SELECT best_score FROM chomp_countries WHERE code = ?)`,
    )
    .get(code) as { n: number } | undefined;
  const me = handle.prepare(`SELECT 1 FROM chomp_countries WHERE code = ?`).get(code);
  return me ? (row?.n ?? 0) + 1 : 0;
}

export function getTopPlayers(n: number): ChompPlayerRow[] {
  const limit = Math.max(0, Math.floor(n));
  return getChompDb()
    .prepare(
      `SELECT display_name AS name, best_score, best_level, games, country_code
         FROM chomp_players
        WHERE best_score > 0
        ORDER BY best_score DESC, last_seen ASC
        LIMIT ?`,
    )
    .all(limit) as ChompPlayerRow[];
}

export function getTopCountries(n: number): ChompCountryRow[] {
  const limit = Math.max(0, Math.floor(n));
  return getChompDb()
    .prepare(
      `SELECT code, name, best_score, best_name, games
         FROM chomp_countries
        WHERE best_score > 0
        ORDER BY best_score DESC, code ASC
        LIMIT ?`,
    )
    .all(limit) as ChompCountryRow[];
}

export interface YouRow {
  name: string | null;
  best: number;
  bestLevel: number;
  games: number;
  rank: number;
  countryCode: string | null;
  countryRank: number;
}

/** This player's own row, whether or not they are on the visible board. */
export function getYou(vid: string): YouRow | null {
  const handle = getChompDb();
  const row = handle
    .prepare(
      `SELECT display_name, best_score, best_level, games, country_code
         FROM chomp_players WHERE vid = ?`,
    )
    .get(vid) as
    | {
        display_name: string | null;
        best_score: number;
        best_level: number;
        games: number;
        country_code: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    name: row.display_name,
    best: row.best_score,
    bestLevel: row.best_level,
    games: row.games,
    rank: playerRank(handle, vid),
    countryCode: row.country_code,
    countryRank: row.country_code ? countryRank(handle, row.country_code) : 0,
  };
}
