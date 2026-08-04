import { describe, expect, it } from "vitest";
import {
  CLEARED,
  DYING,
  GAMEOVER,
  READY,
  advance,
  beginPlay,
  createGame,
  tick,
  type GameState,
} from "@/components/chomp/engine/game";
import {
  DEATH_PAUSE_TICKS,
  DEATH_TICKS,
  LOCUST,
  LOCUST_SHY_RANGE,
  RAT,
  SCATTER_CORNERS,
  SCORE_GRAIN,
  SCORE_PEST_CHAIN,
  SCORE_POWER,
  SPARROW,
  SPARROW_LEAD,
  STARTING_LIVES,
  WEEVIL,
  levelTuning,
  secondsToTicks,
} from "@/components/chomp/engine/levels";
import {
  CHASE,
  ENTERING,
  EXITING,
  EYES,
  OUT,
  PEN,
  SCATTER,
  buildPenRouteField,
  chooseDirection,
  createPests,
  modeAt,
  targetTile,
  type TargetContext,
} from "@/components/chomp/engine/pests";
import {
  COLS,
  ROWS,
  PEN_ENTRY_COL,
  PEN_ENTRY_ROW,
  isOpenForPest,
  isPenTile,
  setTile,
  tileCentre,
  tileOf,
} from "@/components/chomp/engine/maze";
import { DOWN, LEFT, POWER, RIGHT, UP } from "@/components/chomp/engine/types";

/**
 * The pest AI is four lines of arithmetic and one comparison loop, which is exactly why it
 * is worth testing: everything interesting about the chase is an emergent consequence of
 * those, so a quiet change to one of them changes how the whole game feels without
 * breaking anything visibly.
 */

/**
 * Put a golden grain in the player's path and let them swallow it.
 *
 * NOT under the player: the spawn straddles the boundary between cols 13 and 14, so the
 * tile the player is nominally "in" is the one they are about to leave. The grain has to
 * go in the tile they are moving INTO or it is never touched.
 */
function feedGoldenGrain(g: GameState): GameState {
  setTile(g.grid, tileOf(g.player.x) - 1, tileOf(g.player.y), POWER);
  // Stop the instant it is swallowed. The fright timer is SET during that tick and only
  // starts counting down on the next one, so the window can be read at its full length.
  for (let i = 0; i < 20 && g.powerEaten === 0; i++) tick(g);
  return g;
}

describe("target tiles — chase", () => {
  const ctx: TargetContext = {
    playerCol: 10,
    playerRow: 20,
    playerDir: RIGHT,
    ratCol: 5,
    ratRow: 20,
    pestCol: 0,
    pestRow: 0,
  };

  it("sends the Rat straight at the player", () => {
    expect(targetTile(RAT, CHASE, ctx)).toEqual({ col: 10, row: 20 });
  });

  it("sends the Sparrow to where the player is going, not where they are", () => {
    expect(targetTile(SPARROW, CHASE, ctx)).toEqual({ col: 10 + SPARROW_LEAD, row: 20 });
    expect(targetTile(SPARROW, CHASE, { ...ctx, playerDir: UP })).toEqual({
      col: 10,
      row: 20 - SPARROW_LEAD,
    });
  });

  it("throws the Weevil past the player, on the far side from the Rat", () => {
    // Pivot is two ahead of the player at (12,20); the vector from the Rat at (5,20) to
    // the pivot is (7,0), doubled to (14,0) — so the Weevil aims at (19,20), well beyond
    // the player. That is the flank: the Rat comes up behind, the Weevil comes round.
    expect(targetTile(WEEVIL, CHASE, ctx)).toEqual({ col: 19, row: 20 });
  });

  it("keeps the Weevil's target ahead of the player, not behind them", () => {
    // The literal reading of "mirrored through the Rat" — 2*rat - player — would put the
    // target BEHIND the player whenever the Rat is chasing, and send the flanker away.
    // This pins the flanking direction so that reading cannot creep back in.
    const t = targetTile(WEEVIL, CHASE, ctx);
    expect(t.col).toBeGreaterThan(ctx.playerCol);
    expect(2 * ctx.ratCol - ctx.playerCol).toBeLessThan(ctx.playerCol);
  });

  it("makes the Locust chase from far away and bolt when it gets close", () => {
    const far = { ...ctx, pestCol: 10 + LOCUST_SHY_RANGE + 1, pestRow: 20 };
    expect(targetTile(LOCUST, CHASE, far)).toEqual({ col: 10, row: 20 });

    const near = { ...ctx, pestCol: 10 + LOCUST_SHY_RANGE - 1, pestRow: 20 };
    expect(targetTile(LOCUST, CHASE, near)).toEqual(SCATTER_CORNERS[LOCUST]);
  });
});

