import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createGame, replay, tick, type GameState } from "@/components/chomp/engine/game";
import { DOWN, LEFT, RIGHT, UP } from "@/components/chomp/engine/types";
import {
  GRAINS_PER_LEVEL,
  NAME_MAX_LEN,
  POWER_PER_LEVEL,
  checkName,
  checkRun,
  containsProfanity,
  sanitizeChompName,
  type RunClaim,
} from "@/lib/chomp/score";
import { MAX_TRACE_ENTRIES, decodeTrace, encodeTrace } from "@/lib/chomp/trace";
import { runClearBot } from "./chomp-support";

/**
 * PHASE 6 — THE LEADERBOARD'S SERVER SIDE.
 *
 * Everything the submission path decides, decided under test. The route handler is
 * a wrapper: it reads a cookie, reads two nginx headers, and calls the three pure
 * functions below. Those are what can be wrong.
 *
 * Three groups, and the middle one is the load-bearing one:
 *
 *   1. THE TRACE CODEC round-trips, and — the real assertion — a decoded trace
 *      replays to the same score. That is the whole anti-cheat bet made concrete: if
 *      it ever stops holding, replay verification is not a later server-side change,
 *      it is impossible, and every trace stored in the meantime is worthless.
 *   2. THE VALIDATOR accepts a run a bot actually played and rejects the ways of
 *      lying about one. It is checked against a REAL run rather than hand-made
 *      numbers, because a validator tested only against its own author's idea of a
 *      run is a validator that rejects players.
 *   3. THE NAME RULES, including the ones about invisible characters.
 *
 * Plus one structural assertion, in the shape `chomp-audio.test.ts` uses for the
 * engine boundary: nothing in this feature may open grains.db for writing.
 */

// ---------------------------------------------------------------------------
// A real run, played once and shared. The bot is the difficulty suite's clearing
// bot; a level-1 clear takes about a minute of simulated time.
// ---------------------------------------------------------------------------

const SEED = 1000;
/** Four simulated minutes — a clear takes about one, so this is a runaway guard. */
const BUDGET = 60 * 240;

function playedRun(): GameState {
  // NOT beginPlay(): replay() builds its state with createGame() and no skip, so a
  // run that skipped the READY hold could not be replayed against it. The two ticks
  // of anticipation are part of the trace's clock.
  const state = createGame(1, SEED);
  runClearBot(state, BUDGET, tick);
  return state;
}

const run = playedRun();

function claimFrom(s: GameState): RunClaim {
  return {
    score: s.score,
    level: s.level,
    startLevel: s.startLevel,
    ticks: s.tick,
    grains: s.grainsEaten,
    golden: s.powerEaten,
    pests: s.pestsEaten,
    bonuses: s.bonusesEaten,
  };
}

// ---------------------------------------------------------------------------
// 1. the trace
// ---------------------------------------------------------------------------

