/**
 * GRAINSNAKE's database: its own file, its own tables, and nothing shared.
 *
 * The single-writer design is only worth anything if this feature genuinely cannot
 * reach the other two databases, so the first suite asserts that structurally — by
 * reading the source — rather than by hoping. `chomp.db` has one legitimate writer and
 * `grains.db` has another, and SQLite will let a second writer appear to work right up
 * until it does not.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "grainsnake-db-"));
process.env.GRAINSNAKE_DB_PATH = join(dir, "grainsnake.db");
process.env.GRAINS_COOKIE_SECRET ||= "x".repeat(32);
process.env.GRAINS_IP_SALT ||= "y".repeat(32);

const SRC = join(__dirname, "..", "src", "lib", "grainsnake");

describe("it owns one database and cannot reach the others", () => {
  it("never names chomp.db or grains.db", () => {
    const src = readFileSync(join(SRC, "db.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(src).not.toMatch(/chomp\.db/);
    expect(src).not.toMatch(/grains\.db/);
    // ...and does not import the module that could open one read-write.
    expect(src).not.toMatch(/from\s+["']@\/lib\/chomp\/db["']/);
    expect(src).not.toMatch(/from\s+["']@\/lib\/grains\/db["']/);
  });

  it("declares its own owner flag, not chomp's", () => {
    const env = readFileSync(join(SRC, "env.ts"), "utf8");
    expect(env).toMatch(/GRAINSNAKE_DB_OWNER/);
    expect(env).not.toMatch(/CHOMP_DB_OWNER/);
  });

  it("refuses the default path for a process that has not claimed it", async () => {
    const { resetGrainsnakeEnvCache, getGrainsnakeEnv } = await import("@/lib/grainsnake/env");
    const saved = process.env.GRAINSNAKE_DB_PATH;
    delete process.env.GRAINSNAKE_DB_PATH;
    delete process.env.GRAINSNAKE_DB_OWNER;
    resetGrainsnakeEnvCache();
    // A guard that can take down production is worse than the hazard it prevents, so
    // the failure is a refusal with a message naming its own fix — not a lockfile.
    expect(() => getGrainsnakeEnv()).toThrow(/GRAINSNAKE_DB_OWNER/);
    process.env.GRAINSNAKE_DB_PATH = saved;
    resetGrainsnakeEnvCache();
  });
});

describe("the schema and the board", () => {
  let db: typeof import("@/lib/grainsnake/db");

  beforeAll(async () => {
    db = await import("@/lib/grainsnake/db");
  });

  const base = {
    vid: "vid-a",
    name: "Tester",
    score: 1200,
    length: 40,
    goldens: 3,
    foodEaten: 37,
    ticks: 6000,
    seed: 162,
    inputs: '[{"tick":0,"dir":3}]',
    engineVersion: 1,
    filled: false,
    countryCode: "US",
    countryName: "United States",
    ipHash: null,
  };

  it("stores every column the board needs, and derives duration from ticks", () => {
    const r = db.submitRun({ ...base });
    expect(r.runId).toBeGreaterThan(0);
    const row = db
      .getGrainsnakeDb()
      .prepare(`SELECT * FROM grainsnake_runs WHERE id = ?`)
      .get(r.runId) as Record<string, unknown>;
    expect(row.score).toBe(1200);
    expect(row.length).toBe(40);
    expect(row.goldens).toBe(3);
    expect(row.engine_version).toBe(1);
    expect(row.filled).toBe(0);
    expect(row.country_code).toBe("US");
    // DERIVED, never accepted: ticks * 1000 / 60.
    expect(row.duration_ms).toBe(Math.round((6000 * 1000) / 60));
    // ...and there is no client-supplied time column to disagree with it.
    expect(Object.keys(row)).not.toContain("elapsed_ms");
    expect(Object.keys(row)).not.toContain("started_at");
  });

  it("keeps goldens as its own column rather than folding it into the score", () => {
    // The board's only real second axis: base score is a function of length, so two
    // players of equal length differ only by goldens.
    const cols = db
      .getGrainsnakeDb()
      .prepare(`PRAGMA table_info(grainsnake_players)`)
      .all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("best_goldens");
  });

  it("puts the run on the board and ranks it", () => {
    const top = db.getTopPlayers(50);
    expect(top.length).toBeGreaterThan(0);
    expect(top[0].name).toBe("Tester");
    expect(top[0].best_goldens).toBe(3);
    const you = db.getYou("vid-a");
    expect(you?.rank).toBe(1);
    expect(you?.bestLength).toBe(40);
  });

  it("dedupes an identical resubmission instead of doubling the row", () => {
    const again = db.submitRun({ ...base });
    expect(again.duplicate).toBe(true);
    const n = db
      .getGrainsnakeDb()
      .prepare(`SELECT COUNT(*) AS n FROM grainsnake_runs WHERE vid = ?`)
      .get("vid-a") as { n: number };
    expect(n.n).toBe(1);
  });

  it("ranks a better run above a worse one", () => {
    db.submitRun({ ...base, vid: "vid-b", name: "Better", score: 5000, inputs: "[]", goldens: 9 });
    const top = db.getTopPlayers(50);
    expect(top[0].name).toBe("Better");
    expect(top[0].best_goldens).toBe(9);
  });

  it("records a filled board as a lifetime mark, not a property of the best run", () => {
    db.submitRun({ ...base, vid: "vid-c", name: "Filler", score: 10, inputs: "[1]", filled: true });
    // A later, higher-scoring run that did NOT fill must not clear the mark.
    db.submitRun({ ...base, vid: "vid-c", name: "Filler", score: 99, inputs: "[2]", filled: false });
    const row = db
      .getGrainsnakeDb()
      .prepare(`SELECT filled, best_score FROM grainsnake_players WHERE vid = ?`)
      .get("vid-c") as { filled: number; best_score: number };
    expect(row.best_score).toBe(99);
    expect(row.filled, "filling the board is a lifetime achievement").toBe(1);
  });

  it("exposes the death-length distribution as a query, not a second table", () => {
    // The spec names this as what resolves the tier thresholds. It is derived from
    // the append-only runs table rather than maintained as an aggregate that could
    // drift from it.
    const hist = db.deathLengthHistogram();
    expect(Array.isArray(hist)).toBe(true);
    expect(hist.reduce((n, h) => n + h.runs, 0)).toBeGreaterThan(0);
    const tables = db
      .getGrainsnakeDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).not.toContain("grainsnake_death_lengths");
  });
});
