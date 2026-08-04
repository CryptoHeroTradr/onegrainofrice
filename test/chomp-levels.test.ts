import { describe, expect, it } from "vitest";
import {
  CLEARED,
  CUTSCENE,
  READY,
  advance,
  beginPlay,
  createGame,
  endCutscene,
  isScoreSubmittable,
  tick,
  type GameState,
} from "@/components/chomp/engine/game";
import {
  BONUS_BY_LEVEL,
  BONUS_DOT_TRIGGERS,
  BONUS_ROW,
  BONUS_TICKS,
  CLEAR_TICKS,
  CORNER_LEAD,
  CUTSCENE_AFTER_LEVELS,
  CUTSCENE_REVENGE,
  CUTSCENE_STEAL,
  CUTSCENE_TICKS,
  FRIGHTENED_GONE_FROM_LEVEL,
  PEST_CROSSOVER_LEVEL,
  PEST_TOP_RATIO,
  bonusForLevel,
  levelTuning,
  secondsToTicks,
} from "@/components/chomp/engine/levels";
import { tileOf } from "@/components/chomp/engine/maze";
import { SUB } from "@/components/chomp/engine/types";

/**
 * LEVELS, THE CURVE, AND WHAT IS ON THE BOARD.
 *
 * The difficulty curve is the one part of the game that nobody plays far enough to
 * proof-read. A run that reaches level 17 takes a long time and a good player, so the
 * table's tail is exactly the kind of thing that ships wrong and stays wrong. These tests
 * read the tail directly.
 */

/** Every level worth asserting about, plus a couple past the end of the tables. */
const LEVELS = [1, 2, 3, 5, 8, 13, 17, 21, 40, 99];

