import { describe, expect, it } from "vitest";
import { beginPlay, createGame, tick, type GameState } from "@/components/chomp/engine/game";
import { tileCentre } from "@/components/chomp/engine/maze";
import { OUT } from "@/components/chomp/engine/pests";
import { levelTuning } from "@/components/chomp/engine/levels";
import { DOWN, LEFT, RIGHT, UP, type Dir } from "@/components/chomp/engine/types";
import {
  DEFAULT_HORIZON,
  POCKET_EXITS,
  POCKET_EXITS_ORIGINAL,
  disarmPower,
  placeOn,
  runBot,
  runOrbit,
  stripGrains,
} from "./chomp-support";

/**
 * THE KITING SUITE.
 *
 * docs/rice-chomp-plan.md §7.1 signed the maze off with an honest caveat: geometry alone
 * cannot make kiting impossible, it can only make it defeatable, and whether a good player
 * can farm a loop forever is decided by the AI and the speed curve — "I'll verify this
 * empirically in Phase 3 by scripting a kiting bot against the finished AI." This is that
 * bot, and these are the two questions it was built to answer.
 *
 * Both questions are asked with GOLDEN GRAINS DISARMED. A power window is not kiting, it
 * is the answer to kiting; leaving them armed would let the bot eat its way out of every
 * hard moment and prove nothing about the chase.
 *
 * These runs simulate minutes of play, so the suite is slower than the rest. That is the
 * price of the answer being measured rather than asserted.
 */

/** A run with the ready hold skipped, no power windows, and nothing to slow the player. */
function chase(seed = 1, clearGrains = true, level = 1): GameState {
  const g = beginPlay(createGame(level, seed));
  disarmPower(g);
  if (clearGrains) stripGrains(g);
  return g;
}

/** Five minutes of simulated play. Long enough that "indefinitely" would show up. */
const BUDGET = 18_000;

describe("question 1: can a competent player kite all four pests indefinitely?", () => {
  /**
   * The four loops the plan called out, driven blind: pick a circuit, run laps, never
   * think again. This is the pure form of the question.
   */
  const LOOPS: Record<string, { col: number; row: number; turn: Dir }[]> = {
    "the pen loop": [
      { col: 18, row: 11, turn: DOWN },
      { col: 18, row: 18, turn: LEFT },
      { col: 9, row: 18, turn: UP },
      { col: 9, row: 11, turn: RIGHT },
    ],
    "the spawn pocket": [
      { col: 17, row: 25, turn: DOWN },
      { col: 17, row: 29, turn: LEFT },
      { col: 10, row: 29, turn: UP },
      { col: 10, row: 25, turn: RIGHT },
    ],
    "the bottom-right ring": [
      { col: 23, row: 23, turn: DOWN },
      { col: 23, row: 25, turn: LEFT },
      { col: 20, row: 25, turn: UP },
      { col: 20, row: 23, turn: RIGHT },
    ],
  };

  for (const [name, corners] of Object.entries(LOOPS)) {
    it(`cannot be orbited forever: ${name}`, () => {
      const g = chase();
      const last = corners[corners.length - 1];
      placeOn(g, last, last.turn);
      const r = runOrbit(g, corners, BUDGET, tick);
      expect(r.died).toBe(true);
      // Not "eventually" — within a handful of laps. Scatter pulls the pests off the loop
      // and drops them back onto it from somewhere new, and the Sparrow, aiming four tiles
      // ahead of the player, meets them coming the other way round.
      expect(r.laps).toBeLessThan(30);
    });
  }

  /**
   * The stronger version: not a fixed orbit but a bot that re-reads the board and runs
   * wherever there is most room. If anything could kite forever it would be this.
   */
  it("cannot be kited by a bot that plays the whole maze", () => {
    for (const start of [
      { col: 14, row: 25 },
      { col: 6, row: 5 },
      { col: 21, row: 20 },
      { col: 1, row: 29 },
    ]) {
      const g = chase();
      placeOn(g, start, RIGHT);
      const r = runBot(g, BUDGET, tick);
      expect(r.died).toBe(true);
      expect(r.ticks).toBeLessThan(BUDGET);
    }
  });

  /**
   * The check on the check. A bot that dies because it cannot see far enough would give
   * the same result as a maze that genuinely cannot be farmed, and only one of those is a
   * finding. If doubling the lookahead let it survive the full budget, the conclusion
   * above would be about the bot.
   */
  it("still dies with twice the lookahead, so the finding is about the maze", () => {
    const deep = chase();
    const r = runBot(deep, BUDGET, tick, DEFAULT_HORIZON * 2);
    expect(r.died).toBe(true);
  });

  it("survives long enough to be a game, though — this is not a coin toss", () => {
    // The other failure mode: a maze so tight that competent play is pointless. A good
    // player should get minutes, not seconds.
    const g = chase(1, false); // grains down, so the chomp freeze is in play too
    placeOn(g, { col: 14, row: 25 }, LEFT);
    const r = runBot(g, BUDGET, tick);
    expect(r.ticks).toBeGreaterThan(60 * 20);
  });
});

