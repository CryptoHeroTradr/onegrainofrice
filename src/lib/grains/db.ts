/**
 * Grains game — SQLite persistence foundation (Phase 1).
 *
 * Self-contained data module: opens the SQLite DB in WAL mode, idempotently
 * creates the schema on first import, and exposes pure, typed data functions
 * (no HTTP). The realtime WS server (Phase 2+) and any route handlers import
 * from here.
 *
 * SERVER-ONLY — pulls in `better-sqlite3` (native) and `node:*`. Never import
 * from a client component. `better-sqlite3` is synchronous; every write path
 * that touches more than one row runs inside a single transaction so counters
 * stay consistent.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getGrainsEnv } from "./env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Visitor {
  vid: string;
  ip_hash: string | null;
  country_code: string | null;
  country_name: string | null;
  total: number;
  first_seen: number | null;
  last_seen: number | null;
  /** Player-chosen name; NULL ⇒ fall back to the generated rice handle. */
  display_name: string | null;
}

export interface CountryTotal {
  code: string;
  name: string | null;
  total: number;
}

export interface VisitorTotal {
  vid: string;
  country_code: string | null;
  total: number;
  /** Player-chosen name; NULL ⇒ caller falls back to the generated handle. */
  display_name: string | null;
}

/**
 * Before/after totals from a single grain write, all captured inside the same
 * transaction so milestone detection is exact and race-free. `*After = *Before +
 * accepted`. Consumed by the WS server's ticker pipeline.
 */
export interface GrainWrite {
  visitorBefore: number;
  visitorAfter: number;
  countryCode: string | null;
  countryName: string | null;
  countryBefore: number;
  countryAfter: number;
  globalBefore: number;
  globalAfter: number;
}

// ---------------------------------------------------------------------------
// Connection (lazy singleton)
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

/** Ensure the directory holding the DB file exists (created on boot if missing). */
function ensureDbDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Open (once) the SQLite database, configure WAL + sane pragmas, and run the
 * idempotent migration. Subsequent calls return the same handle.
 */
export function getDb(): Database.Database {
  if (db) return db;

  const { dbPath } = getGrainsEnv();
  ensureDbDir(dbPath);

  const handle = new Database(dbPath);
  // WAL: concurrent readers while a writer is active; big win for a game that
  // reads leaderboards constantly and writes grains frequently.
  handle.pragma("journal_mode = WAL");
  // NORMAL is the recommended durability/speed tradeoff under WAL.
  handle.pragma("synchronous = NORMAL");
  handle.pragma("foreign_keys = ON");
  // Wait instead of throwing SQLITE_BUSY if another process holds the write lock.
  handle.pragma("busy_timeout = 5000");

  migrate(handle);

  db = handle;
  return db;
}

// ---------------------------------------------------------------------------
// Schema / migration (idempotent)
// ---------------------------------------------------------------------------

function migrate(handle: Database.Database): void {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS visitors (
      vid          TEXT PRIMARY KEY,
      ip_hash      TEXT,
      country_code TEXT,
      country_name TEXT,
      total        INTEGER NOT NULL DEFAULT 0,
      first_seen   INTEGER,
      last_seen    INTEGER
    );

    CREATE TABLE IF NOT EXISTS countries (
      code  TEXT PRIMARY KEY,
      name  TEXT,
      total INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS global (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      total INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_countries_total ON countries (total DESC);
    CREATE INDEX IF NOT EXISTS idx_visitors_ip_hash ON visitors (ip_hash);
    CREATE INDEX IF NOT EXISTS idx_visitors_total ON visitors (total DESC);
  `);

  // Seed the single global row (id=1, total=0) exactly once.
  handle.prepare(`INSERT OR IGNORE INTO global (id, total) VALUES (1, 0)`).run();

  // --- additive migrations (safe to re-run) --------------------------------
  // display_name: the player's chosen leaderboard name. NULL ⇒ fall back to the
  // deterministic rice handle derived from their vid. Added after the table
  // shipped, so guard on the live column list rather than assuming.
  const cols = handle.prepare(`PRAGMA table_info(visitors)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "display_name")) {
    handle.exec(`ALTER TABLE visitors ADD COLUMN display_name TEXT`);
  }
}

