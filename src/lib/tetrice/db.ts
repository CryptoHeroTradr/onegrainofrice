/**
 * TETRICE leaderboard — SQLite persistence.
 *
 * Structurally a copy of `src/lib/grainsnake/db.ts`, which is itself a copy of
 * `src/lib/chomp/db.ts` — lazy singleton, WAL, one idempotent `migrate()` on open,
 * `PRAGMA table_info` guards for anything additive, one `handle.transaction(...)` per
 * multi-table write. Copying that shape is the point.
 *
 * ── FOUR DATABASES, FOUR SINGLE WRITERS, NOTHING SHARED ─────────────────────────────
 * `oneg-grains-ws` owns `grains.db` by explicit contract. The Next process owns
 * `chomp.db`, `grainsnake.db` AND `tetrice.db` — it is `exec_mode: fork, instances: 1`, so
 * it is a single writer of all three, and they are different files it owns outright.
 *
 * **NOTHING HERE OPENS chomp.db, grainsnake.db OR grains.db.** Not for names, not for
 * identity, not for anything. `test/tetrice-db.test.ts` asserts it by reading this source.
 *
 * SERVER-ONLY — `better-sqlite3` (native) and `node:*`. Never import from a client
 * component.
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getGrainsEnv } from "@/lib/grains/env";
import { getTetriceEnv } from "./env";
// The tick cap and its ms conversion, imported rather than re-typed: the submission
// deadline is DERIVED from the verifier's bound, and a second copy of either number is a
// second thing to update when the bound moves.
import { MAX_REPLAY_TICKS, durationMsFromTicks } from "./verify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row of the board. */
export interface TetricePlayerRow {
  name: string | null;
  best_score: number;
  best_level: number;
  /** `best_lines` sits where grainsnake's board has `best_length` (spec, *Leaderboard*). */
  best_lines: number;
  games: number;
  country_code: string | null;
  best_engine_version: number | null;
}

export interface SubmitResult {
  /** The `tetrice_runs` primary key. NOT the wire `runId`, which is the issued token —
   *  two different identifiers, so they get two different names. */
  rowId: number;
  best: number;
  improved: boolean;
  rank: number;
  duplicate: boolean;
}

// ---------------------------------------------------------------------------
// Connection (lazy singleton)
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

