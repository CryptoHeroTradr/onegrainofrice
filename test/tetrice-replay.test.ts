/**
 * TETRICE — the verifier. The suite that has to hold for the board to mean anything.
 *
 * The claim: a recorded run is re-scored by the SAME `step()` the browser ran, in plain
 * Node, and a log that has been touched does not survive it. If that stops being true the
 * whole anti-forgery position goes with it — `SubmitBody` has no score field, so the
 * replay is not a check on the number, it IS the number.
 *
 * ── THE FIXTURE, AND WHAT "CAPTURED" MEANS HERE ─────────────────────────────────────
 * `test/fixtures/tetrice-run.json` is a real log in the sense that matters: every entry
 * came out of the actual `InputState` → `drain()` → `InputRecorder` → `step()` chain the
 * browser runs, so it exercises the real auto-repeat (which is what makes a log dense),
 * the real recorder and the real engine. **It was produced by a scripted player, not by a
 * person** — `scripts/capture-tetrice-run.mjs`, deterministic, regenerable, byte-identical
 * across runs — and it is described that way here rather than letting "captured" imply a
 * human. What it is not is hand-written: nobody chose those 578 entries, the recorder did.
 *
 * It is a FINISHED run that tops out, clears 24 lines and crosses two level thresholds, so
 * the line-scoring path and the level-up boundary are inside the thing being verified
 * rather than beside it.
 *
 * ── EVERY REJECTION IS TESTED AGAINST A LOG BUILT TO TRIGGER IT ─────────────────────
 * *`CLAUDE.md`: a test that guards a failure must be shown failing when that failure is
 * present.* A verifier that returned `ok` for everything would pass a suite of good runs
 * perfectly, so the good run is one test out of many and each of the others hands it a log
 * that is wrong in exactly one way.
 *
 * Two of them carry their control inline — the trailing-input tests first assert that
 * `step()` really does absorb the tampering, so the rejection is demonstrably the
 * verifier's doing and not something the engine was going to catch anyway.
 *
 * **AND THE SUITE WAS HAND-FALSIFIED, 2026-08-13.** The two end-of-run checks in
 * `verify.ts` (`state.ticks !== log.ticks` and the frame-range guard) were disabled in
 * place; 3 tests went red across this file and `tetrice-routes.test.ts` — both
 * trailing-input tests and the entry-past-the-end one — and 36 stayed green. Restored,
 * green again. Without that, "the verifier rejects trailing input" would have been a
 * sentence rather than a measurement.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_VERSION } from "@/games/tetrice/engine/rules";
import { createInitialState } from "@/games/tetrice/engine/state";
import { step } from "@/games/tetrice/engine/step";
import { ACTION_BITS, actionsAt, replay, type LogEntry, type RunLog } from "@/games/tetrice/client/inputLog";
import {
  MAX_REPLAY_TICKS,
  durationMsFromTicks,
  parseRunLog,
  verifyRunLog,
} from "@/lib/tetrice/verify";

interface Fixture {
  log: RunLog;
  played: { score: number; level: number; lines: number; ticks: number; over: boolean };
}

const FIXTURE: Fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "tetrice-run.json"), "utf8"),
);

/** A fresh copy every time — a test that mutated the shared one would poison the next. */
function log(overrides: Partial<RunLog> = {}): RunLog {
  return {
    seed: FIXTURE.log.seed,
    engineVersion: FIXTURE.log.engineVersion,
    ticks: FIXTURE.log.ticks,
    entries: FIXTURE.log.entries.map((e) => [e[0], e[1]] as LogEntry),
    ...overrides,
  };
}

/**
 * A legal action mask that differs from entry `i`'s neighbours, so a substitution stays a
 * well-formed log. Without this a tampering test can fail for a structural reason and look
 * like it proved something about the replay.
 */
function distinctMask(entries: readonly LogEntry[], i: number): number {
  const before = i > 0 ? entries[i - 1][1] : -1;
  const after = i + 1 < entries.length ? entries[i + 1][1] : -1;
  for (const candidate of [
    ACTION_BITS.RotateCW,
    ACTION_BITS.RotateCCW,
    ACTION_BITS.MoveLeft,
    ACTION_BITS.MoveRight,
    ACTION_BITS.SoftDrop,
    ACTION_BITS.Hold,
  ]) {
    if (candidate !== before && candidate !== after && candidate !== entries[i][1]) return candidate;
  }
  throw new Error("no distinct mask available — the fixture is not what this test assumes");
}