describe("target tiles — scatter", () => {
  it("gives every pest its own corner", () => {
    const ctx: TargetContext = {
      playerCol: 10,
      playerRow: 20,
      playerDir: RIGHT,
      ratCol: 5,
      ratRow: 20,
      pestCol: 1,
      pestRow: 1,
    };
    for (const kind of [RAT, SPARROW, WEEVIL, LOCUST] as const) {
      expect(targetTile(kind, SCATTER, ctx)).toEqual(SCATTER_CORNERS[kind]);
    }
    // Four different corners, or scatter would not break up a pack.
    const seen = new Set(SCATTER_CORNERS.map((c) => `${c.col},${c.row}`));
    expect(seen.size).toBe(4);
  });
});

describe("the junction rule", () => {
  const { grid } = createGame();

  /**
   * (6,5) is a four-way crossing: the row-5 corridor runs through it and the col-6 shaft
   * crosses. Every tiebreak case below is measured there, with targets placed so two
   * directions are EXACTLY equidistant and only the preference order can decide.
   */
  it("prefers up over left when they tie", () => {
    // From (6,5): up to (6,4) is 2²+1²=5 from (4,3); left to (5,5) is 1²+2²=5.
    expect(chooseDirection(grid, 6, 5, UP, { col: 4, row: 3 })).toBe(UP);
  });

  it("prefers left over down when they tie", () => {
    // From (6,5) heading left: left to (5,5) is 1²+2²=5 from (4,7); down to (6,6) is
    // 2²+1²=5. Up is 13 and loses outright.
    expect(chooseDirection(grid, 6, 5, LEFT, { col: 4, row: 7 })).toBe(LEFT);
  });

  it("prefers down over right when they tie", () => {
    // From (6,5) heading down: down to (6,6) is 2²+1²=5 from (8,7); right to (7,5) is
    // 1²+2²=5.
    expect(chooseDirection(grid, 6, 5, DOWN, { col: 8, row: 7 })).toBe(DOWN);
  });

  it("never reverses, even when the target is straight back the way it came", () => {
    const d = chooseDirection(grid, 6, 5, RIGHT, { col: 1, row: 5 });
    expect(d).not.toBe(LEFT);
  });

  it("reverses when explicitly allowed, which is what a mode change does", () => {
    const d = chooseDirection(grid, 6, 5, RIGHT, { col: 1, row: 5 }, { allowReverse: true });
    expect(d).toBe(LEFT);
  });

  it("refuses to path back into the pen", () => {
    // (13,11) sits directly above the gate. Aiming a pest at the pen interior must not
    // take it through the gate, or the pen becomes a hiding place the player cannot follow
    // it into.
    const d = chooseDirection(grid, PEN_ENTRY_COL, PEN_ENTRY_ROW, LEFT, { col: 13, row: 14 });
    expect(d).not.toBe(DOWN);
  });

  it("only ever returns a direction that is actually open", () => {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!isOpenForPest(grid, col, row) || isPenTile(col, row)) continue;
        for (const dir of [UP, LEFT, DOWN, RIGHT] as const) {
          const d = chooseDirection(grid, col, row, dir, { col: 1, row: 1 });
          const nc = col + (d === LEFT ? -1 : d === RIGHT ? 1 : 0);
          const nr = row + (d === UP ? -1 : d === DOWN ? 1 : 0);
          expect(isOpenForPest(grid, nc, nr, true)).toBe(true);
        }
      }
    }
  });
});

