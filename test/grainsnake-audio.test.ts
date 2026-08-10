/**
 * Feedback must not be gameplay.
 *
 * Audio and particles are DERIVED from state transitions the host observes between
 * ticks. The obvious wiring — `playEat()` inside the step function — is the thing
 * that must never happen, because **the run is replayed server-side by a Node process
 * with no speakers**, and a step function that reaches for an AudioContext cannot be
 * the replayer.
 *
 * So the property under test is blunt: a run observed by the cue watcher and the fx
 * layer is BIT-IDENTICAL to one that is not, and it is identical again with reduced
 * motion on. Not "looks the same" — the same snapshot string.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createGame, neighbour, segmentAt, snapshot } from "@/lib/grainsnake/engine";
import { TIERS, tierIndexFor } from "@/lib/grainsnake/rules";
import { type GameState } from "@/lib/grainsnake/types";
import { createCueWatch, observeCues } from "@/components/grainsnake/audio";
import {
  NO_TRAIL_FX,
  burstDeath,
  burstEat,
  burstTierUp,
  createFx,
  resetFx,
  shakeOffset,
  stepFx,
  trailFx,
} from "@/components/grainsnake/fx";
import {
  MIN_LETHAL_LENGTH,
  dieBySelfCollision,
  feed,
  safeDir,
  stepOneCell,
} from "./grainsnake-support";

const PX = 15;

/**
 * Play a fixed run, optionally driving the observers.
 *
 * Stepped per CELL rather than per tick: the survival bot does a flood fill per
 * candidate direction, and calling it on all ten ticks of a tier-1 step was ~40×
 * the work for the same route. Cues fire on state CHANGES, and state changes on a
 * step — so observing per cell observes everything there is to observe.
 *
 * The run is ended deliberately at the end rather than left to the bot, because the
 * bot's whole job is not to die and the death cue has to be exercised.
 */
function playRun(observe: boolean, reduced: boolean): string {
  const s = createGame(162);
  const fx = createFx();
  const watch = createCueWatch(s);

  const tick = () => {
    if (!observe) return;
    const cues = observeCues(watch, s);
    if (cues.ate || cues.golden) burstEat(fx, s.grain, PX, cues.golden, reduced);
    if (cues.tierUp) burstTierUp(fx, PX, reduced);
    if (cues.died) burstDeath(fx, [s.grain], PX, reduced);
    stepFx(fx, 1 / 60, PX);
    shakeOffset(fx);
    trailFx(fx);
  };

  // Feed it far enough to cross at least one tier boundary.
  for (let i = 0; i < 30 && !s.dead && !s.filled; i++) {
    const d = safeDir(s);
    if (d === null) break;
    s.grain = neighbour(segmentAt(s, 0), d); // eat every step, so this stays short
    stepOneCell(s, d === s.dir ? null : d);
    tick();
  }

  /**
   * Now end it, ON PURPOSE. *Rewritten 2026-08-08, ENGINE_VERSION 2.*
   *
   * This used to read "hold one direction until the wall arrives", with a 60-step
   * guard. Wrapping removed the wall, and the manoeuvre did not fail — it got worse in
   * the way that still passes. At the length this run reaches (33) the snake laps the
   * 23-wide torus and dies of an INCIDENTAL self-collision, a death nobody asked for at
   * a tick nobody predicted; shorten the feed below ~20 and it circles forever and the
   * guard expires on a LIVE snake, with every assertion in this file still green
   * because they compare two runs that are wrong in the same way.
   *
   * So it is replaced rather than repaired: `dieBySelfCollision` coils until a lethal
   * move exists and then takes it, which is deterministic in both halves and ends the
   * run for a reason this file can name.
   */
  const before = s.dead;
  const death = dieBySelfCollision(s);
  if (before || !s.dead || !death.wasOwnTrail) {
    throw new Error("playRun did not end on a deliberate self-collision");
  }
  tick();
  return snapshot(s);
}

describe("observing a run cannot change it", () => {
  it("is bit-identical observed and unobserved", () => {
    expect(playRun(true, false)).toBe(playRun(false, false));
  });

  it("is bit-identical with reduced motion on", () => {
    // The requirement, stated exactly: reduced motion changes no tick, no rule and no
    // timing. It changes what is DRAWN and nothing else.
    expect(playRun(true, true)).toBe(playRun(true, false));
    expect(playRun(true, true)).toBe(playRun(false, false));
  });

  it("the run under test is a real one — it ate, tiered up and died", () => {
    // Without this the assertions above are satisfied by a run that never happened.
    //
    // **THE TITLE SAYS "died" AND NOW THE TEST DOES TOO.** *2026-08-08.* It asserted
    // food and tier and never death, which made it the one test that could have caught
    // the wall-terminator above going quiet, not catching it. A title that names a
    // property the body does not check is worse than no test: it is a claim in the
    // report that nothing backs.
    const s = createGame(162);
    feed(s, 20);
    expect(s.foodEaten).toBe(20);
    expect(tierIndexFor(s.foodEaten)).toBeGreaterThan(0);
    expect(s.dead, "the fixture died while being fed").toBe(false);
    expect(s.length, "too short for death to be possible").toBeGreaterThanOrEqual(
      MIN_LETHAL_LENGTH,
    );

    const death = dieBySelfCollision(s);
    expect(s.dead, "the run never ended").toBe(true);
    expect(death.wasOwnTrail, "ended for some reason other than its own trail").toBe(true);
  });
});