describe("the fixture is a finished run worth verifying", () => {
  it("tops out, clears lines, and crosses a level threshold", () => {
    // If this ever fails, the fixture was regenerated into something weaker and every
    // assertion below is quietly testing less than it says it does.
    expect(FIXTURE.played.over).toBe(true);
    expect(FIXTURE.played.lines).toBeGreaterThan(10);
    expect(FIXTURE.played.level).toBeGreaterThan(1);
    expect(FIXTURE.played.score).toBeGreaterThan(0);
    expect(FIXTURE.log.entries.length).toBeGreaterThan(100);
  });

  it("uses every action bit, so no action is verified only in theory", () => {
    const seen = new Set<string>();
    for (const [, mask] of FIXTURE.log.entries) {
      for (const [action, bit] of Object.entries(ACTION_BITS)) if (mask & bit) seen.add(action);
    }
    expect([...seen].sort()).toEqual(
      ["HardDrop", "Hold", "MoveLeft", "MoveRight", "RotateCCW", "RotateCW", "SoftDrop"].sort(),
    );
  });
});

describe("a captured log replays to the score it was played at", () => {
  it("the verifier reproduces the live simulation's score, level, lines and ticks", () => {
    const verdict = verifyRunLog(log());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.run.score).toBe(FIXTURE.played.score);
    expect(verdict.run.level).toBe(FIXTURE.played.level);
    expect(verdict.run.lines).toBe(FIXTURE.played.lines);
    expect(verdict.run.ticks).toBe(FIXTURE.played.ticks);
  });

  it("the same module is what the browser runs, so client and server cannot disagree", () => {
    // The client calls `verifyRunLog` on every finished run (`TetriceScreen`) and the route
    // calls it on every submission. This asserts the property that makes that worth doing:
    // one input, one answer, no second implementation.
    const a = verifyRunLog(log());
    const b = verifyRunLog(log());
    expect(a).toEqual(b);
    // ...and it agrees with driving `step()` by hand, which is what "the replayer IS the
    // step function" means.
    const perTick = actionsAt(FIXTURE.log.entries, FIXTURE.log.ticks);
    let s = createInitialState(FIXTURE.log.seed);
    for (let t = 0; t < FIXTURE.log.ticks && !s.over; t++) s = step(s, perTick[t], t);
    expect(s.score).toBe(FIXTURE.played.score);
  });

  it("derives the duration from ticks, and stores no clock the client sent", () => {
    const verdict = verifyRunLog(log());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.run.durationMs).toBe(durationMsFromTicks(FIXTURE.played.ticks));
    // The format has nowhere to put a time. This is the assertion that keeps it that way.
    expect(Object.keys(FIXTURE.log).sort()).toEqual(["engineVersion", "entries", "seed", "ticks"]);
  });
});

