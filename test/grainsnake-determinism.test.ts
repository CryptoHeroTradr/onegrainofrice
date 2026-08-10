/**
 * Determinism — the property the whole leaderboard rests on.
 *
 * The spec (*Acceptance criteria*) requires this be asserted at a simulated 120 Hz
 * and 45 Hz as well as 60, and says why: a frame-counting loop is PERFECTLY
 * deterministic at every refresh rate — it just plays a different game at each. A
 * suite that only ever feeds 16.67 ms frames cannot see that, which makes it a test
 * that passes on the broken version.
 *
 * So the frame-counted driver is kept in `grainsnake-support.ts` and this file turns
 * it on deliberately, as the control. A reading with no control measures the
 * instrument.
 */
import { describe, it, expect } from "vitest";
import { drainTicks, runLog, snapshot } from "@/lib/grainsnake/engine";
import { DOWN, LEFT, RIGHT, UP, type Dir, type InputEvent } from "@/lib/grainsnake/types";
import {
  driveAccumulated,
  driveFrameCounted,
  expectCouldHaveDied,
} from "./grainsnake-support";

/**
 * A fixed route that stays on the board for the whole comparison window.
 *
 * A large box rather than a tight weave, and that is not cosmetic: a script that
 * kills the snake early makes every assertion in this file a comparison of two
 * identical corpses, which is how the vacuous pass of 2026-08-07 survived. Turns are
 * placed just after a step boundary (steps land every 10 ticks in tier 1) so each leg
 * gets its full run before the queue drains the next one.
 */
const SCRIPT: InputEvent[] = [
  { tick: 0, dir: RIGHT },
  { tick: 91, dir: DOWN },
  { tick: 181, dir: LEFT },
  { tick: 271, dir: UP },
  { tick: 361, dir: RIGHT },
];

const BY_TICK = new Map<number, Dir>(SCRIPT.map((e) => [e.tick, e.dir]));

/**
 * CHOSEN, not arbitrary: with `SCRIPT` this seed puts two grains on the route inside
 * the comparison window.
 *
 * That matters because the PRNG is only drawn from when something is eaten. On a seed
 * where the route happens to miss every grain, the run makes exactly one draw — the
 * opening spawn — and the determinism comparison degenerates into checking that a
 * snake walks in a box the same way twice. Eating is what puts the random stream, the
 * growth path and the score into the thing being compared.
 */
const SEED = 162;
const TARGET_TICKS = 400;
/** Grains the route is known to reach in the window. Pinned so a drift is loud. */
const EXPECTED_FOOD = 2;

/** 120 Hz, 60 Hz and 45 Hz, as frame intervals in milliseconds. */
const FRAME_RATES: ReadonlyArray<{ hz: number; ms: number }> = [
  { hz: 120, ms: 1000 / 120 },
  { hz: 60, ms: 1000 / 60 },
  { hz: 45, ms: 1000 / 45 },
];