describe("cues describe what happened, once each", () => {
  function fresh(): { s: GameState; w: ReturnType<typeof createCueWatch> } {
    const s = createGame(162);
    return { s, w: createCueWatch(s) };
  }

  it("reports nothing on a step that ate nothing", () => {
    const { s, w } = fresh();
    s.started = true;
    stepOneCell(s, null);
    const c = observeCues(w, s);
    expect(c.ate || c.golden || c.tierUp || c.died).toBe(false);
  });

  it("reports an eat exactly once", () => {
    const { s, w } = fresh();
    feed(s, 1);
    expect(observeCues(w, s).ate).toBe(true);
    // The watch has moved on; the same state must not report it again.
    expect(observeCues(w, s).ate).toBe(false);
  });

  it("never reports an ordinary eat and a golden on the same tick", () => {
    // They would mask each other: two clips on one frame is one muddled clip.
    const { s, w } = fresh();
    s.foodEaten = 5;
    s.goldensTaken = 1;
    const c = observeCues(w, s);
    expect(c.golden).toBe(true);
    expect(c.ate).toBe(false);
  });

  it("reports a tier change when the threshold is crossed", () => {
    const { s, w } = fresh();
    s.foodEaten = TIERS[1].fromFood;
    expect(observeCues(w, s).tierUp).toBe(true);
  });

  it("reports death and a filled board as the same terminal cue", () => {
    const a = fresh();
    a.s.dead = true;
    expect(observeCues(a.w, a.s).died).toBe(true);

    const b = fresh();
    b.s.filled = true;
    expect(observeCues(b.w, b.s).died).toBe(true);
  });
});

describe("reduced motion kills the motion and nothing else", () => {
  it("spawns no particles and no shake", () => {
    const fx = createFx();
    burstEat(fx, 100, PX, false, true);
    burstTierUp(fx, PX, true);
    burstDeath(fx, [1, 2, 3, 4, 5], PX, true);
    expect(fx.count).toBe(0);
    expect(fx.shake).toBe(0);
    expect(fx.headPop).toBe(0);
    // ...and the new segment is at full size immediately rather than growing in.
    expect(fx.tailGrow).toBe(1);
    expect(shakeOffset(fx)).toEqual([0, 0]);
  });

  it("CONTROL: without it, all three DO happen", () => {
    // A test that only ever asserts absence is satisfied by an fx layer that does
    // nothing at all.
    const fx = createFx();
    burstEat(fx, 100, PX, false, false);
    expect(fx.count).toBeGreaterThan(0);
    expect(fx.headPop).toBe(1);
    expect(fx.tailGrow).toBeLessThan(1);

    resetFx(fx);
    burstTierUp(fx, PX, false);
    expect(fx.shake).toBeGreaterThan(0);

    resetFx(fx);
    burstDeath(fx, [1, 2, 3, 4, 5], PX, false);
    expect(fx.count).toBeGreaterThan(0);
    expect(fx.shake).toBeGreaterThan(0);
  });
});

describe("the fx layer holds 60fps at maximum trail length", () => {
  it("never allocates past its pool, however much it is asked to spawn", () => {
    const fx = createFx();
    // Far more bursts than a real run can produce in one frame.
    for (let i = 0; i < 200; i++) burstEat(fx, i, PX, true, false);
    expect(fx.count).toBeLessThanOrEqual(fx.life.length);
    expect(fx.x.length).toBe(512);
  });

  it("scatters a maximum-length trail without one particle per segment", () => {
    // 529 husks at once is the slideshow this samples along the trail to avoid.
    const fx = createFx();
    const whole = Array.from({ length: 529 }, (_, i) => i);
    burstDeath(fx, whole, PX, false);
    expect(fx.count).toBeLessThanOrEqual(120);
    expect(fx.count).toBeGreaterThan(40);
  });

  it("retires particles rather than leaking them", () => {
    const fx = createFx();
    burstEat(fx, 100, PX, false, false);
    expect(fx.count).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) stepFx(fx, 1 / 60, PX);
    expect(fx.count).toBe(0);
    expect(fx.shake).toBe(0);
    expect(fx.headPop).toBe(0);
    expect(fx.tailGrow).toBe(1);
  });
});

describe("the trail is not touched", () => {
  const SRC = join(__dirname, "..", "src", "components", "grainsnake");

  it("render.ts still has the gate-validated constants", () => {
    const src = readFileSync(join(SRC, "render.ts"), "utf8");
    expect(src).toMatch(/const SEG_LONG = 0\.62/);
    expect(src).toMatch(/const SEG_SHORT = 0\.29/);
    expect(src).toMatch(/const HEAD_LONG = 0\.54/);
    // Jitter still keyed on the ring slot, not the index from the head.
    expect(src).toMatch(/function jitterFor\(ringPos: number\)/);
    // Still drawn tail → head.
    expect(src).toMatch(/for \(let j = state\.length - 1; j >= 1; j--\)/);
  });

  it("the default trail fx is a no-op", () => {
    // `paint()` with no fx argument must draw exactly what it drew before feedback
    // existed — which is what keeps grainsnake-render.test.ts measuring the geometry
    // the gate signed off.
    expect(NO_TRAIL_FX.headPop).toBe(0);
    expect(NO_TRAIL_FX.tailGrow).toBe(1);
  });

  it("fx.ts never imports the renderer's internals", () => {
    const src = readFileSync(join(SRC, "fx.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\/render["']/);
  });
});
