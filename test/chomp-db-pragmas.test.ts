/**
 * `wal_autocheckpoint` is READ FROM ENV AND APPLIED — the one connection pragma on
 * this database that can be honestly verified.
 *
 * *Added 2026-08-05, and the first two attempts at it were both worthless.*
 *
 * The spec's Leaderboard section requires this ceiling be set EXPLICITLY rather than
 * inherited, because `grains.db` sitting permanently at a ~4 MB WAL is precisely
 * SQLite's default and took a measurement to explain (plan §4.2). A default that
 * silently matches is exactly the state the rule exists to rule out.
 *
 * ── WHY THIS TEST LOOKS SO NARROW ─────────────────────────────────────────────
 * Two earlier versions asserted the pragmas at their real values and BOTH verified
 * nothing. Measured, against a connection with nothing set at all:
 *
 *     journal_mode        -> wal     (we set WAL; but so does any WAL database)
 *     synchronous         -> 1       <- NOT our doing: CREATE TABLE in WAL mode
 *                                       moves it from 2 to 1 by itself
 *     wal_autocheckpoint  -> 1000    <- SQLite's default, identical to ours
 *     foreign_keys        -> 1       <- better-sqlite3 already defaults it ON
 *     busy_timeout        -> 5000    <- better-sqlite3 already defaults it to 5000
 *
 * Every assertion passed with the pragma lines DELETED from `db.ts`. So none of
 * them are asserted here. The values are in the source at `db.ts:76-83`, and for
 * four of the five the source is the only record there can be.
 *
 * The escape is that this one is parameterised: it comes from
 * `CHOMP_WAL_AUTOCHECKPOINT`, so a NON-DEFAULT value proves the wiring end to end —
 * env read, passed through `getChompEnv()`, applied to the handle. 1000 could never
 * have proved that; 321 can.
 *
 * The general rule this came out of is in the spec's Acceptance criteria: a pragma
 * read from a different connection than the one that set it measures the reader, not
 * the file — and its corollary, which is what bit here: a value equal to the default
 * measures nothing at all, whichever connection you read it from.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

/** Deliberately NOT 1000. If this ever equals the default, the test stops testing. */
const NON_DEFAULT_CHECKPOINT = 321;

const dir = mkdtempSync(join(tmpdir(), "chomp-pragma-test-"));
process.env.CHOMP_DB_PATH = join(dir, "chomp.db");
process.env.CHOMP_WAL_AUTOCHECKPOINT = String(NON_DEFAULT_CHECKPOINT);
process.env.GRAINS_COOKIE_SECRET ||= "x".repeat(32);
process.env.GRAINS_IP_SALT ||= "y".repeat(32);

const { getChompDb } = await import("@/lib/chomp/db");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("applies CHOMP_WAL_AUTOCHECKPOINT to its own connection", () => {
  // Guard the guard: if SQLite's default ever becomes this number, the assertion
  // below would pass for the wrong reason and nobody would notice.
  expect(NON_DEFAULT_CHECKPOINT).not.toBe(1000);

  const db = getChompDb();
  expect(db.pragma("wal_autocheckpoint", { simple: true })).toBe(NON_DEFAULT_CHECKPOINT);

  // WAL is a database property rather than a connection one, so this is the single
  // pragma an external tool can also confirm — which is what makes the live check in
  // plan §10.3 meaningful for this one and meaningless for the rest.
  expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
});