describe("determinism", () => {
  /**
   * THE GUARD THAT STOPS THIS WHOLE FILE PASSING VACUOUSLY.
   *
   * *Added 2026-08-07, after it did exactly that.* Every script here opens with
   * RIGHT, which was the starting direction, and `steer()` dropped it as a no-op
   * repeat — so the run never started, `tick` stayed 0, and two never-started states
   * compared equal. Four assertions were green while the engine was not running at
   * all.
   *
   * "A value equal to the default measures nothing." Any run this suite compares has
   * to have actually happened: started, ticked to the target, and still alive, so
   * that the comparison is over a run rather than over two identical corpses.
   */
  function assertRan(s: ReturnType<typeof runLog>, label: string): void {
    expect(s.started, `${label}: never started`).toBe(true);
    expect(s.tick, `${label}: did not reach the target tick`).toBe(TARGET_TICKS);
    // Not merely "did not die" — death has to have been POSSIBLE for that to mean
    // anything. Since ENGINE_VERSION 2 removed the walls, self-collision is the only
    // death in the game and it cannot happen below MIN_LETHAL_LENGTH, so a comparison
    // run that stayed short would be asserting survival it could not have failed.
    expectCouldHaveDied(s, label);
    expect(s.dead, `${label}: died before the comparison point`).toBe(false);
    // Eating is what puts the PRNG stream, growth and scoring into the comparison.
    expect(s.foodEaten, `${label}: never ate, so the RNG was never drawn`).toBe(EXPECTED_FOOD);
    expect(s.score, `${label}: ate without scoring`).toBeGreaterThan(0);
  }

  it("the scripted run actually runs — started, alive, and fed", () => {
    assertRan(runLog(SEED, SCRIPT, TARGET_TICKS), "reference run");
  });

  it("same seed and same input log produce an identical final state", () => {
    const a = runLog(SEED, SCRIPT, TARGET_TICKS);
    const b = runLog(SEED, SCRIPT, TARGET_TICKS);
    assertRan(a, "run a");
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it("a different seed produces a different run — the run is actually seeded", () => {
    // Without this, the assertion above is satisfied by an engine that ignores its
    // seed entirely, which is the degenerate way to be deterministic.
    const a = runLog(SEED, SCRIPT, TARGET_TICKS);
    const b = runLog(SEED + 1, SCRIPT, TARGET_TICKS);
    expect(snapshot(a)).not.toBe(snapshot(b));
  });

  it("is identical at 120 Hz, 60 Hz and 45 Hz tick delivery", () => {
    const runs = FRAME_RATES.map(({ ms }) =>
      driveAccumulated(SEED, BY_TICK, TARGET_TICKS, ms, drainTicks),
    );
    const shots = runs.map(snapshot);
    // Every rate against the first, so a failure names which rate diverged.
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i], `${FRAME_RATES[i].hz} Hz diverged from ${FRAME_RATES[0].hz} Hz`).toBe(
        shots[0],
      );
    }
  });

  it("matches the plain tick-driven run at every frame rate", () => {
    // The accumulator harness must agree with the bare loop, or it is measuring
    // itself rather than the engine.
    const plain = snapshot(runLog(SEED, SCRIPT, TARGET_TICKS));
    for (const { hz, ms } of FRAME_RATES) {
      const driven = snapshot(driveAccumulated(SEED, BY_TICK, TARGET_TICKS, ms, drainTicks));
      expect(driven, `${hz} Hz disagreed with the tick-driven run`).toBe(plain);
    }
  });

  it("CONTROL: a frame-counting driver diverges across frame rates", () => {
    // Run it against the failure. Counting frames means 400 frames is 400 ticks at
    // any rate, so the same wall-clock produces different amounts of game — which is
    // exactly the bug, and it must be visible to this suite.
    const wallMs = TARGET_TICKS * (1000 / 60);
    const at120 = driveFrameCounted(SEED, BY_TICK, Math.round(wallMs / (1000 / 120)));
    const at60 = driveFrameCounted(SEED, BY_TICK, Math.round(wallMs / (1000 / 60)));
    expect(snapshot(at120)).not.toBe(snapshot(at60));
  });

  it("the accumulator clamp bounds a returning backgrounded tab", () => {
    // 40 seconds of debt must not be spent in one frame.
    const d = drainTicks(0, 40_000);
    expect(d.clamped).toBe(true);
    expect(d.ticks).toBeLessThanOrEqual(6);
    expect(d.accumulator).toBe(0);
  });

  it("the accumulator carries fractional time rather than dropping it", () => {
    // At 120 Hz every frame is half a tick: two frames must produce exactly one tick,
    // not zero. Dropping the remainder is how a loop silently runs slow.
    let acc = 0;
    let total = 0;
    for (let i = 0; i < 120; i++) {
      const d = drainTicks(acc, 1000 / 120);
      acc = d.accumulator;
      total += d.ticks;
    }
    expect(total).toBe(60);
  });
});
