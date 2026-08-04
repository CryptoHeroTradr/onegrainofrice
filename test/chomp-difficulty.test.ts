import { describe, expect, it } from "vitest";
import { beginPlay, createGame, tick } from "@/components/chomp/engine/game";
import { runClearBot } from "./chomp-support";

/**
 * RICE CHOMP — is the game actually finishable?
 *
 * Level 1's job is to teach the maze. A player who cannot finish it never sees the rest
 * of the game, so "level 1 is completable by a competent player" is a property worth
 * holding onto while the difficulty curve is still being tuned. Every dial in levels.ts
 * can move this, and none of them look like they should.
 *
 * ── WHY THIS SUITE EXISTS AT ALL ────────────────────────────────────────────────
 * The kiting suite's bot (`botChoose`) maximises reachable safe space, which is exactly
 * right for "can a competent player evade forever?" and exactly wrong for this question:
 * empty corridor is as safe as full corridor, so it will circle a cleared stretch
 * indefinitely and never finish. Measured with it, level 1 looked unclearable at every
 * pest speed tried, down to 75% of the player's — a finding entirely about the bot. This
 * suite uses `botChooseClearing`, which heads for grains and refuses steps a pest reaches
 * first, and level 1 then clears every time in about a minute.
 *
 * The bot remains an OPTIMISTIC proxy: exact pest positions, a whole-board search at
 * every tile, no panic. A pass here means the level is COMPLETABLE, not that it is easy,
 * and it is not a substitute for somebody playing it.
 *
 * These runs simulate minutes of play, so this suite is slow by design.
 */

/** Fixed, arbitrary, and spread out — the seed only bites once a power window opens. */
const SEEDS = [1000, 8919, 16838, 24757, 32676, 40595];
/** Ten simulated minutes. A clear takes about one; this is a runaway guard, not a target. */
const BUDGET = 60 * 600;

function clearLevelOne(seed: number) {
  return runClearBot(beginPlay(createGame(1, seed)), BUDGET, tick);
}

describe("level 1 is completable", () => {
  const runs = SEEDS.map((seed) => ({ seed, run: clearLevelOne(seed) }));

  it("clears on every seed", () => {
    const failed = runs.filter((r) => !r.run.cleared).map((r) => r.seed);
    expect(failed).toEqual([]);
  });

  it("eats every grain on the board, not merely most of them", () => {
    for (const { seed, run } of runs) {
      expect(`seed ${seed}: ${run.grainsEaten}/${run.grainsTotal}`).toBe(
        `seed ${seed}: ${run.grainsTotal}/${run.grainsTotal}`,
      );
    }
  });

  it("takes between half a minute and four minutes", () => {
    // A floor as well as a ceiling: if a clear ever gets much quicker than this, either
    // the board shrank or something stopped chasing.
    for (const { run } of runs) {
      expect(run.seconds).toBeGreaterThan(30);
      expect(run.seconds).toBeLessThan(240);
    }
  });

  it("finishes with lives still in hand", () => {
    // Clearing on the last life every time would mean the level is only just survivable.
    const total = runs.reduce((a, r) => a + r.run.livesLeft, 0);
    expect(total / runs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("the clearing bot is measuring the right thing", () => {
  it("is beaten by a safety margin of zero", () => {
    // Guards against the bot being so strong that this suite would pass regardless of
    // tuning. With no margin it walks into pests and does not finish, which means the
    // margin — not omniscience — is what carries a clear.
    const reckless = runClearBot(beginPlay(createGame(1, 1000)), BUDGET, tick, 0);
    expect(reckless.cleared).toBe(false);
  });
});