describe("a tampered log does not verify", () => {
  it("REJECTS a flipped frame — and the flip changes the score, so silence would be a bug", () => {
    // Find an entry carrying a hard drop and turn it into a rotation. The log stays
    // perfectly well-formed: ascending frames, legal masks, right length. Only the RUN
    // changes.
    const entries = log().entries.map((e) => [e[0], e[1]] as LogEntry);
    const at = entries.findIndex(([, mask]) => (mask & ACTION_BITS.HardDrop) !== 0);
    expect(at).toBeGreaterThanOrEqual(0);
    // The replacement must differ from BOTH neighbours, or the log is malformed for a
    // reason that has nothing to do with the flip — the recorder only writes on change, so
    // two equal masks in a row is a structural 400 and would mask what this test is for.
    const flipped = distinctMask(entries, at);
    entries[at] = [entries[at][0], flipped];

    const tampered = log({ entries });
    const verdict = verifyRunLog(tampered);

    // TWO THINGS ARE ASSERTED, because either alone would pass on a broken verifier:
    //   1. the flip really does change the run — otherwise this test proves nothing;
    //   2. and the verifier does not quietly accept it at the original score.
    const replayed = replay(tampered);
    expect(replayed.score).not.toBe(FIXTURE.played.score);

    if (verdict.ok) {
      // A flip can leave a run that still ends legitimately — at a DIFFERENT score. That is
      // the honest outcome, and the thing that must never happen is it being accepted at
      // the score the original run had.
      expect(verdict.run.score).not.toBe(FIXTURE.played.score);
      expect(verdict.run.score).toBe(replayed.score);
    } else {
      // Or the flip breaks the ending — the run no longer tops out exactly when the log
      // says. Also correct, and it is a 422.
      expect(verdict.status).toBe(422);
    }
  });

  it("REJECTS a log claiming a score by rewriting the seed", () => {
    // The classic forgery: keep a real log, change the seed to one that deals better
    // pieces. The route never reads this field — it uses the seed IT issued — but the
    // verifier must not bless it either.
    const verdict = verifyRunLog(log({ seed: (FIXTURE.log.seed ^ 0x5f5f5f5f) >>> 0 }));
    if (verdict.ok) expect(verdict.run.score).not.toBe(FIXTURE.played.score);
    else expect(verdict.status).toBe(422);
  });

  it("REJECTS TRAILING INPUT PAST THE TOP-OUT TICK — the one step() absorbs in silence", () => {
    // `step()` returns the state unchanged once `over` is set. That is right for the
    // engine (a replayer looping to the end of a trace runs past the end, ordinarily) and
    // WRONG for a verifier: appending frames after the run ended must not be absorbed.
    const entries = log().entries.map((e) => [e[0], e[1]] as LogEntry);
    const lastMask = entries[entries.length - 1][1];
    const appended: LogEntry = [
      FIXTURE.log.ticks + 10,
      lastMask === ACTION_BITS.MoveLeft ? ACTION_BITS.RotateCW : ACTION_BITS.MoveLeft,
    ];
    const extended = log({ ticks: FIXTURE.log.ticks + 120, entries: [...entries, appended] });

    // THE CONTROL FIRST: prove the engine really does absorb it, so the rejection below is
    // the verifier's doing and not the engine's. Feeding those extra ticks changes nothing.
    const absorbed = replay(extended);
    expect(absorbed.ticks).toBe(FIXTURE.played.ticks);
    expect(absorbed.score).toBe(FIXTURE.played.score);
    expect(absorbed.over).toBe(true);

    // ...and the verifier refuses it anyway, because the run ended before the log did.
    const verdict = verifyRunLog(extended);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.status).toBe(422);
    expect(verdict.reason).toMatch(/topped out before the log ended/);
  });

  it("REJECTS an entry past the end of the run, without an inflated tick count", () => {
    // The same tampering done the other way: leave `ticks` alone and append an entry the
    // replay can never reach. Structural, so it is a 400.
    const entries = [...log().entries, [FIXTURE.log.ticks + 5, ACTION_BITS.HardDrop] as LogEntry];
    const verdict = verifyRunLog(log({ entries }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.status).toBe(400);
  });

  it("REJECTS a truncated log — a run that never topped out did not finish", () => {
    // Cut the tail off BOTH halves, so the log stays internally consistent and the only
    // thing wrong with it is that the run it describes never ended.
    const cut = Math.floor(FIXTURE.log.ticks / 2);
    const entries = log().entries.filter(([frame]) => frame < cut);
    const verdict = verifyRunLog(log({ ticks: cut, entries }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.status).toBe(422);
    expect(verdict.reason).toMatch(/did not end/);
  });

  it("REJECTS frame indices that go backwards", () => {
    const entries = log().entries.map((e) => [e[0], e[1]] as LogEntry);
    // Swap two adjacent frames. Both are legal indices; only the ORDER is wrong.
    const i = 40;
    [entries[i], entries[i + 1]] = [
      [entries[i + 1][0], entries[i][1]],
      [entries[i][0], entries[i + 1][1]],
    ];
    const verdict = verifyRunLog(log({ entries }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.status).toBe(400);
    expect(verdict.reason).toMatch(/ascending/);
  });

  it("REJECTS a run longer than the verifier will simulate", () => {
    const verdict = verifyRunLog(log({ ticks: MAX_REPLAY_TICKS + 1 }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.status).toBe(400);
    // Bounds are checked BEFORE the loop: the point is not to simulate a hostile log at all.
    expect(verdict.reason).toMatch(/too long/);
  });

  it("REJECTS a zero-score run", () => {
    // An empty log tops out on gravity alone and scores nothing. There is no board row in
    // that, and it is the cheapest thing to submit in a loop.
    const empty = { seed: 1, engineVersion: ENGINE_VERSION, ticks: 20_000, entries: [] as LogEntry[] };
    const verdict = verifyRunLog(empty);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.status).toBe(422);
  });

  it("REFUSES an unknown engine version rather than rescoring it under today's rules", () => {
    const verdict = verifyRunLog(log({ engineVersion: ENGINE_VERSION + 1 }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.status).toBe(409);
  });
});

describe("parseRunLog rejects shapes before the verifier sees them", () => {
  it("takes the real fixture", () => {
    const parsed = parseRunLog(JSON.parse(JSON.stringify(FIXTURE.log)));
    expect(parsed.ok).toBe(true);
  });

  it.each([
    ["not an object", 42],
    ["no entries", { seed: 1, engineVersion: 1, ticks: 10 }],
    ["entries not pairs", { seed: 1, engineVersion: 1, ticks: 10, entries: [[1]] }],
    ["negative frame", { seed: 1, engineVersion: 1, ticks: 10, entries: [[-1, 1]] }],
    ["mask out of range", { seed: 1, engineVersion: 1, ticks: 10, entries: [[0, 0xff]] }],
    ["seed out of range", { seed: 2 ** 33, engineVersion: 1, ticks: 10, entries: [] }],
    ["fractional ticks", { seed: 1, engineVersion: 1, ticks: 1.5, entries: [] }],
  ])("rejects %s", (_label, raw) => {
    expect(parseRunLog(raw).ok).toBe(false);
  });
});