// ---------------------------------------------------------------------------
// Display names
// ---------------------------------------------------------------------------

/** Longest name a player may set. */
export const MAX_NAME_LEN = 20;

/**
 * Normalise a player-supplied name: collapse whitespace, drop control chars,
 * clamp to MAX_NAME_LEN. Returns null if nothing usable is left (caller should
 * then clear the name and fall back to the generated handle).
 *
 * Server-side ONLY — never trust the client to have done this.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "") // control chars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LEN);
  return cleaned.length ? cleaned : null;
}

/**
 * Set (or clear, with null) a visitor's display name. `name` MUST already be
 * sanitized. Creates the row if the visitor somehow isn't known yet.
 */
export function setVisitorName(vid: string, name: string | null): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO visitors (vid, total, display_name, first_seen, last_seen)
       VALUES (@vid, 0, @name, @now, @now)
       ON CONFLICT(vid) DO UPDATE SET
         display_name = @name,
         last_seen    = @now`,
    )
    .run({ vid, name, now });
}


// ---------------------------------------------------------------------------
// IP hashing (salted, one-way)
// ---------------------------------------------------------------------------

/**
 * sha256(ip + GRAINS_IP_SALT) → hex. The raw IP is never stored; only this hash
 * is persisted, so the DB never holds a reversible address. Returns null for an
 * empty/unknown IP so callers can store NULL rather than a hash of "".
 */
export function hashIp(ip: string | null | undefined): string | null {
  const raw = (ip ?? "").trim();
  if (!raw) return null;
  const { ipSalt } = getGrainsEnv();
  return createHash("sha256").update(raw + ipSalt).digest("hex");
}

// ---------------------------------------------------------------------------
// Data API (pure, no HTTP)
// ---------------------------------------------------------------------------

/** Total grains across every visitor. */
export function getGlobalTotal(): number {
  const row = getDb().prepare(`SELECT total FROM global WHERE id = 1`).get() as
    | { total: number }
    | undefined;
  return row?.total ?? 0;
}

/** Top N countries by total grains, descending. */
export function getTopCountries(n: number): CountryTotal[] {
  const limit = Math.max(0, Math.floor(n));
  return getDb()
    .prepare(`SELECT code, name, total FROM countries ORDER BY total DESC, code ASC LIMIT ?`)
    .all(limit) as CountryTotal[];
}

/**
 * All country rows (unbounded). Used by the WS server once at boot to seed its
 * in-memory aggregate map; there are at most ~250 rows so this stays small.
 */
export function getAllCountries(): CountryTotal[] {
  return getDb()
    .prepare(`SELECT code, name, total FROM countries ORDER BY total DESC, code ASC`)
    .all() as CountryTotal[];
}

/** Top N individual visitors by total grains, descending (only those with >0). */
export function getTopVisitors(n: number): VisitorTotal[] {
  const limit = Math.max(0, Math.floor(n));
  return getDb()
    .prepare(
      `SELECT vid, country_code, total, display_name FROM visitors
       WHERE total > 0 ORDER BY total DESC, vid ASC LIMIT ?`,
    )
    .all(limit) as VisitorTotal[];
}

/** Fetch a single visitor row, or null if unknown. */
export function getVisitor(vid: string): Visitor | null {
  const row = getDb().prepare(`SELECT * FROM visitors WHERE vid = ?`).get(vid) as
    | Visitor
    | undefined;
  return row ?? null;
}

/**
 * Insert or refresh a visitor's identity fields (ip hash, country) and
 * last_seen, without changing their grain total. Sets first_seen on creation.
 * Returns the resulting visitor row.
 */
export function upsertVisitor(
  vid: string,
  ipHash: string | null,
  countryCode: string | null,
  countryName: string | null,
): Visitor {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO visitors (vid, ip_hash, country_code, country_name, total, first_seen, last_seen)
       VALUES (@vid, @ipHash, @countryCode, @countryName, 0, @now, @now)
       ON CONFLICT(vid) DO UPDATE SET
         ip_hash      = COALESCE(excluded.ip_hash, visitors.ip_hash),
         country_code = COALESCE(excluded.country_code, visitors.country_code),
         country_name = COALESCE(excluded.country_name, visitors.country_name),
         last_seen    = @now`,
    )
    .run({ vid, ipHash, countryCode, countryName, now });
  // getVisitor always returns a row here (just upserted).
  return getVisitor(vid)!;
}

