/**
 * The ONE place RICE CHOMP touches grains.db — and it opens it READ-ONLY.
 *
 * The spec asks for the submission's name field to be prefilled from the grains
 * board's name "if present". The same signed `grain_vid` cookie identifies the
 * player on both boards, so the name is one indexed lookup away — but grains.db has
 * a single writer by contract (`oneg-grains-ws`, `ecosystem.config.js`), and this
 * process is not it.
 *
 * `readonly: true` is what makes that a guarantee rather than a promise. It is not
 * decoration and it is not an optimisation:
 *
 *  - It rules out the accident, not just the intent. `src/lib/grains/db.ts`'s
 *    `getDb()` opens the file read-WRITE and runs `migrate()` — CREATE TABLE IF NOT
 *    EXISTS, ALTER TABLE — on every open. Importing that module here to "just read
 *    one row" would have made the Next process a writer of grains.db on the first
 *    request, silently, with no schema change and nothing to see in a diff.
 *  - SQLite enforces it. Any statement that would write returns SQLITE_READONLY.
 *
 * `test/chomp-score.test.ts` asserts that this is the only chomp module naming
 * grains.db and that it names `readonly` while doing so.
 *
 * Every failure here is a NON-EVENT: no file yet, no visitors table, a locked WAL, a
 * player who never played the clicker. All of them mean "no name to prefill", which
 * is the ordinary case for most players anyway. Nothing throws to the caller.
 *
 * SERVER-ONLY.
 */

import Database from "better-sqlite3";
import { getGrainsEnv } from "@/lib/grains/env";

/**
 * Cached across requests like the write connection is, because a per-request open of
 * a WAL database is three file handles and a shared-memory mapping for one SELECT.
 * Null means "tried and could not"; the boolean distinguishes that from "not tried".
 */
let ro: Database.Database | null = null;
let attempted = false;

function connection(): Database.Database | null {
  if (attempted) return ro;
  attempted = true;
  try {
    const { dbPath } = getGrainsEnv();
    // fileMustExist stops better-sqlite3 creating an empty grains.db if the path is
    // ever wrong — which would be a brand new file that the WS server does not know
    // about, i.e. exactly the sort of quiet damage this module exists to avoid.
    ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    ro = null;
  }
  return ro;
}

/**
 * The name this player chose on the grains leaderboard, or null. Never throws.
 *
 * Note this is a PREFILL, not an identity: RICE CHOMP stores its own name per
 * submission, the two boards can disagree, and changing one does not change the
 * other. That is the intended behaviour — a player is allowed a different name on an
 * arcade board than on a clicker — and it is why the two databases stay separate.
 */
export function grainsDisplayName(vid: string): string | null {
  const handle = connection();
  if (!handle) return null;
  try {
    const row = handle
      .prepare(`SELECT display_name FROM visitors WHERE vid = ?`)
      .get(vid) as { display_name: string | null } | undefined;
    const name = row?.display_name?.trim();
    return name ? name : null;
  } catch {
    // A schema this module does not recognise is not this feature's problem.
    return null;
  }
}