describe("the mode cycle", () => {
  const cycle = levelTuning(1).modeCycle;

  it("starts in scatter and alternates", () => {
    expect(modeAt(cycle, 0).mode).toBe(SCATTER);
    expect(modeAt(cycle, cycle[0] - 1).mode).toBe(SCATTER);
    expect(modeAt(cycle, cycle[0]).mode).toBe(CHASE);
    expect(modeAt(cycle, cycle[0] + cycle[1]).mode).toBe(SCATTER);
  });

  it("shortens its scatter phases as levels progress", () => {
    const early = levelTuning(1).modeCycle[0];
    const mid = levelTuning(5).modeCycle[0];
    const late = levelTuning(20).modeCycle[0];
    expect(mid).toBeLessThan(early);
    expect(late).toBeLessThan(mid);
  });

  it("ends in a chase that outlasts any level", () => {
    const total = cycle.reduce((a, b) => a + b, 0);
    expect(modeAt(cycle, total + 1).mode).toBe(CHASE);
    expect(cycle[cycle.length - 1]).toBeGreaterThan(secondsToTicks(600));
  });

  it("turns every pest round on a mode change", () => {
    const g = beginPlay(createGame());
    // Run to just before the first scatter→chase boundary, then over it.
    const boundary = g.tuning.modeCycle[0];
    advance(g, boundary - 1);
    const before = g.pests.filter((p) => p.state === OUT).map((p) => p.dir);
    expect(before.length).toBeGreaterThan(0);
    advance(g, 2);
    expect(g.mode).toBe(CHASE);
    const after = g.pests.filter((p) => p.state === OUT).map((p) => p.dir);
    // At least one of them visibly turned around; a pest wedged against a wall may not.
    expect(after.some((d, i) => d !== before[i])).toBe(true);
  });

  it("holds the cycle clock still while a power window is open", () => {
    const g = feedGoldenGrain(beginPlay(createGame()));
    expect(g.frightTicks).toBeGreaterThan(0);
    const elapsed = g.modeElapsed;
    advance(g, 30);
    expect(g.modeElapsed).toBe(elapsed);
  });
});