/**
 * Atomically add `delta` grains for a visitor: increments visitor.total,
 * countries.total (for their country), and global.total, and touches
 * last_seen — all in a single transaction so the three counters never diverge.
 * Creates the visitor / country rows if missing.
 *
 * Returns the before/after totals for the visitor, their country, and the world
 * (read inside the same transaction), so callers can detect threshold crossings
 * exactly. `*After = *Before + clamped(delta)`.
 *
 * `delta` is clamped to a non-negative integer (grains only ever go up).
 */
export function addGrains(
  vid: string,
  ipHash: string | null,
  countryCode: string | null,
  countryName: string | null,
  delta: number,
): GrainWrite {
  const inc = Math.max(0, Math.floor(delta));
  const handle = getDb();

  const tx = handle.transaction((): GrainWrite => {
    const now = Date.now();

    // Read the BEFORE totals in-transaction (exact, race-free).
    const visitorBefore =
      (handle.prepare(`SELECT total FROM visitors WHERE vid = ?`).get(vid) as
        | { total: number }
        | undefined)?.total ?? 0;
    const countryBefore = countryCode
      ? (handle.prepare(`SELECT total FROM countries WHERE code = ?`).get(countryCode) as
          | { total: number }
          | undefined)?.total ?? 0
      : 0;
    const globalBefore = (
      handle.prepare(`SELECT total FROM global WHERE id = 1`).get() as { total: number }
    ).total;

    // Visitor: create if new (stamping first_seen), else add + touch last_seen.
    handle
      .prepare(
        `INSERT INTO visitors (vid, ip_hash, country_code, country_name, total, first_seen, last_seen)
         VALUES (@vid, @ipHash, @countryCode, @countryName, @inc, @now, @now)
         ON CONFLICT(vid) DO UPDATE SET
           total        = visitors.total + @inc,
           ip_hash      = COALESCE(excluded.ip_hash, visitors.ip_hash),
           country_code = COALESCE(excluded.country_code, visitors.country_code),
           country_name = COALESCE(excluded.country_name, visitors.country_name),
           last_seen    = @now`,
      )
      .run({ vid, ipHash, countryCode, countryName, inc, now });

    // Country: only when we know the country. Create/increment; keep a name.
    if (countryCode) {
      handle
        .prepare(
          `INSERT INTO countries (code, name, total)
           VALUES (@code, @name, @inc)
           ON CONFLICT(code) DO UPDATE SET
             total = countries.total + @inc,
             name  = COALESCE(excluded.name, countries.name)`,
        )
        .run({ code: countryCode, name: countryName, inc });
    }

    // Global: the seeded id=1 row always exists.
    handle.prepare(`UPDATE global SET total = total + @inc WHERE id = 1`).run({ inc });

    return {
      visitorBefore,
      visitorAfter: visitorBefore + inc,
      countryCode,
      countryName,
      countryBefore,
      countryAfter: countryBefore + inc,
      globalBefore,
      globalAfter: globalBefore + inc,
    };
  });

  return tx();
}