export function getTetriceDb(): Database.Database {
  if (db) return db;

  const { dbPath, walAutocheckpoint } = getTetriceEnv();
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

/** Test hook: drop the handle so a later call reopens at a new `TETRICE_DB_PATH`. */
export function closeTetriceDb(): void {
  db?.close();
  db = null;
}

// ---------------------------------------------------------------------------
// Schema / migration (idempotent)
// ---------------------------------------------------------------------------

function migrate(handle: Database.Database): void {
  handle.exec(`
    -- ISSUED RUNS. A row is created by /api/tetrice/start and is the ONLY place a seed
    -- ever comes from: the client cannot choose one, influence one, or submit under one
    -- this table has not seen.
    CREATE TABLE IF NOT EXISTS tetrice_seeds (
      run_id       TEXT PRIMARY KEY,
      vid          TEXT    NOT NULL,
      seed         INTEGER NOT NULL,
      issued_at    INTEGER NOT NULL,
      -- SINGLE-USE, enforced here rather than by a check the route could forget: the
      -- submit path claims a row by setting this, and the claim is a conditional UPDATE
      -- inside the same transaction as the insert. A second submission finds it set.
      submitted_at INTEGER,
      ip_hash      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tt_seeds_vid ON tetrice_seeds (vid, issued_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tt_seeds_ip  ON tetrice_seeds (ip_hash, issued_at DESC);

    -- Every accepted run. Append-only: the audit trail, and the only place the input log
    -- lives.
    CREATE TABLE IF NOT EXISTS tetrice_runs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id         TEXT    NOT NULL,
      vid            TEXT    NOT NULL,
      name           TEXT    NOT NULL,
      -- ALL FOUR ARE COMPUTED BY THE REPLAY. There is no field in the submit body for
      -- any of them, so there is nothing to compare against and nothing to forge.
      score          INTEGER NOT NULL,
      level          INTEGER NOT NULL DEFAULT 1,
      lines          INTEGER NOT NULL DEFAULT 0,
      ticks          INTEGER NOT NULL DEFAULT 0,
      -- DERIVED from ticks (ticks * 1000 / 60), never accepted from the client. The
      -- host's accumulator clamp drops wall-clock the replayer cannot see, so a
      -- client-measured duration is a different quantity, not a second view of this one.
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      seed           INTEGER NOT NULL,
      -- The input log, as submitted. Verified BEFORE it is stored.
      inputs         TEXT,
      inputs_hash    TEXT,
      -- The rules this run was played and verified under. Never re-verified, never
      -- rescored: an unknown version is refused on the way in.
      engine_version INTEGER NOT NULL,
      country_code   TEXT,
      country_name   TEXT,
      ip_hash        TEXT,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tt_runs_score   ON tetrice_runs (score DESC);
    CREATE INDEX IF NOT EXISTS idx_tt_runs_created ON tetrice_runs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tt_runs_vid     ON tetrice_runs (vid, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tt_runs_iphash  ON tetrice_runs (ip_hash, created_at DESC);
    -- Dedupe: the same player re-posting the same run (a double click, a retry after a
    -- dropped response) must not become two rows. UNIQUE makes that a database property
    -- rather than a check someone can forget to run. (The single-use runId already stops
    -- it; this is the same guarantee expressed where the data lives.)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tt_runs_dedupe ON tetrice_runs (vid, inputs_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tt_runs_runid  ON tetrice_runs (run_id);

    -- Best-per-player, denormalised so the board is ONE indexed read.
    CREATE TABLE IF NOT EXISTS tetrice_players (
      vid           TEXT PRIMARY KEY,
      display_name  TEXT,
      best_score    INTEGER NOT NULL DEFAULT 0,
      best_level    INTEGER NOT NULL DEFAULT 0,
      best_lines    INTEGER NOT NULL DEFAULT 0,
      best_run_id   INTEGER,
      games         INTEGER NOT NULL DEFAULT 0,
      country_code  TEXT,
      country_name  TEXT,
      first_seen    INTEGER,
      last_seen     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tt_players_best ON tetrice_players (best_score DESC);
  `);

  // --- additive migrations (safe to re-run) --------------------------------
  // There are none, and this is where the next one goes. The pattern is the live
  // `display_name` migration in `src/lib/grains/db.ts`: read `PRAGMA table_info`, check
  // the real column list, `ALTER TABLE ... ADD COLUMN` only if it is missing. A column
  // added AFTER the table has shipped cannot ride in the CREATE above.
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * sha256(ip + GRAINS_IP_SALT) — the same construction and salt the other games use, so
 * there is one answer to "what is this visitor's IP hash" on this box. The raw address is
 * never stored.
 *
 * Implemented here rather than imported from `@/lib/chomp/db` deliberately: that module
 * also exports `getChompDb()`, and the one thing this feature must never do is acquire a
 * handle to a database it does not own. Four lines of duplication buys the guarantee that
 * this import graph cannot reach that function.
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
 * **THE IP BUCKET IS THE REAL CEILING.** `/grains/session` mints a signed vid to anyone
 * who asks, so the per-vid limit is a speed bump; a proxy pool defeats the IP limit too.
 * Both are stated honestly rather than claimed as protection.
 */
export function checkSubmitRate(vid: string, ipHash: string | null): RateVerdict {
  const { maxRunsPerVid, maxRunsPerIp, rateWindowMs } = getTetriceEnv();
  return countWindow({
    table: "tetrice_runs",
    column: "created_at",
    vid,
    ipHash,
    since: Date.now() - rateWindowMs,
    maxVid: maxRunsPerVid,
    maxIp: maxRunsPerIp,
  });
}

/** The tighter bucket: issuing a seed is the cheapest call on the site (see `env.ts`). */
export function checkStartRate(vid: string, ipHash: string | null): RateVerdict {
  const { maxStartsPerVid, maxStartsPerIp, rateWindowMs } = getTetriceEnv();
  return countWindow({
    table: "tetrice_seeds",
    column: "issued_at",
    vid,
    ipHash,
    since: Date.now() - rateWindowMs,
    maxVid: maxStartsPerVid,
    maxIp: maxStartsPerIp,
  });
}

function countWindow(q: {
  table: "tetrice_runs" | "tetrice_seeds";
  column: "created_at" | "issued_at";
  vid: string;
  ipHash: string | null;
  since: number;
  maxVid: number;
  maxIp: number;
}): RateVerdict {
  const handle = getTetriceDb();
  // The table and column names are literals from this module's own union types, never
  // caller strings — the values are still bound parameters.
  const byVid = handle
    .prepare(`SELECT COUNT(*) AS n FROM ${q.table} WHERE vid = ? AND ${q.column} >= ?`)
    .get(q.vid, q.since) as { n: number };
  if (byVid.n >= q.maxVid) return { ok: false, scope: "vid" };

  if (q.ipHash) {
    const byIp = handle
      .prepare(`SELECT COUNT(*) AS n FROM ${q.table} WHERE ip_hash = ? AND ${q.column} >= ?`)
      .get(q.ipHash, q.since) as { n: number };
    if (byIp.n >= q.maxIp) return { ok: false, scope: "ip" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// The run lifecycle
// ---------------------------------------------------------------------------

export interface IssuedRun {
  runId: string;
  seed: number;
  issuedAt: number;
}

/**
 * Issue a run: a fresh id, **a seed this process generated**, and the issue time.
 *
 * The seed is 32 bits from `randomBytes`, not `Math.random()` — the engine's PRNG is
 * seeded from it and a predictable seed is a shoppable seed. The client has no input to
 * this call: there is no request body it could put a preference in.
 */
export function issueRun(vid: string, ipHash: string | null): IssuedRun {
  const runId = randomBytes(16).toString("hex");
  const seed = randomBytes(4).readUInt32BE(0);
  const issuedAt = Date.now();
  getTetriceDb()
    .prepare(
      `INSERT INTO tetrice_seeds (run_id, vid, seed, issued_at, submitted_at, ip_hash)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    )
    .run(runId, vid, seed, issuedAt, ipHash);
  return { runId, seed, issuedAt };
}

export type ClaimFailure = "unknown" | "spent" | "wrong-vid" | "expired";

export type ClaimResult =
  | { ok: true; seed: number; issuedAt: number }
  | { ok: false; why: ClaimFailure };

/**
 * How long an issued run stays submittable. **This is NOT the spec's 90 second TTL**, and
 * the difference matters enough to write down here as well as in the spec.
 *
 * *The randomizer* puts a 90 s TTL on **issuance → start**, explicitly not on issuance →
 * submission, "because a submission deadline of 90 s would reject every honest player who
 * lasted two minutes". This build has no start beacon, so it has no start event to hang
 * that TTL on — what it has is this, the spec's *other* bound: the generous one, derived
 * from the tick cap rather than invented.
 *
 * `MAX_REPLAY_TICKS / 60` is 30 minutes of play; ten minutes of slack covers a player who
 * finishes and then types a name. **Nothing here is load-bearing against seed shopping** —
 * that is the rate limit and, when it lands, one-live-seed-per-vid.
 */
export const CLAIM_TTL_MS = durationMsFromTicks(MAX_REPLAY_TICKS) + 10 * 60_000;

/**
 * Claim an issued run for submission, atomically.
 *
 * **The single-use property is a conditional UPDATE, not a read-then-write.** A read
 * followed by a write is two statements a concurrent second submission can interleave
 * with; `WHERE submitted_at IS NULL` makes "was it already spent" the same operation as
 * "spend it", and `changes === 0` is the answer.
 */
export function claimRun(runId: string, vid: string, now: number = Date.now()): ClaimResult {
  const handle = getTetriceDb();
  const row = handle
    .prepare(`SELECT vid, seed, issued_at, submitted_at FROM tetrice_seeds WHERE run_id = ?`)
    .get(runId) as
    | { vid: string; seed: number; issued_at: number; submitted_at: number | null }
    | undefined;

  if (!row) return { ok: false, why: "unknown" };
  // A run id belongs to the vid it was issued to. Reported as "unknown" to the caller —
  // see the route: telling a stranger that an id exists is telling them something.
  if (row.vid !== vid) return { ok: false, why: "wrong-vid" };
  if (row.submitted_at !== null) return { ok: false, why: "spent" };
  if (now - row.issued_at > CLAIM_TTL_MS) return { ok: false, why: "expired" };

  const info = handle
    .prepare(`UPDATE tetrice_seeds SET submitted_at = ? WHERE run_id = ? AND submitted_at IS NULL`)
    .run(now, runId);
  if (info.changes === 0) return { ok: false, why: "spent" };

  return { ok: true, seed: row.seed, issuedAt: row.issued_at };
}

/**
 * Issued-to-submitted ratio per vid — the spec's mitigation 3 (*The randomizer*), which is
 * **observability and deliberately not a block**. A player who burns forty seeds to submit
 * one run should be one query away from visible; nobody knows where the line sits, so
 * there is no threshold and nothing is refused on the strength of this.
 */
export function seedUsageByVid(sinceMs: number): Array<{ vid: string; issued: number; submitted: number }> {
  return getTetriceDb()
    .prepare(
      `SELECT vid,
              COUNT(*) AS issued,
              SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted
         FROM tetrice_seeds
        WHERE issued_at >= ?
        GROUP BY vid
        ORDER BY issued DESC`,
    )
    .all(sinceMs) as Array<{ vid: string; issued: number; submitted: number }>;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface StoredRun {
  runId: string;
  vid: string;
  name: string;
  /** THE VERIFIED SCORE — computed by the replayer, never the client's claim. */
  score: number;
  level: number;
  lines: number;
  ticks: number;
  durationMs: number;
  seed: number;
  inputs: string;
  engineVersion: number;
  countryCode: string | null;
  countryName: string | null;
  ipHash: string | null;
}

/**
 * Store a verified run and update the board, in ONE transaction — two tables that disagree
 * about a player's best score are worse than no board at all.
 */
export function submitRun(run: StoredRun): SubmitResult {
  const handle = getTetriceDb();
  const hash = inputsHash(run.seed, run.ticks, run.inputs);
  const now = Date.now();

  const tx = handle.transaction((): SubmitResult => {
    const existing = handle
      .prepare(`SELECT id FROM tetrice_runs WHERE vid = ? AND inputs_hash = ?`)
      .get(run.vid, hash) as { id: number } | undefined;

    let rowId: number;
    let duplicate = false;
    if (existing) {
      rowId = existing.id;
      duplicate = true;
    } else {
      const info = handle
        .prepare(
          `INSERT INTO tetrice_runs
             (run_id, vid, name, score, level, lines, ticks, duration_ms, seed,
              inputs, inputs_hash, engine_version, country_code, country_name,
              ip_hash, created_at)
           VALUES
             (@runId, @vid, @name, @score, @level, @lines, @ticks, @durationMs, @seed,
              @inputs, @hash, @engineVersion, @countryCode, @countryName,
              @ipHash, @now)`,
        )
        .run({ ...run, hash, now });
      rowId = Number(info.lastInsertRowid);
    }

    const prev = handle
      .prepare(`SELECT best_score FROM tetrice_players WHERE vid = ?`)
      .get(run.vid) as { best_score: number } | undefined;
    const previousBest = prev?.best_score ?? 0;
    const improved = !duplicate && run.score > previousBest;

    if (!duplicate) {
      // The name follows the LATEST submission: this game asks for a name per run, so the
      // most recent one is the player's current answer.
      handle
        .prepare(
          `INSERT INTO tetrice_players
             (vid, display_name, best_score, best_level, best_lines, best_run_id,
              games, country_code, country_name, first_seen, last_seen)
           VALUES
             (@vid, @name, @score, @level, @lines, @rowId,
              1, @countryCode, @countryName, @now, @now)
           ON CONFLICT(vid) DO UPDATE SET
             display_name = @name,
             best_score   = MAX(tetrice_players.best_score, @score),
             best_level   = CASE WHEN @score > tetrice_players.best_score
                                 THEN @level ELSE tetrice_players.best_level END,
             best_lines   = CASE WHEN @score > tetrice_players.best_score
                                 THEN @lines ELSE tetrice_players.best_lines END,
             best_run_id  = CASE WHEN @score > tetrice_players.best_score
                                 THEN @rowId ELSE tetrice_players.best_run_id END,
             games        = tetrice_players.games + 1,
             country_code = COALESCE(excluded.country_code, tetrice_players.country_code),
             country_name = COALESCE(excluded.country_name, tetrice_players.country_name),
             last_seen    = @now`,
        )
        .run({ ...run, rowId, now });
    }

    const best = Math.max(previousBest, duplicate ? previousBest : run.score);
    return { rowId, best, improved, rank: playerRank(handle, run.vid), duplicate };
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
      `SELECT COUNT(*) AS n FROM tetrice_players
        WHERE best_score > (SELECT best_score FROM tetrice_players WHERE vid = ?)`,
    )
    .get(vid) as { n: number } | undefined;
  const me = handle.prepare(`SELECT 1 FROM tetrice_players WHERE vid = ?`).get(vid);
  return me ? (row?.n ?? 0) + 1 : 0;
}

/**
 * THE board query, and the only one. One indexed read plus a primary-key lookup.
 *
 * The LEFT JOIN carries the engine version of the run being shown, exactly as grainsnake's
 * does and for the same reason: the board can hold rows from several engine versions at
 * once (spec, *Anti-cheat*: "it will"), and a row has to be able to say which rules it was
 * played under. LEFT, not INNER — **missing is not the same as old**, and a player whose
 * best run row has somehow gone still appears, unlabelled.
 *
 * NOTHING HERE RECOMPUTES OR MIGRATES ANYTHING. No stored score is read except to show it,
 * no row is written, and no run is re-verified. Verification happened once, at submit time.
 */
export function getTopPlayers(n: number): TetricePlayerRow[] {
  const limit = Math.max(0, Math.floor(n));
  return getTetriceDb()
    .prepare(
      `SELECT p.display_name AS name, p.best_score, p.best_level, p.best_lines,
              p.games, p.country_code,
              r.engine_version AS best_engine_version
         FROM tetrice_players p
         LEFT JOIN tetrice_runs r ON r.id = p.best_run_id
        WHERE p.best_score > 0
        ORDER BY p.best_score DESC, p.last_seen ASC
        LIMIT ?`,
    )
    .all(limit) as TetricePlayerRow[];
}

export interface YouRow {
  name: string | null;
  best: number;
  bestLevel: number;
  bestLines: number;
  games: number;
  rank: number;
}

/** This player's own row, whether or not they are on the visible board. */
export function getYou(vid: string): YouRow | null {
  const handle = getTetriceDb();
  const row = handle
    .prepare(
      `SELECT display_name, best_score, best_level, best_lines, games
         FROM tetrice_players WHERE vid = ?`,
    )
    .get(vid) as
    | {
        display_name: string | null;
        best_score: number;
        best_level: number;
        best_lines: number;
        games: number;
      }
    | undefined;
  if (!row) return null;
  return {
    name: row.display_name,
    best: row.best_score,
    bestLevel: row.best_level,
    bestLines: row.best_lines,
    games: row.games,
    rank: playerRank(handle, vid),
  };
}