describe("the difficulty curve", () => {
  it("never makes a level easier than the one before it", () => {
    let prevPest = 0;
    let prevScatter = Infinity;
    for (let lv = 1; lv <= 30; lv++) {
      const t = levelTuning(lv);
      expect(t.pestSpeed).toBeGreaterThanOrEqual(prevPest);
      expect(t.modeCycle[0]).toBeLessThanOrEqual(prevScatter);
      prevPest = t.pestSpeed;
      prevScatter = t.modeCycle[0];
    }
  });

  it("keeps the player's speed flat and lets the pests ramp past it", () => {
    const base = levelTuning(1).playerSpeed;
    for (const lv of LEVELS) expect(levelTuning(lv).playerSpeed).toBe(base);
    // Slower than the player early, faster than the player late. That crossover is the
    // whole difficulty curve, and it is why cornering exists.
    expect(levelTuning(1).pestSpeed).toBeLessThan(base);
    expect(levelTuning(21).pestSpeed).toBeGreaterThan(base);
  });

  it("crosses over from slower-than-you to faster-than-you around level 7", () => {
    const base = levelTuning(1).playerSpeed;
    const crossover = LEVELS.concat([4, 6, 7, 9]).sort((a, b) => a - b).find(
      (lv) => levelTuning(lv).pestSpeed >= base,
    );
    expect(crossover).toBeDefined();
    expect(crossover).toBeGreaterThanOrEqual(5);
    expect(crossover).toBeLessThanOrEqual(9);
  });

  it("clamps past the end of every table rather than going undefined", () => {
    const top = levelTuning(999);
    for (const [key, value] of Object.entries(top)) {
      if (key === "modeCycle" || key === "penDotLimits") {
        expect(Array.isArray(value)).toBe(true);
        continue;
      }
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(levelTuning(999)).toEqual(levelTuning(21));
  });

  it("shortens the scatter phases and never leaves the last chase bounded", () => {
    expect(levelTuning(21).modeCycle[0]).toBeLessThan(levelTuning(1).modeCycle[0]);
    for (const lv of LEVELS) {
      const cycle = levelTuning(lv).modeCycle;
      expect(cycle[cycle.length - 1]).toBeGreaterThan(secondsToTicks(600));
    }
  });
});

describe("frightened mode fades out", () => {
  it("shrinks from its level-1 length", () => {
    expect(levelTuning(5).frightenedTicks).toBeLessThan(levelTuning(1).frightenedTicks);
    expect(levelTuning(9).frightenedTicks).toBeLessThan(levelTuning(5).frightenedTicks);
  });

  it("keeps a couple of reprieve levels rather than sliding monotonically", () => {
    // A pure slide gives a player nothing to look forward to. Levels 6 and 10 hand back a
    // long window, and that is where a good run gets its chain points.
    expect(levelTuning(6).frightenedTicks).toBeGreaterThan(levelTuning(5).frightenedTicks);
    expect(levelTuning(10).frightenedTicks).toBeGreaterThan(levelTuning(9).frightenedTicks);
  });

  it("is gone for good from FRIGHTENED_GONE_FROM_LEVEL, and stays gone", () => {
    expect(levelTuning(FRIGHTENED_GONE_FROM_LEVEL - 1).frightenedTicks).toBeGreaterThan(0);
    for (let lv = FRIGHTENED_GONE_FROM_LEVEL; lv <= 60; lv++) {
      expect(levelTuning(lv).frightenedTicks).toBe(0);
    }
  });

  it("makes a golden grain pure points once it is gone", () => {
    const g = beginPlay(createGame(FRIGHTENED_GONE_FROM_LEVEL));
    expect(g.tuning.frightenedTicks).toBe(0);
    // Nothing to fear and nothing to chase: the window never opens.
    advance(g, 5);
    expect(g.frightTicks).toBe(0);
  });
});

describe("cornering survives the speed curve", () => {
  /**
   * THE QUESTION THE CURVE HAS TO ANSWER: does making the pests faster eventually push
   * them past the point where cornering matters?
   *
   * It has an exact answer, so it does not need a bot. Round a loop L tiles long with four
   * corners, a player who corners perfectly travels `L*SUB - 4*cornerLead` while the pest
   * behind them must travel the full `L*SUB`. Per lap the player nets
   *
   *     gain = L*SUB - r * (L*SUB - 4*cornerLead),     r = pestSpeed / playerSpeed
   *
   * which is zero at the break-even ratio r* = L*SUB / (L*SUB - 4*cornerLead). Above that
   * ratio the pest out-runs the corner and the loop is lost.
   */
  const gainPerLap = (loopTiles: number, ratio: number) =>
    loopTiles * SUB - ratio * (loopTiles * SUB - 4 * CORNER_LEAD);
  const breakEven = (loopTiles: number) =>
    (loopTiles * SUB) / (loopTiles * SUB - 4 * CORNER_LEAD);

  const ratioAt = (lv: number) => {
    const t = levelTuning(lv);
    return t.pestSpeed / t.playerSpeed;
  };

  it("still pays on the tightest loop at every level in the table", () => {
    // The girth-10 ring breaks even only at a ratio of 1.15, which the curve never
    // approaches. A perfect player can hold the tight loops forever — and the tight loops
    // are the ones with the most junctions on them, so holding one is not safety.
    for (const lv of LEVELS) expect(gainPerLap(10, ratioAt(lv))).toBeGreaterThan(0);
  });

  it("still pays on the 22-tile spawn loop at the very top of the table", () => {
    expect(gainPerLap(22, ratioAt(99))).toBeGreaterThan(0);
  });

  it("stops paying on the big pen loop deep in the curve, which is the intent", () => {
    // The set of loops a perfect player can hold SHRINKS as the levels rise, toward the
    // tightest and most heavily pincered ones. That is the shape of the curve, not a bug:
    // if the 32-tile loop stayed holdable at level 21 there would be nothing left to fear.
    expect(gainPerLap(32, ratioAt(1))).toBeGreaterThan(0);
    expect(gainPerLap(32, ratioAt(21))).toBeLessThan(0);
  });

  it("caps the pest speed table below the 22-tile break-even, deliberately", () => {
    // This is the invariant that keeps the above from being luck. The top pest speed sits
    // just under the ratio at which perfect cornering stops holding the spawn loop; raise
    // the table past it and this test is the thing that says so out loud.
    expect(ratioAt(99)).toBeLessThan(breakEven(22));
    expect(ratioAt(99)).toBeGreaterThan(breakEven(32));
    // …and by how much. The margin is 0.19% — 1.0625 against a break-even of 1.0645 —
    // and that is the entire distance between "the spawn loop still holds at level 21+"
    // and "it does not". Luck that isn't asserted is luck you spend twice.
    expect(breakEven(22) / ratioAt(99) - 1).toBeGreaterThan(0.0015);
  });

  it("crosses the player's speed exactly where PEST_CROSSOVER_LEVEL says", () => {
    // The named constant and the table are two statements of the same decision, and this
    // is what stops them drifting. Parity at the crossover, strictly faster after it,
    // strictly slower before — a pest that overtook the player early would change the
    // shape of the whole first act without anything in the code saying so.
    for (let lv = 1; lv < PEST_CROSSOVER_LEVEL; lv++) expect(ratioAt(lv)).toBeLessThan(1);
    expect(ratioAt(PEST_CROSSOVER_LEVEL)).toBe(1);
    expect(ratioAt(PEST_CROSSOVER_LEVEL + 1)).toBeGreaterThan(1);
  });

  it("tops out at PEST_TOP_RATIO and never above it", () => {
    expect(ratioAt(99)).toBeCloseTo(PEST_TOP_RATIO, 6);
    for (const lv of LEVELS) expect(ratioAt(lv)).toBeLessThanOrEqual(PEST_TOP_RATIO);
  });
});

describe("the debug entry point", () => {
  it("starts on the level asked for, with that level's tuning", () => {
    const g = createGame(9);
    expect(g.level).toBe(9);
    expect(g.tuning.pestSpeed).toBe(levelTuning(9).pestSpeed);
  });

  it("marks any run that did not start on level 1 unsubmittable, for good", () => {
    expect(isScoreSubmittable(createGame())).toBe(true);
    expect(isScoreSubmittable(createGame(1))).toBe(true);

    const g = createGame(7);
    expect(isScoreSubmittable(g)).toBe(false);
    // And it survives play — clearing levels must not launder the flag back to rankable.
    advance(beginPlay(g), 600);
    g.level = 12;
    expect(isScoreSubmittable(g)).toBe(false);
  });
});

// --- bonus items ------------------------------------------------------------

/** A game with the ready hold skipped and the pests off the board. */
function sandbox(level = 1): GameState {
  const g = beginPlay(createGame(level));
  g.pests = [];
  return g;
}

/** Eat `n` grains without waiting for the player to actually walk over them. */
function feedGrains(g: GameState, n: number): void {
  g.dotsThisLevel += n;
  g.dotsThisLife += n;
}

describe("bonus items", () => {
  it("gives every level an item and a value, clamping past the table", () => {
    for (const lv of LEVELS) {
      const b = bonusForLevel(lv);
      expect(b.kind).toBeGreaterThanOrEqual(0);
      expect(b.value).toBeGreaterThan(0);
    }
    expect(bonusForLevel(99)).toEqual(BONUS_BY_LEVEL[BONUS_BY_LEVEL.length - 1]);
  });

  it("escalates in value and never goes backwards", () => {
    let prev = 0;
    for (let lv = 1; lv <= 20; lv++) {
      const v = bonusForLevel(lv).value;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(bonusForLevel(1).value).toBeLessThan(bonusForLevel(11).value);
  });

  it("shows all six silhouettes across the early levels", () => {
    const kinds = new Set(BONUS_BY_LEVEL.map((b) => b.kind));
    expect(kinds.size).toBe(6);
  });

  it("appears on the dot counter, not on a timer", () => {
    const g = sandbox();
    advance(g, 120);
    // A player who has not cleared anything has not earned one.
    expect(g.bonus.ticks).toBe(0);
    expect(g.bonus.spawned).toBe(0);

    feedGrains(g, BONUS_DOT_TRIGGERS[0]);
    tick(g);
    expect(g.bonus.spawned).toBe(1);
    expect(g.bonus.ticks).toBe(BONUS_TICKS);
  });

  it("appears exactly twice per level", () => {
    const g = sandbox();
    feedGrains(g, BONUS_DOT_TRIGGERS[0]);
    advance(g, BONUS_TICKS + 2);
    expect(g.bonus.spawned).toBe(1);
    expect(g.bonus.ticks).toBe(0);

    feedGrains(g, BONUS_DOT_TRIGGERS[1] - BONUS_DOT_TRIGGERS[0]);
    advance(g, 2);
    expect(g.bonus.spawned).toBe(2);

    // And no third, however many grains go down after that.
    feedGrains(g, 500);
    advance(g, BONUS_TICKS + 60);
    expect(g.bonus.spawned).toBe(2);
  });

  it("expires on its own after the level's window", () => {
    const g = sandbox();
    feedGrains(g, BONUS_DOT_TRIGGERS[0]);
    tick(g);
    expect(g.bonus.ticks).toBe(BONUS_TICKS);
    advance(g, BONUS_TICKS);
    expect(g.bonus.ticks).toBe(0);
    expect(g.bonus.taken).toBe(0);
  });

  it("sits on the corridor under the pen, which the player can reach", () => {
    const g = sandbox();
    expect(tileOf(g.bonus.y)).toBe(BONUS_ROW);
    // Dead centre horizontally: on the boundary between two columns, like the spawn.
    expect(g.bonus.x % SUB).toBe(0);
  });

  it("is collected by walking onto it, and pays the level's value", () => {
    const g = sandbox(3);
    feedGrains(g, BONUS_DOT_TRIGGERS[0]);
    tick(g);
    expect(g.bonus.ticks).toBeGreaterThan(0);

    const before = g.score;
    g.player.x = g.bonus.x;
    g.player.y = g.bonus.y;
    tick(g);

    expect(g.bonus.taken).toBe(1);
    expect(g.bonus.ticks).toBe(0);
    expect(g.score - before).toBe(bonusForLevel(3).value);
    expect(g.bonus.scoreValue).toBe(bonusForLevel(3).value);
  });

  it("cannot be collected twice", () => {
    const g = sandbox();
    feedGrains(g, BONUS_DOT_TRIGGERS[0]);
    tick(g);
    g.player.x = g.bonus.x;
    g.player.y = g.bonus.y;
    advance(g, 60);
    expect(g.bonus.taken).toBe(1);
  });

  it("leaves the board when the player dies, but keeps the counter behind it", () => {
    const g = beginPlay(createGame());
    feedGrains(g, BONUS_DOT_TRIGGERS[0]);
    tick(g);
    expect(g.bonus.ticks).toBeGreaterThan(0);

    // Walk a pest into the player.
    const pest = g.pests[0];
    pest.x = g.player.x;
    pest.y = g.player.y;
    advance(g, secondsToTicks(0.5) + secondsToTicks(1.5) + 2);
    expect(g.phase).toBe(READY);

    // Gone from the board — dying costs you the item you were going for…
    expect(g.bonus.ticks).toBe(0);
    // …but not the clearing you had already done to earn the next one.
    expect(g.bonus.spawned).toBe(1);
    expect(g.dotsThisLevel).toBeGreaterThanOrEqual(BONUS_DOT_TRIGGERS[0]);
  });

  it("starts again from nothing on the next level", () => {
    const g = sandbox();
    feedGrains(g, BONUS_DOT_TRIGGERS[0]);
    advance(g, 4);
    expect(g.bonus.spawned).toBe(1);

    g.grainsRemaining = 0;
    advance(g, CLEAR_TICKS + 4);
    expect(g.level).toBe(2);
    expect(g.bonus.spawned).toBe(0);
    expect(g.bonus.ticks).toBe(0);
    expect(g.dotsThisLevel).toBe(0);
  });
});

// --- level completion and interstitials -------------------------------------

describe("finishing a level", () => {
  it("flashes the maze, then refills it and speeds the pests up", () => {
    const g = sandbox();
    g.grainsRemaining = 0;
    tick(g);
    expect(g.phase).toBe(CLEARED);
    expect(g.phaseTicks).toBe(CLEAR_TICKS);

    advance(g, CLEAR_TICKS + 2);
    expect(g.level).toBe(2);
    expect(g.grainsRemaining).toBeGreaterThan(280);
    expect(g.tuning.pestSpeed).toBeGreaterThan(levelTuning(1).pestSpeed);
    expect(g.phase).toBe(READY);
  });

  it("puts everyone back on their marks for the new level", () => {
    const g = sandbox();
    g.grainsRemaining = 0;
    advance(g, CLEAR_TICKS + 2);
    expect(tileOf(g.player.y)).toBe(25);
    expect(g.player.x).toBe(14 * SUB);
  });

  it("keeps the score and the lives across the boundary", () => {
    const g = sandbox();
    g.lives = 2;
    g.grainsRemaining = 0;
    tick(g); // the tick that ends the level; the player is still moving during it
    expect(g.phase).toBe(CLEARED);
    const before = g.score;

    advance(g, CLEAR_TICKS + 2);
    expect(g.level).toBe(2);
    expect(g.score).toBe(before);
    expect(g.lives).toBe(2);
  });
});

describe("the interstitials", () => {
  /** Clear the level `g` is on and stop the moment the board hands over. */
  function clearLevel(g: GameState): void {
    g.grainsRemaining = 0;
    advance(g, CLEAR_TICKS + 2);
  }

  /** Clear levels without letting `advance` auto-dismiss the cutscene. */
  function clearToCutscene(level: number): GameState {
    const g = sandbox(level);
    g.grainsRemaining = 0;
    // Step by hand: advance() ends cutscenes on sight so a headless run cannot stall.
    for (let i = 0; i < CLEAR_TICKS + 2 && g.phase !== CUTSCENE; i++) tick(g);
    return g;
  }

  it("plays one after level 2 and one after level 5, and nowhere else", () => {
    for (let lv = 1; lv <= 8; lv++) {
      const g = clearToCutscene(lv);
      const expected = CUTSCENE_AFTER_LEVELS.includes(lv);
      expect(g.phase === CUTSCENE).toBe(expected);
    }
  });

  it("plays the theft first and the reckoning second", () => {
    expect(clearToCutscene(2).cutscene).toBe(CUTSCENE_STEAL);
    expect(clearToCutscene(5).cutscene).toBe(CUTSCENE_REVENGE);
  });

  it("is under the spec's four seconds", () => {
    expect(CUTSCENE_TICKS).toBeLessThan(secondsToTicks(4));
  });

  it("advances to the next level when it ends", () => {
    const g = clearToCutscene(2);
    expect(g.phase).toBe(CUTSCENE);
    endCutscene(g);
    expect(g.level).toBe(3);
    expect(g.phase).toBe(READY);
  });

  it("consumes no simulation ticks at all, however long it is left on screen", () => {
    const g = clearToCutscene(2);
    const frozen = g.tick;
    for (let i = 0; i < 5000; i++) tick(g);
    // Not "few" — none. The simulation is stopped dead, which is what makes a skippable
    // cutscene safe to have in a game whose input trace is tick-stamped.
    expect(g.tick).toBe(frozen);
    expect(g.phase).toBe(CUTSCENE);
  });

  it("produces an identical run whether it is watched or skipped", () => {
    // The determinism property the CUTSCENE phase exists to protect. A player who skips
    // and a player who sits through it must submit the same trace against the same state.
    const watched = clearToCutscene(2);
    for (let i = 0; i < CUTSCENE_TICKS; i++) tick(watched); // "watching": no-ops
    endCutscene(watched);
    advance(watched, 300);

    const skipped = clearToCutscene(2);
    endCutscene(skipped); // straight past it
    advance(skipped, 300);

    expect(watched.tick).toBe(skipped.tick);
    expect(watched.player).toEqual(skipped.player);
    expect(watched.score).toBe(skipped.score);
    expect(watched.level).toBe(skipped.level);
    expect(Array.from(watched.grid)).toEqual(Array.from(skipped.grid));
  });

  it("does not stall a headless run", () => {
    // advance() dismisses cutscenes so the replay verifier and the bot never hang on one.
    const g = sandbox(2);
    clearLevel(g);
    expect(g.level).toBe(3);
    expect(g.phase).not.toBe(CUTSCENE);
  });
});