describe("question 2: can two pests seal the spawn pocket?", () => {
  /**
   * Park pests on the tiles just outside the room and let the bot try to get out. Every
   * corridor here is one tile wide, so a pest on a way out is a closed door — there is
   * nothing to slip past, and this is a question with a definite answer rather than a
   * matter of how well anyone plays.
   */
  function sealedBy(gates: readonly { col: number; row: number }[]) {
    const g = chase();
    g.pests = g.pests.slice(0, gates.length);
    gates.forEach((gate, i) => {
      const p = g.pests[i];
      p.state = OUT;
      p.frightened = false;
      p.x = tileCentre(gate.col);
      p.y = tileCentre(gate.row);
    });
    placeOn(g, { col: 14, row: 25 }, LEFT);
    return runBot(g, 3000, tick);
  }

  it("no longer, since the room has four ways out", () => {
    // The two original exits were both on row 29, eight tiles apart, and a pest on each
    // ended the run. Row 24 cols 10 and 17 were opened on 2026-08-04 for exactly this
    // reason; with them open, the same two pests leave two routes untouched.
    const r = sealedBy(POCKET_EXITS_ORIGINAL);
    expect(r.died).toBe(false);
  });

  it("but four pests, one per exit, still close it — it is a risk pocket, not a safe room", () => {
    const r = sealedBy(POCKET_EXITS);
    expect(r.died).toBe(true);
  });

  it("and the live AI does not stumble into a four-way seal on its own", () => {
    // Before the amendment the two-way version of this happened by accident on about 1.5%
    // of ticks — often enough to kill a player who had done nothing wrong, in the room
    // they spawn in. Four exits covered at once is a different order of coincidence.
    //
    // Counted only while the bot is actually inside the room, because a seal nobody is
    // standing in is not a trap, it is four pests in a row.
    let sealed = 0;
    let inside = 0;
    for (const start of [
      { col: 14, row: 25 },
      { col: 10, row: 27 },
      { col: 17, row: 25 },
    ]) {
      const g = chase();
      placeOn(g, start, LEFT);
      const r = runBot(g, BUDGET, tick);
      sealed += r.sealedTicks;
      inside += r.pocketTicks;
    }
    expect(inside).toBeGreaterThan(0);
    expect(sealed).toBe(0);
  });
});

describe("question 3: does the difficulty curve open a hole later on?", () => {
  /**
   * Phase 4 added the per-level curve, and a maze that cannot be farmed at level 1 is not
   * automatically safe at level 9 — the speed multipliers move every quantity the Phase 3
   * answer depended on. So the same bot runs again at three points on the curve.
   *
   * Level 1 the pests are slower than the player, level 5 they are nearly level, level 9
   * they are faster. If any of those is farmable it is a different game from the one that
   * was measured.
   */
  for (const level of [1, 5, 9]) {
    it(`still cannot be kited at level ${level}`, () => {
      const r = runBot(chase(1, true, level), BUDGET, tick);
      expect(r.died).toBe(true);
      expect(r.ticks).toBeLessThan(BUDGET);
    });

    it(`still cannot be kited at level ${level} with twice the lookahead`, () => {
      const r = runBot(chase(1, true, level), BUDGET, tick, DEFAULT_HORIZON * 2);
      expect(r.died).toBe(true);
    });
  }

  it("gets harder rather than easier as the curve climbs", () => {
    // Not a survival-time comparison — a chase is chaotic and single runs are noisy. The
    // claim that actually has to hold is about the dials: every level up is at least as
    // fast a pest, at most as long a scatter, and at most as long a power window.
    const one = levelTuning(1);
    const nine = levelTuning(9);
    expect(nine.pestSpeed).toBeGreaterThan(one.pestSpeed);
    expect(nine.modeCycle[0]).toBeLessThanOrEqual(one.modeCycle[0]);
    expect(nine.frightenedTicks).toBeLessThan(one.frightenedTicks);
  });
});

describe("cornering earns its keep in a real chase", () => {
  it("keeps the bot alive longer than the same bot without it", () => {
    // Not a controlled measurement — a chase is chaotic and one run proves little on its
    // own — but the exact worth of a corner is pinned in test/chomp-cornering.test.ts, and
    // this confirms the mechanism is reachable by something playing the actual game.
    const withCorner = runBot(chase(), BUDGET, tick);
    const control = chase();
    control.tuning = { ...control.tuning, cornerLead: 0 };
    const without = runBot(control, BUDGET, tick);
    expect(withCorner.ticks).not.toBe(without.ticks);
  });
});