describe("the compressed input trace", () => {
  it("round-trips a real run's input log exactly", () => {
    expect(run.inputLog.length).toBeGreaterThan(20);
    const decoded = decodeTrace(encodeTrace(run.inputLog));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.log).toEqual(run.inputLog);
    expect(decoded.lastTick).toBe(run.inputLog[run.inputLog.length - 1].tick);
  });

  it("REPLAYS a decoded trace to the same score — the whole anti-cheat bet", () => {
    // If this ever fails, the traces being stored today cannot be verified tomorrow,
    // which is the only reason the column exists before the checker does.
    const decoded = decodeTrace(encodeTrace(run.inputLog));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const again = replay(decoded.log, run.tick, SEED);
    expect(again.score).toBe(run.score);
    expect(again.grainsEaten).toBe(run.grainsEaten);
    expect(again.powerEaten).toBe(run.powerEaten);
    expect(again.pestsEaten).toBe(run.pestsEaten);
    expect(again.bonusesEaten).toBe(run.bonusesEaten);
    expect(again.level).toBe(run.level);
  });

  it("does not confuse a base-36 delta with a direction letter", () => {
    // 13 is "d" in base 36 and DOWN is "D". Lowercase digits and uppercase
    // terminators are disjoint on purpose; a lowercase terminator would make this
    // trace decode to something plausible and wrong rather than failing.
    const log = [{ tick: 13, dir: RIGHT as typeof RIGHT }];
    expect(encodeTrace(log)).toBe("dR");
    const back = decodeTrace("dR");
    expect(back.ok && back.log).toEqual(log);
  });

  it("encodes a same-tick pair as one character each", () => {
    expect(encodeTrace([{ tick: 5, dir: UP }, { tick: 5, dir: LEFT }])).toBe("5UL");
  });

  it("refuses malformed traces rather than guessing", () => {
    for (const bad of ["12", "!R", "U-D", "1R2", 42, null, undefined, {}]) {
      expect(decodeTrace(bad as unknown).ok, `should reject ${String(bad)}`).toBe(false);
    }
  });

  it("caps a hostile trace before it becomes work", () => {
    const many = "U".repeat(MAX_TRACE_ENTRIES + 5);
    expect(decodeTrace(many).ok).toBe(false);
    expect(decodeTrace("zzzzzzzzzU").ok).toBe(false); // absurd delta
  });

  it("refuses to encode an out-of-order log", () => {
    expect(() =>
      encodeTrace([{ tick: 20, dir: UP }, { tick: 5, dir: DOWN }]),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. the validator
// ---------------------------------------------------------------------------

describe("run validation accepts what the game produces", () => {
  it("accepts a run a bot actually played", () => {
    expect(run.score).toBeGreaterThan(0);
    expect(checkRun(claimFrom(run))).toEqual({ ok: true });
  });

  it("accepts it at every point along the way, not just at the end", () => {
    // The generous-looking duration floor has to survive the WHOLE run, including the
    // opening seconds where the eaten-grains count is high relative to elapsed ticks.
    const s = createGame(1, SEED);
    const rejected: string[] = [];
    for (let i = 0; i < 40; i++) {
      runClearBot(s, 100, tick);
      if (s.score <= 0) continue;
      const v = checkRun(claimFrom(s));
      if (!v.ok) rejected.push(`tick ${s.tick}: ${v.reason}`);
    }
    expect(rejected).toEqual([]);
  });
});

describe("run validation rejects the obvious lies", () => {
  const base = (): RunClaim => claimFrom(run);

  it("rejects a score nobody could have scored", () => {
    expect(checkRun({ ...base(), score: 999_999_999 }).ok).toBe(false);
  });

  it("rejects a score too LOW for the events claimed", () => {
    // The bound is two-sided on purpose: a submission whose score is far below its
    // own event counts is just as much not-a-run as one that is far above.
    expect(checkRun({ ...base(), score: 10 }).ok).toBe(false);
  });

  it("rejects a debug run whatever else it says", () => {
    expect(checkRun({ ...base(), startLevel: 7 }).ok).toBe(false);
    expect(checkRun({ ...base(), startLevel: 2 }).ok).toBe(false);
  });

  it("rejects an impossibly short run", () => {
    expect(checkRun({ ...base(), ticks: 10 }).ok).toBe(false);
    // A full board cleared in two seconds.
    expect(
      checkRun({
        score: 2860,
        level: 1,
        startLevel: 1,
        ticks: 121,
        grains: GRAINS_PER_LEVEL,
        golden: POWER_PER_LEVEL,
        pests: 0,
        bonuses: 0,
      }).ok,
    ).toBe(false);
  });

  it("rejects more grains than the maze holds", () => {
    expect(checkRun({ ...base(), grains: GRAINS_PER_LEVEL * 5 }).ok).toBe(false);
  });

  it("rejects a level the grain count cannot have reached", () => {
    expect(checkRun({ ...base(), level: 9 }).ok).toBe(false);
  });

  it("rejects more pests than the power windows allow", () => {
    // Four pests per golden grain, and not one more.
    const c = base();
    expect(checkRun({ ...c, pests: c.golden * 4 + 1 }).ok).toBe(false);
  });

  it("rejects more bonus items than could have appeared", () => {
    expect(checkRun({ ...base(), bonuses: 3 }).ok).toBe(false);
  });

  it("rejects a scoreless submission", () => {
    expect(checkRun({ ...base(), score: 0 }).ok).toBe(false);
  });

  it("rejects non-integers and negatives rather than coercing them", () => {
    expect(checkRun({ ...base(), score: 1.5 }).ok).toBe(false);
    expect(checkRun({ ...base(), grains: -1 }).ok).toBe(false);
    expect(checkRun({ ...base(), ticks: Number.NaN }).ok).toBe(false);
  });

  it("accepts a legitimately high but possible score", () => {
    // The point of a two-sided bound is that it must not cap the game. A perfect
    // level-1 board — every grain, every golden, every window filled, both items —
    // has to pass, because someone will do it.
    const perfect: RunClaim = {
      score:
        GRAINS_PER_LEVEL * 10 +
        POWER_PER_LEVEL * 50 +
        POWER_PER_LEVEL * 3000 +
        2 * 100,
      level: 1,
      startLevel: 1,
      ticks: 60 * 200,
      grains: GRAINS_PER_LEVEL,
      golden: POWER_PER_LEVEL,
      pests: POWER_PER_LEVEL * 4,
      bonuses: 2,
    };
    expect(checkRun(perfect)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 3. names
// ---------------------------------------------------------------------------

describe("the name rules", () => {
  it("takes an ordinary name unchanged", () => {
    expect(checkName("Rice Fan")).toEqual({ ok: true, name: "Rice Fan" });
  });

  it("holds the 3-12 character bounds", () => {
    expect(checkName("ab").ok).toBe(false);
    expect(checkName("abc").ok).toBe(true);
    const long = checkName("abcdefghijklmnopqrst");
    expect(long.ok && long.name.length).toBe(NAME_MAX_LEN);
  });

  it("strips control characters and the invisible bidi family", () => {
    // A right-to-left override makes a row render as something other than what is
    // stored, which is the whole trick.
    expect(sanitizeChompName("Ri\u202Ece\u200B\u0007Fan")).toBe("RiceFan");
    expect(sanitizeChompName(" ")).toBe(null);
  });

  it("strips the characters that turn up in injection attempts", () => {
    expect(sanitizeChompName("<b>hi</b>")).toBe("bhi/b");
    expect(sanitizeChompName("a\"b'c`d")).toBe("abcd");
  });

  it("refuses a name that is only whitespace", () => {
    expect(checkName("     ").ok).toBe(false);
    expect(checkName(null).ok).toBe(false);
    expect(checkName(12345).ok).toBe(false);
  });

  it("sees through the usual disguises", () => {
    for (const bad of ["shit", "SH1T", "s h i t", "sssshhhiiit", "$hit", "f.u.c.k"]) {
      expect(containsProfanity(bad), `should catch ${bad}`).toBe(true);
    }
  });

  it("leaves ordinary names alone", () => {
    for (const ok of ["Rice Fan", "paddy99", "Konnichiwa", "grain-o", "Sco"]) {
      expect(containsProfanity(ok), `should allow ${ok}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. the structural guarantee: this feature never writes grains.db
// ---------------------------------------------------------------------------

describe("the grains single-writer contract is untouched", () => {
  const ROOT = join(import.meta.dirname, "..");
  const CHOMP_LIB = join(ROOT, "src", "lib", "chomp");
  const CHOMP_API = join(ROOT, "src", "app", "api", "chomp");

  function serverFiles(): { path: string; code: string }[] {
    const out: { path: string; code: string }[] = [];
    for (const f of readdirSync(CHOMP_LIB).filter((x) => x.endsWith(".ts"))) {
      out.push({ path: `lib/chomp/${f}`, code: readFileSync(join(CHOMP_LIB, f), "utf8") });
    }
    for (const d of readdirSync(CHOMP_API)) {
      const p = join(CHOMP_API, d, "route.ts");
      try {
        out.push({ path: `api/chomp/${d}/route.ts`, code: readFileSync(p, "utf8") });
      } catch {
        /* not every entry is a route directory */
      }
    }
    return out;
  }

  it("never imports the grains DB module, whose getDb() opens grains.db read-write", () => {
    // `getDb()` runs migrate() — CREATE TABLE, ALTER TABLE — on every open. One
    // import of it and the Next process becomes a writer of a file another process
    // owns by contract, silently, with nothing to see in a diff.
    for (const { path, code } of serverFiles()) {
      expect(code, `${path} must not import @/lib/grains/db`).not.toMatch(
        /from\s+["']@\/lib\/grains\/db["']/,
      );
    }
  });

  it("opens grains.db in exactly one place, and opens it readonly", () => {
    const openers = serverFiles().filter((f) => /new Database\(/.test(f.code));
    // Two: db.ts opens chomp.db (read-write, its own file) and grainsName.ts opens
    // grains.db (readonly). Anything else is new and wants reading.
    expect(openers.map((f) => f.path).sort()).toEqual([
      "lib/chomp/db.ts",
      "lib/chomp/grainsName.ts",
    ]);

    const gn = openers.find((f) => f.path === "lib/chomp/grainsName.ts")!;
    expect(gn.code).toMatch(/readonly:\s*true/);
    expect(gn.code).toMatch(/fileMustExist:\s*true/);

    const own = openers.find((f) => f.path === "lib/chomp/db.ts")!;
    expect(own.code, "chomp/db.ts must never name the grains env's db path").not.toMatch(
      /getGrainsEnv\(\)\s*\.?\s*[\s\S]{0,40}dbPath/,
    );
  });
});
