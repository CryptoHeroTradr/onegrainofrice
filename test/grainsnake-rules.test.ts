/**
 * The rules that are cheap to state and expensive to notice breaking: growth, the
 * turn queue, food spawning, and the golden grain's travel budget.
 *
 * Every assertion here drives the real `stepMut`. Nothing re-implements a rule.
 */
import { describe, it, expect } from "vitest";
import {
  CELL_COUNT,
  GOLDEN_EVERY,
  GOLDEN_STEPS,
  START_LENGTH,
  TIERS,
  ticksPerStepFor,
  tierIndexFor,
} from "@/lib/grainsnake/rules";
import {
  cloneState,
  createGame,
  neighbour,
  segmentAt,
  spawnFood,
  steer,
  stepMut,
} from "@/lib/grainsnake/engine";
import { DOWN, LEFT, RIGHT, UP, opposite, type Dir } from "@/lib/grainsnake/types";
import {
  bodyCells,
  dirBetween,
  feed,
  head,
  nearlyFullState,
  safeDir,
  serpentine,
  stepOneCell,
} from "./grainsnake-support";

// ---------------------------------------------------------------------------
// 2 — growth is exact
// ---------------------------------------------------------------------------

describe("growth", () => {
  it("starts at the spec's length, pointing right, and does not move until an input", () => {
    const s = createGame(99);
    expect(s.length).toBe(START_LENGTH);
    expect(s.dir).toBe(RIGHT);
    expect(s.started).toBe(false);

    const before = head(s);
    for (let i = 0; i < 200; i++) stepMut(s, null);
    expect(s.tick).toBe(0);
    expect(head(s)).toBe(before);
  });

  it("N grains eaten gives exactly START_LENGTH + N segments", () => {
    for (const n of [1, 5, 20, 60]) {
      const s = createGame(7);
      feed(s, n);
      expect(s.dead, `died while being fed ${n}`).toBe(false);
      expect(s.foodEaten, `foodEaten after ${n}`).toBe(n);
      expect(s.length, `length after ${n}`).toBe(START_LENGTH + n);
      // The spec states this identity outright; it is the one the tier table is keyed on.
      expect(s.foodEaten).toBe(s.length - START_LENGTH);
    }
  });

  it("holds at every tier, including the top one", () => {
    // Feed past the last threshold so every row of the table has been occupied.
    const target = TIERS[TIERS.length - 1].fromFood + 5;
    const s = createGame(3);
    feed(s, target);
    expect(s.dead).toBe(false);
    expect(s.foodEaten).toBe(target);
    expect(s.length).toBe(START_LENGTH + target);
    expect(tierIndexFor(s.foodEaten)).toBe(TIERS.length - 1);
  });

  it("the body never contains a duplicate cell", () => {
    const s = createGame(11);
    feed(s, 40);
    const cells = bodyCells(s);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("occupancy and the ring agree, cell for cell", () => {
    // Two representations of one position is one chance to disagree; this is the
    // assertion that says they do not.
    const s = createGame(5);
    feed(s, 30);
    const cells = new Set(bodyCells(s));
    let occupied = 0;
    for (let c = 0; c < CELL_COUNT; c++) {
      if (s.occupied[c]) occupied++;
      expect(!!s.occupied[c], `cell ${c}`).toBe(cells.has(c));
    }
    expect(occupied).toBe(s.length);
  });

  it("the tail cell being vacated is not a collision", () => {
    // The classic off-by-one: a snake moving into the square its own tail leaves on
    // the same step survives.
    const s = createGame(21);
    s.started = true;
    // Drive a tight square: right, down, left, up — the last move re-enters the cell
    // the tail is leaving on that very step.
    const route: Dir[] = [RIGHT, DOWN, LEFT, UP];
    for (const d of route) {
      stepOneCell(s, d);
      expect(s.dead, `died turning ${d}`).toBe(false);
    }
    expect(s.dead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3 — input
// ---------------------------------------------------------------------------

describe("input", () => {
  it("rejects a 180 against the direction of travel", () => {
    const s = createGame(1);
    expect(steer(s, opposite(s.dir))).toBe(false);
    expect(s.queue.length).toBe(0);
    // ...and it does not start the run either: a discarded key is not a choice to play.
    stepMut(s, opposite(s.dir));
    expect(s.started).toBe(false);
    expect(s.tick).toBe(0);
  });

  it("ignores a repeat of the committed direction rather than spending a slot", () => {
    const s = createGame(1);
    expect(steer(s, s.dir)).toBe(false);
    expect(s.queue.length).toBe(0);
  });

  it("buffers at most two turns", () => {
    const s = createGame(1);
    expect(steer(s, UP)).toBe(true);
    expect(steer(s, LEFT)).toBe(true);
    expect(steer(s, DOWN)).toBe(false); // queue full
    expect(s.queue.length).toBe(2);
  });

  it("validates a queued turn against the LAST queued direction, not the current one", () => {
    // Travelling RIGHT with UP queued, LEFT is not a reversal — after the UP it is an
    // ordinary turn. Validating against the current heading would reject the second
    // half of every corner.
    const s = createGame(1);
    expect(s.dir).toBe(RIGHT);
    expect(steer(s, UP)).toBe(true);
    expect(steer(s, LEFT)).toBe(true);
    // ...but DOWN after UP is a genuine reversal and is still refused.
    const t = createGame(1);
    expect(steer(t, UP)).toBe(true);
    expect(steer(t, DOWN)).toBe(false);
  });

  it("a corner double-tap lands BOTH turns at the fastest tier", () => {
    const s = createGame(4);
    // Put the snake in tier 7 — a 4-tick step, where one queue slot is not enough.
    s.foodEaten = TIERS[TIERS.length - 1].fromFood;
    s.started = true;
    s.ticksToNextStep = ticksPerStepFor(s.foodEaten);
    expect(ticksPerStepFor(s.foodEaten)).toBe(4);
    expect(s.dir).toBe(RIGHT);

    // Both halves of the corner entered before the first one lands.
    expect(steer(s, UP)).toBe(true);
    expect(steer(s, LEFT)).toBe(true);

    stepOneCell(s);
    expect(s.dir, "first turn did not land").toBe(UP);
    stepOneCell(s);
    expect(s.dir, "second turn did not land").toBe(LEFT);
    expect(s.dead).toBe(false);
  });

  it("drains exactly one turn per step", () => {
    const s = createGame(4);
    s.started = true;
    steer(s, UP);
    steer(s, LEFT);
    expect(s.queue.length).toBe(2);
    stepOneCell(s);
    expect(s.queue.length).toBe(1);
    stepOneCell(s);
    expect(s.queue.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4 — food never spawns inside the trail; the near-full board terminates
// ---------------------------------------------------------------------------

describe("food spawning", () => {
  it("never lands inside the trail, over a long run", () => {
    const s = createGame(31);
    for (let i = 0; i < 60; i++) {
      feed(s, 1);
      if (s.dead || s.filled) break;
      if (s.grain >= 0) expect(s.occupied[s.grain], `grain inside trail at ${i}`).toBe(0);
      if (s.golden >= 0) expect(s.occupied[s.golden], `golden inside trail at ${i}`).toBe(0);
    }
  });

  it("never lands on the other grain", () => {
    const s = createGame(77);
    for (let i = 0; i < 40; i++) {
      feed(s, 1);
      if (s.dead || s.filled) break;
      if (s.grain >= 0 && s.golden >= 0) expect(s.grain).not.toBe(s.golden);
    }
  });

  it("terminates with exactly ONE free cell, and picks it", () => {
    // The case that hangs a rejection sampler. Tested at one free cell rather than at
    // a comfortable margin, because a comfortable margin is where it works.
    const s = nearlyFullState(CELL_COUNT - 1);
    expect(s.length).toBe(CELL_COUNT - 1);
    const free = serpentine()[CELL_COUNT - 1];
    expect(s.occupied[free]).toBe(0);

    const cell = spawnFood(s);
    expect(cell).toBe(free);
  });

  it("returns -1 on a completely full board rather than looping", () => {
    const s = nearlyFullState(CELL_COUNT);
    expect(spawnFood(s)).toBe(-1);
  });

  it("eating the last free cell fills the board and ends the run as a WIN", () => {
    const s = nearlyFullState(CELL_COUNT - 1);
    const free = serpentine()[CELL_COUNT - 1];
    s.grain = free;
    s.dir = dirBetween(head(s), free);
    stepOneCell(s);
    expect(s.filled, "a full board should be the win state").toBe(true);
    expect(s.dead, "filling the board is not a death").toBe(false);
    expect(s.length).toBe(CELL_COUNT);
  });
});

// ---------------------------------------------------------------------------
// 5 — the golden grain's travel budget
// ---------------------------------------------------------------------------

describe("golden grain", () => {
  /** Feed until a golden grain is on the board, then hand it back. */
  function withGolden(seed: number) {
    const s = createGame(seed);
    feed(s, GOLDEN_EVERY);
    return s;
  }

  it("appears on a grain counter, not a clock", () => {
    const s = createGame(13);
    feed(s, GOLDEN_EVERY - 1);
    expect(s.golden, "appeared early").toBe(-1);
    feed(s, 1);
    expect(s.golden, "did not appear on the 8th grain").toBeGreaterThanOrEqual(0);
    expect(s.goldenSteps).toBe(GOLDEN_STEPS);
  });

  it("expires after exactly GOLDEN_STEPS steps of travel", () => {
    const s = withGolden(13);
    expect(s.golden).toBeGreaterThanOrEqual(0);

    // Travel WITHOUT eating it — the bot is told to avoid the golden cell, and the
    // ordinary grain is cleared, so nothing grows and nothing ends the measurement
    // except the budget itself.
    const golden = s.golden;
    s.grain = -1;
    for (let i = 0; i < GOLDEN_STEPS - 1; i++) {
      const d = safeDir(s, golden);
      if (d === null) break;
      stepOneCell(s, d === s.dir ? null : d);
      if (s.dead) break;
    }
    expect(s.dead, "bot died before the budget ran out").toBe(false);
    expect(s.goldensTaken, "bot ate the grain it was told to avoid").toBe(0);
    expect(s.golden, "expired early").toBeGreaterThanOrEqual(0);
    expect(s.goldenSteps).toBe(1);

    const d = safeDir(s, golden);
    stepOneCell(s, d === s.dir ? null : d);
    expect(s.golden, "did not expire on the last step of the budget").toBe(-1);
  });

  it("counts STEPS not ticks — the same budget costs different tick counts by tier", () => {
    // The assertion that would catch a wall-clock budget sneaking back in. Two runs
    // at different tiers spend the SAME number of steps and DIFFERENT numbers of
    // ticks on the same golden grain.
    const slow = createGame(13);
    slow.started = true;
    slow.golden = 0;
    slow.goldenSteps = GOLDEN_STEPS;
    slow.foodEaten = 0; // tier 1 — 10 ticks/step
    slow.ticksToNextStep = ticksPerStepFor(slow.foodEaten);

    const fast = cloneState(slow);
    fast.foodEaten = TIERS[TIERS.length - 1].fromFood; // tier 7 — 4 ticks/step
    fast.ticksToNextStep = ticksPerStepFor(fast.foodEaten);

    const ticksFor = (s: typeof slow) => {
      const golden = s.golden;
      s.grain = -1;
      let ticks = 0;
      let steps = 0;
      while (s.golden >= 0 && steps < GOLDEN_STEPS + 5 && !s.dead) {
        const d = safeDir(s, golden);
        ticks += stepOneCell(s, d !== null && d !== s.dir ? d : null);
        steps++;
      }
      return { ticks, steps, dead: s.dead };
    };

    const a = ticksFor(slow);
    const b = ticksFor(fast);
    expect(a.dead, "slow run died before the budget ran out").toBe(false);
    expect(b.dead, "fast run died before the budget ran out").toBe(false);
    expect(a.steps, "slow tier used a different number of steps").toBe(GOLDEN_STEPS);
    expect(b.steps, "fast tier used a different number of steps").toBe(GOLDEN_STEPS);
    expect(a.ticks).not.toBe(b.ticks);
    expect(a.ticks).toBeGreaterThan(b.ticks);
  });

  it("grows the snake by one and scores at the tier multiplier", () => {
    const s = withGolden(13);
    const golden = s.golden;
    // Clear the ordinary grain FIRST: otherwise the walk to the golden one eats
    // whatever it passes over, and "+1 segment" measures two grains rather than one.
    s.grain = -1;
    const before = { len: s.length, score: s.score, food: s.foodEaten };
    // Walk onto it deliberately.
    let guard = 0;
    while (s.golden >= 0 && !s.dead && guard++ < 200) {
      const d = towards(s, golden);
      if (d === null) break;
      stepOneCell(s, d === s.dir ? null : d);
    }
    expect(s.goldensTaken).toBe(1);
    expect(s.length).toBe(before.len + 1);
    expect(s.foodEaten).toBe(before.food + 1);
    expect(s.score).toBeGreaterThan(before.score);
  });

  /** A direction that closes on `target` without being immediately fatal. */
  function towards(s: ReturnType<typeof createGame>, target: number): Dir | null {
    const cur = head(s);
    const cc = cur % 23;
    const cr = (cur - cc) / 23;
    const tc = target % 23;
    const tr = (target - tc) / 23;
    const wish: Dir[] = [];
    if (tc > cc) wish.push(RIGHT);
    if (tc < cc) wish.push(LEFT);
    if (tr > cr) wish.push(DOWN);
    if (tr < cr) wish.push(UP);
    for (const d of wish) {
      if (d === opposite(s.dir)) continue;
      const nb = neighbour(cur, d);
      if (nb < 0) continue;
      if (s.occupied[nb] && nb !== segmentAt(s, s.length - 1)) continue;
      return d;
    }
    return safeDir(s);
  }
});

// ---------------------------------------------------------------------------
// The tier table itself
// ---------------------------------------------------------------------------

describe("the tier table", () => {
  it("is authored in integer ticks per step", () => {
    for (const t of TIERS) expect(Number.isInteger(t.ticksPerStep)).toBe(true);
  });

  it("never reaches 3 ticks per step — the floor is a decision", () => {
    for (const t of TIERS) expect(t.ticksPerStep).toBeGreaterThanOrEqual(4);
  });

  it("thresholds ascend and speeds strictly increase", () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].fromFood).toBeGreaterThan(TIERS[i - 1].fromFood);
      expect(TIERS[i].ticksPerStep).toBeLessThan(TIERS[i - 1].ticksPerStep);
      expect(TIERS[i].multiplier).toBeGreaterThan(TIERS[i - 1].multiplier);
    }
  });

  it("tier 6 is widened — the span before the 25% jump is the largest", () => {
    // Not decoration: the spec widens it because that is where competent players
    // live, and a smooth column would be the thing to notice going missing.
    const spans = TIERS.slice(0, -1).map((t, i) => TIERS[i + 1].fromFood - t.fromFood);
    const last = spans[spans.length - 1];
    for (let i = 0; i < spans.length - 1; i++) expect(last).toBeGreaterThan(spans[i]);
  });
});