describe("the pen", () => {
  it("starts the Rat out and the other three in", () => {
    const pests = createPests();
    expect(pests[RAT].state).toBe(OUT);
    expect(pests[SPARROW].state).toBe(PEN);
    expect(pests[WEEVIL].state).toBe(PEN);
    expect(pests[LOCUST].state).toBe(PEN);
  });

  it("lets them out one at a time, in order, and not all at once", () => {
    const g = beginPlay(createGame());
    const leftAt = new Map<number, number>();
    // The Rat is excluded: it never waits in the pen, so counting it as "released" would
    // fill the quota before the Locust had had its turn.
    for (let t = 0; t < 3000 && leftAt.size < 3; t++) {
      tick(g);
      for (const p of g.pests) {
        if (p.kind === RAT) continue;
        if (p.state !== PEN && p.state !== EXITING && !leftAt.has(p.kind)) {
          leftAt.set(p.kind, g.tick);
        }
      }
    }
    expect(leftAt.size).toBe(3);
    const sparrow = leftAt.get(SPARROW) as number;
    const weevil = leftAt.get(WEEVIL) as number;
    const locust = leftAt.get(LOCUST) as number;
    expect(sparrow).toBeLessThan(weevil);
    expect(weevil).toBeLessThan(locust);
    // Staggered, not simultaneous — that is the whole point of the dot counter.
    expect(weevil - sparrow).toBeGreaterThan(30);
    expect(locust - weevil).toBeGreaterThan(30);
  });

  it("lets them out on the timer even if the player never eats a grain", () => {
    const g = beginPlay(createGame());
    // A player who never moves eats nothing, so only the timeout can release anybody.
    for (let i = 0; i < g.grid.length; i++) if (g.grid[i] === 2 || g.grid[i] === 3) g.grid[i] = 1;
    g.grainsRemaining = 9999;
    advance(g, secondsToTicks(30));
    expect(g.dotsThisLife).toBe(0);
    expect(g.pests.every((p) => p.state !== PEN)).toBe(true);
  });

  it("routes eyes home from every tile a pest can stand on", () => {
    const { grid } = createGame();
    const field = buildPenRouteField(grid);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!isOpenForPest(grid, col, row) || isPenTile(col, row)) continue;
        expect(field[row * COLS + col]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("frightened mode", () => {
  const withPowerWindow = () => feedGoldenGrain(beginPlay(createGame()));

  it("opens a window and scares everyone who is out", () => {
    const g = withPowerWindow();
    expect(g.powerEaten).toBe(1);
    expect(g.frightTicks).toBe(levelTuning(1).frightenedTicks);
    expect(g.pests.filter((p) => p.state === OUT).every((p) => p.frightened)).toBe(true);
  });

  it("closes on its own and un-scares everyone", () => {
    const g = withPowerWindow();
    advance(g, levelTuning(1).frightenedTicks + 2);
    expect(g.frightTicks).toBe(0);
    expect(g.pests.some((p) => p.frightened)).toBe(false);
  });

  it("pays the chain 200/400/800/1600 within one window", () => {
    const g = withPowerWindow();
    const scores: number[] = [];
    for (let i = 0; i < 4; i++) {
      const pest = g.pests[i];
      pest.state = OUT;
      pest.frightened = true;
      pest.x = g.player.x;
      pest.y = g.player.y;
      const before = g.score;
      tick(g);
      scores.push(g.score - before);
      expect(pest.state).toBe(EYES);
      // Clear the between-kills freeze so the next one lands on the next tick.
      g.hitFreeze = 0;
    }
    expect(scores).toEqual([...SCORE_PEST_CHAIN]);
  });

  it("sends an eaten pest home as eyes and puts it back in the pen", () => {
    const g = withPowerWindow();
    const pest = g.pests[RAT];
    pest.state = OUT;
    pest.frightened = true;
    pest.x = g.player.x;
    pest.y = g.player.y;
    tick(g);
    expect(pest.state).toBe(EYES);

    let reachedPen = false;
    for (let i = 0; i < 1200; i++) {
      tick(g);
      // Read through a widened local: TypeScript still has the state narrowed to EYES
      // from the assignment above, and the whole point is that the engine changed it.
      const st: number = pest.state;
      if (st === PEN || st === ENTERING) {
        reachedPen = true;
        break;
      }
    }
    expect(reachedPen).toBe(true);
    expect(pest.frightened).toBe(false);
  });

  it("stops frightening at all in the deep levels", () => {
    expect(levelTuning(17).frightenedTicks).toBe(0);
    expect(levelTuning(30).frightenedTicks).toBe(0);
    const g = feedGoldenGrain(beginPlay(createGame(17)));
    expect(g.powerEaten).toBe(1);
    expect(g.frightTicks).toBe(0);
    expect(g.pests.some((p) => p.frightened)).toBe(false);
  });
});

describe("collision, lives and death", () => {
  function caught() {
    const g = beginPlay(createGame());
    const pest = g.pests[RAT];
    pest.state = OUT;
    pest.frightened = false;
    pest.x = g.player.x;
    pest.y = g.player.y;
    tick(g);
    return g;
  }

  it("kills the player on contact with a pest that is not frightened", () => {
    const g = caught();
    expect(g.phase).toBe(DYING);
  });

  it("spends a life and puts everyone back on their marks", () => {
    const g = caught();
    advance(g, DEATH_PAUSE_TICKS + DEATH_TICKS + 1);
    expect(g.lives).toBe(STARTING_LIVES - 1);
    expect(g.phase).toBe(READY);
    expect(g.pests[SPARROW].state).toBe(PEN);
    expect(tileOf(g.player.y)).toBe(25);
  });

  it("ends the run when the last life goes", () => {
    const g = caught();
    g.lives = 1;
    advance(g, DEATH_PAUSE_TICKS + DEATH_TICKS + 1);
    expect(g.phase).toBe(GAMEOVER);
    expect(g.lives).toBe(0);
  });

  it("cannot be killed by a pest that is eyes or penned", () => {
    const g = beginPlay(createGame());
    for (const p of g.pests) {
      p.state = p.kind === RAT ? EYES : PEN;
      p.x = g.player.x;
      p.y = g.player.y;
    }
    advance(g, 5);
    expect(g.phase).not.toBe(DYING);
  });
});

describe("scoring and progression", () => {
  it("pays for grains and golden grains", () => {
    const g = beginPlay(createGame());
    advance(g, 1);
    expect(g.score).toBe(SCORE_GRAIN * g.grainsEaten);

    const h = feedGoldenGrain(beginPlay(createGame()));
    expect(h.score).toBe(SCORE_POWER);
  });

  it("costs a whole frozen tick per grain and three per golden grain", () => {
    // The freeze is the eating cost; there is no separate eating speed. Measured as the
    // shortfall in distance travelled against an identical run over cleared corridor.
    // Row 29 is the only corridor long enough to eat twenty grains without hitting a wall.
    const onRow29 = (clear: boolean) => {
      const g = beginPlay(createGame());
      g.pests = [];
      if (clear) {
        for (let i = 0; i < g.grid.length; i++) if (g.grid[i] === 2) g.grid[i] = 1;
        g.grainsRemaining = 9999;
      }
      g.player.x = tileCentre(24);
      g.player.y = tileCentre(29);
      g.player.dir = LEFT;
      g.player.wanted = LEFT;
      return g;
    };
    const eating = onRow29(false);
    const clear = onRow29(true);
    advance(eating, 150);
    advance(clear, 150);
    // Settle any freeze still owed from the last grain, so the two runs are compared at
    // rest rather than with one of them mid-swallow.
    while (eating.player.freeze > 0) {
      tick(eating);
      tick(clear);
    }
    expect(eating.grainsEaten).toBeGreaterThan(15);
    const lostTicks = (clear.player.distance - eating.player.distance) / 16;
    expect(lostTicks).toBe(eating.grainsEaten);
  });

  it("hands out the extra life exactly once", () => {
    const g = beginPlay(createGame());
    g.score = 9_990;
    g.pests = [];
    advance(g, 60);
    expect(g.lives).toBe(STARTING_LIVES + 1);
    const lives = g.lives;
    advance(g, 600);
    expect(g.lives).toBe(lives);
  });

  it("moves to the next level, refills the maze and speeds the pests up", () => {
    const g = beginPlay(createGame());
    g.pests = [];
    g.grainsRemaining = 0;
    tick(g);
    expect(g.phase).toBe(CLEARED);
    advance(g, secondsToTicks(2) + 2);
    expect(g.level).toBe(2);
    expect(g.grainsRemaining).toBeGreaterThan(200);
    expect(g.tuning.pestSpeed).toBeGreaterThan(levelTuning(1).pestSpeed);
  });
});

describe("determinism with pests on the board", () => {
  it("produces an identical run from the same seed", () => {
    const run = () => {
      const g = beginPlay(createGame(1, 12345));
      advance(g, 1500);
      return g;
    };
    const a = run();
    const b = run();
    expect(a.score).toBe(b.score);
    expect(a.rng).toBe(b.rng);
    expect(a.pests.map((p) => [p.x, p.y, p.dir, p.state])).toEqual(
      b.pests.map((p) => [p.x, p.y, p.dir, p.state]),
    );
  });

  it("diverges on a different seed once anything random has happened", () => {
    // Only frightened pests consume randomness, so the seed has to be given a reason to
    // matter before this means anything.
    const run = (seed: number) => {
      const g = feedGoldenGrain(beginPlay(createGame(1, seed)));
      advance(g, 400);
      return g.pests.map((p) => `${tileOf(p.x)},${tileOf(p.y)}`).join("|");
    };
    expect(run(1)).not.toBe(run(999));
  });
});
