/**
 * The single-writer guard on `data/chomp.db`.
 *
 * *Added 2026-08-05, after Phase 7.* `chomp.db` has exactly one legitimate writer,
 * the pm2 app `onegrainofrice`. Until this guard existed that was enforced by
 * remembering to set `CHOMP_DB_PATH` on any second copy of the app — a habit, not a
 * guard. The grains WS process's identical single-writer contract is protected by
 * `instances: 1` and a comment; this one is now protected by a refusal to open a
 * file the process has not claimed.
 *
 * The failure this prevents is silent in the worst way: two processes on one WAL
 * database both appear to work.
 *
 * These tests mutate `process.env` and must therefore clear the memoized env
 * between cases — `getChompEnv()` reads once and caches, which is the behaviour
 * that makes the guard free at runtime and the thing that would make these tests
 * lie to each other.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getChompEnv, resetChompEnvCache } from "@/lib/chomp/env";

const SAVED = { ...process.env };

/**
 * `getChompEnv()` calls `getGrainsEnv()` first, on purpose — a missing cookie
 * secret should fail loudly at the leaderboard request rather than deep inside a
 * signature check. That ordering means these secrets must be present or every case
 * below fails on the grains error before it ever reaches the path guard. Same
 * dummy values `chomp-db.test.ts` uses.
 */
process.env.GRAINS_COOKIE_SECRET ||= "x".repeat(32);
process.env.GRAINS_IP_SALT ||= "y".repeat(32);

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetChompEnvCache();
}

beforeEach(() => {
  // The suite's other files set CHOMP_DB_PATH at import time; start from a known
  // state rather than inheriting whichever ran first.
  setEnv({ CHOMP_DB_PATH: undefined, CHOMP_DB_OWNER: undefined });
});

afterEach(() => {
  process.env = { ...SAVED };
  resetChompEnvCache();
});

describe("chomp.db single-writer guard", () => {
  it("REFUSES the default path when the process has not claimed it", () => {
    // The whole point: a preview server started from the repo root, with no
    // CHOMP_DB_PATH, used to silently become a second writer of the live file.
    expect(() => getChompEnv()).toThrow(/Refusing to open the default database path/);
  });

  it("the refusal names both fixes, because a message that does not is a dead end", () => {
    // This is not decoration. The guard's entire value over a habit is that the
    // failure tells the next person what to do; if the message rots, the guard
    // becomes an obstacle instead of a control.
    let msg = "";
    try {
      getChompEnv();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("CHOMP_DB_PATH=");
    expect(msg).toContain("CHOMP_DB_OWNER=1");
    expect(msg).toContain("ecosystem.config.js");
    // And it must warn against the one placement that would silently defeat it.
    expect(msg).toContain(".env.local");
  });

  it("ALLOWS the default path when the process declares ownership", () => {
    setEnv({ CHOMP_DB_OWNER: "1" });
    expect(getChompEnv().dbPath).toMatch(/data[/\\]chomp\.db$/);
  });

  it("ALLOWS any explicitly named path, with no ownership flag", () => {
    // Naming a file IS taking responsibility for which file it is. This is the
    // path the preview server, the test suite and every script take.
    setEnv({ CHOMP_DB_PATH: "/tmp/chomp-somewhere-else.db" });
    expect(getChompEnv().dbPath).toBe("/tmp/chomp-somewhere-else.db");
  });

  it("an explicit path WINS over the ownership flag", () => {
    // Belt and braces: a process that both claims ownership and names a file gets
    // the file it named. Otherwise the live process could never be pointed at a
    // backup-scoped path without first giving up its claim.
    setEnv({ CHOMP_DB_OWNER: "1", CHOMP_DB_PATH: "/tmp/explicit-wins.db" });
    expect(getChompEnv().dbPath).toBe("/tmp/explicit-wins.db");
  });

  it("only the exact flag value counts — not truthiness", () => {
    // "0" and "false" are the two ways someone disables a flag and expects it to
    // be off. A loose truthy check would turn both into a claim of ownership.
    for (const v of ["0", "false", "", "yes", "true"]) {
      setEnv({ CHOMP_DB_OWNER: v });
      if (v === "1") continue;
      expect(() => getChompEnv(), `CHOMP_DB_OWNER=${JSON.stringify(v)}`).toThrow(
        /Refusing to open/,
      );
    }
  });

  it("a whitespace-only CHOMP_DB_PATH is not a path", () => {
    // `.env.local` lines like `CHOMP_DB_PATH= ` are how this would otherwise slip
    // through as an empty string that reads as "explicitly set".
    setEnv({ CHOMP_DB_PATH: "   " });
    expect(() => getChompEnv()).toThrow(/Refusing to open/);
  });
});

describe("the guard stops the FILE, not just the env read", () => {
  it("an unclaimed process cannot create the default database", async () => {
    // The env test above proves the throw. This proves the thing that actually
    // matters: no file appears. `getChompDb()` creates the directory and runs
    // migrate() on open, so if the guard sat anywhere downstream of that, a second
    // process would have already written a schema before failing.
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const defaultPath = join(process.cwd(), "data", "chomp.db");
    const existedBefore = existsSync(defaultPath);

    setEnv({ CHOMP_DB_PATH: undefined, CHOMP_DB_OWNER: undefined });
    const { getChompDb } = await import("@/lib/chomp/db");
    expect(() => getChompDb()).toThrow(/Refusing to open/);

    // Unchanged either way: absent stays absent, and a live file is not touched.
    expect(existsSync(defaultPath)).toBe(existedBefore);
  });
});

describe("the pm2 config still declares ownership", () => {
  it("ecosystem.config.js sets CHOMP_DB_OWNER for onegrainofrice and nothing else", async () => {
    // The flag is useless if it is dropped from the config, and its absence would
    // show up only as a 500 on the first leaderboard request in production. Assert
    // it is there, exactly once — a second app copying the line is the one way to
    // recreate the two-writer hazard through this mechanism.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "..", "ecosystem.config.js"), "utf8");
    const occurrences = src.match(/CHOMP_DB_OWNER:\s*"1"/g) ?? [];
    expect(occurrences).toHaveLength(1);
    // And it must not have drifted into the shared env file.
    expect(src).toMatch(/name:\s*"onegrainofrice"/);
  });

  it("CHOMP_DB_OWNER is not in .env.local, where the preview would inherit it", async () => {
    // The single placement rule, asserted rather than commented. If this ever goes
    // red the guard is still green and is guarding nothing.
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const envFile = join(__dirname, "..", ".env.local");
    if (!existsSync(envFile)) return; // not present in CI; nothing to check
    expect(readFileSync(envFile, "utf8")).not.toMatch(/^\s*CHOMP_DB_OWNER\s*=/m);
  });
});
