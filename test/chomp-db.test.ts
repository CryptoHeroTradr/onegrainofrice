import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

/**
 * THE BOARD IS ONE BOARD, and this is the assertion that keeps it one.
 *
 * Added 2026-08-05 with the removal of the country board. Phase 6 shipped two boards
 * and verified the database by hand against a running build (plan §10.3) — a real
 * check, but one nobody re-runs. The removal touched the write transaction, so the
 * cheap standing version of that check now lives here.
 *
 * It is the ONLY test that opens a database, and it opens a throwaway one: the path
 * is set to a temp directory BEFORE `db.ts` is imported, because `getChompEnv()`
 * memoises. `test/chomp-score.test.ts` asserts separately that nothing in this
 * feature can open `grains.db` for writing; this file must never be the exception.
 *
 * Four things, all of which the removal could have broken:
 *   1. exactly two tables — a third board must not grow back unnoticed;
 *   2. ranking is one row per PLAYER at their BEST score, not one row per run;
 *   3. the dedupe index still makes a resubmission a no-op that reports the truth;
 *   4. `country_code` still rides out to the board as the flag column, null and all.
 */

const dir = mkdtempSync(join(tmpdir(), "chomp-db-test-"));
process.env.CHOMP_DB_PATH = join(dir, "chomp.db");
process.env.GRAINS_COOKIE_SECRET ||= "x".repeat(32);
process.env.GRAINS_IP_SALT ||= "y".repeat(32);

const { submitRun, getTopPlayers, getYou, getChompDb } = await import("@/lib/chomp/db");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A level-1 clear, the numbers the §10.3 smoke actually played. */
const RUN = {
  score: 3720,
  level: 1,
  grains: 282,
  golden: 4,
  pests: 2,
  bonuses: 1,
  ticks: 4102,
  seed: 1000,
  countryName: "Japan",
  ipHash: null,
};

it("keeps one board: best run per player, flag column, no country table", () => {
  const first = submitRun({ ...RUN, vid: "v1", name: "Paddy Ace", trace: "1U2L", countryCode: "JP" });
  expect(first).toEqual({ runId: 1, best: 3720, improved: true, rank: 1, duplicate: false });

  // A retry after a dropped response is not a second row.
  const again = submitRun({ ...RUN, vid: "v1", name: "Paddy Ace", trace: "1U2L", countryCode: "JP" });
  expect(again.duplicate).toBe(true);
  expect(again.runId).toBe(first.runId);

  // A worse run later does not cost them their best — this is the ranking rule.
  submitRun({ ...RUN, score: 100, vid: "v1", name: "Paddy Ace", trace: "9R", countryCode: "JP" });
  // A second player whose GeoIP missed entirely. They still rank; the flag is what is
  // missing, not the score.
  submitRun({ ...RUN, score: 9000, vid: "v2", name: "Nobody", trace: "3D", countryCode: null });

  expect(getTopPlayers(50).map((p) => [p.name, p.best_score, p.country_code])).toEqual([
    ["Nobody", 9000, null],
    ["Paddy Ace", 3720, "JP"],
  ]);

  // Two runs filed, one best kept, and no country rank anywhere in the shape.
  expect(getYou("v1")).toEqual({
    name: "Paddy Ace",
    best: 3720,
    bestLevel: 1,
    games: 2,
    rank: 2,
  });

  const tables = (
    getChompDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((t) => t.name);
  expect(tables.filter((n) => n.startsWith("chomp_"))).toEqual(["chomp_players", "chomp_runs"]);
});

