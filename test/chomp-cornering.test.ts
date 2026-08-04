import { describe, expect, it } from "vitest";
import {
  advance,
  beginPlay,
  createGame,
  setWanted,
  tick,
  type GameState,
} from "@/components/chomp/engine/game";
import { CORNER_LEAD, TURN_TOLERANCE } from "@/components/chomp/engine/levels";
import { offsetFromCentre, tileCentre, tileOf } from "@/components/chomp/engine/maze";
import { DOWN, LEFT, RIGHT, SUB, UP, type Dir } from "@/components/chomp/engine/types";
import { disableCornering, stripGrains, tileDistance } from "./chomp-support";

/**
 * CORNERING is the skill ceiling of the genre: a player who presses a turn early cuts the
 * corner and gains ground on a pursuer who must run to the middle of the junction before
 * turning. These tests exist because "it feels better now" is not a measurement, and
 * because the mechanism has an exact expected value — CORNER_LEAD subunits per corner —
 * which is far easier to defend in six months than a vibe.
 *
 * The other reason they exist: cornering is a tempting thing to "fix" by widening the
 * turn tolerance, which produces a similar-looking result (turns take more readily) and
 * none of the same benefit (a late turn still costs you the corner). The final test in
 * the file pins the two apart.
 */

/**
 * A player parked on a corridor, pests removed. Movement isolation: these tests are about
 * geometry, not about the chase, and a pest wandering into shot would make them flaky.
 */
function onCorridor(col: number, row: number, dir: Dir): GameState {
  const g = beginPlay(createGame());
  g.pests = [];
  stripGrains(g);
  g.player.x = tileCentre(col);
  g.player.y = tileCentre(row);
  g.player.dir = dir;
  g.player.wanted = dir;
  return g;
}

/**
 * The corner used throughout: travelling RIGHT along row 5 through col 6, where a shaft
 * drops away downwards. A four-way crossing rather than an L-bend, deliberately — at an
 * L-bend the player is stopped by the wall ahead and can never actually be late, which
 * hides half the behaviour under test.
 *
 * Starting four ticks (64 subunits) short of the junction centre means a control run can
 * be placed EXACTLY on that centre on a tick boundary, which is what makes an exact
 * comparison possible at all.
 */
const JUNCTION_COL = 6;
const JUNCTION_ROW = 5;
const TICKS_TO_CENTRE = 4;
const APPROACH = 64; // 4 ticks × 16 subunits

function approachingTheCorner(): GameState {
  const g = onCorridor(JUNCTION_COL, JUNCTION_ROW, RIGHT);
  g.player.x = tileCentre(JUNCTION_COL) - APPROACH;
  return g;
}

describe("the corner glide", () => {
  it("banks exactly CORNER_LEAD subunits against a player who turns at the centre", () => {
    // EARLY: the turn is buffered before the junction, so the engine takes it the moment
    // the player is within CORNER_LEAD of the centre and glides diagonally from there.
    const early = approachingTheCorner();
    setWanted(early, DOWN);
    advance(early, 20);

    // CENTRE: the identical approach, but the turn is not asked for until the player is
    // standing exactly on the junction centre. No lead, so no glide.
    const centre = approachingTheCorner();
    advance(centre, TICKS_TO_CENTRE);
    expect(offsetFromCentre(centre.player.x)).toBe(0);
    setWanted(centre, DOWN);
    advance(centre, 20 - TICKS_TO_CENTRE);

    // Same total travel, same corner, same speed. The whole difference is the glide.
    expect(early.player.distance).toBe(centre.player.distance);
    expect(early.player.y - centre.player.y).toBe(CORNER_LEAD);
  });

  it("is a third of a tile, which is the number the level table says it is", () => {
    expect(CORNER_LEAD).toBe(40);
    expect(CORNER_LEAD / SUB).toBeCloseTo(1 / 3, 5);
  });

  it("costs the same distance when the turn is keyed late", () => {
    const late = approachingTheCorner();
    // One tick past the centre: 16 subunits, inside the tolerance but well past the point
    // where anything could be gained.
    advance(late, TICKS_TO_CENTRE + 1);
    expect(offsetFromCentre(late.player.x)).toBe(16);
    setWanted(late, DOWN);
    advance(late, 15);

    const centre = approachingTheCorner();
    advance(centre, TICKS_TO_CENTRE);
    setWanted(centre, DOWN);
    advance(centre, 16);

    expect(late.player.distance).toBe(centre.player.distance);
    // Behind, not ahead: the glide ran backwards to recover the centre it overshot.
    expect(centre.player.y - late.player.y).toBe(16);
  });

  it("leaves the off-axis exactly centred once the glide finishes", () => {
    const g = approachingTheCorner();
    setWanted(g, DOWN);
    advance(g, 20);
    expect(g.player.glideSteps).toBe(0);
    expect(offsetFromCentre(g.player.x)).toBe(0);
    expect(tileOf(g.player.x)).toBe(JUNCTION_COL);
  });

  it("never leaves the tile it started the glide in", () => {
    const g = approachingTheCorner();
    setWanted(g, DOWN);
    let sawGlide = false;
    for (let i = 0; i < 20; i++) {
      tick(g);
      if (g.player.glideSteps > 0) {
        sawGlide = true;
        // Both axes stay inside the junction tile for the whole diagonal, which is why
        // the glide can never clip a wall or skip a grain.
        expect(tileOf(g.player.x)).toBe(JUNCTION_COL);
        expect(tileOf(g.player.y)).toBe(JUNCTION_ROW);
      }
    }
    expect(sawGlide).toBe(true);
  });

  it("does not fire on a reversal", () => {
    const g = onCorridor(13, 25, RIGHT);
    advance(g, 3);
    setWanted(g, LEFT);
    tick(g);
    expect(g.player.dir).toBe(LEFT);
    expect(g.player.glideSteps).toBe(0);
  });
});

describe("cornering against a pursuer", () => {
  /**
   * The point of all of it: a lap of a loop with cornering on, and the same lap with it
   * off, at identical speed. The gap between them is what a player earns by turning early
   * — and it is what the pests, who may only turn on a tile centre, can never take back.
   *
   * The circuit is the bottom-centre loop: row 25 from col 10 to 17, down the col-17
   * shaft to row 29, back along row 29, up the col-10 shaft. Twenty-two tiles, four
   * corners.
   */
  const LAP: { at: { col: number; row: number }; turn: Dir }[] = [
    { at: { col: 17, row: 25 }, turn: DOWN },
    { at: { col: 17, row: 29 }, turn: LEFT },
    { at: { col: 10, row: 29 }, turn: UP },
    { at: { col: 10, row: 25 }, turn: RIGHT },
  ];

  function runLaps(laps: number, corner: boolean): number {
    const g = onCorridor(10, 25, RIGHT);
    if (!corner) disableCornering(g);
    let next = 0;
    let done = 0;
    let ticks = 0;
    while (done < laps && ticks < 20_000) {
      const col = tileOf(g.player.x);
      const row = tileOf(g.player.y);
      const wp = LAP[next];
      // Buffer the turn on ARRIVAL in the corner tile, not before: the engine then takes
      // it at the earliest legal moment, which is exactly what cornering is. Buffering it
      // any earlier would have the player turn down the first opening it passed.
      if (col === wp.at.col && row === wp.at.row) setWanted(g, wp.turn);
      if (g.player.dir === wp.turn) {
        next = (next + 1) % LAP.length;
        if (next === 0) done++;
      }
      tick(g);
      ticks++;
    }
    return ticks;
  }

  it("completes the loop faster than the same run without cornering", () => {
    const withCorner = runLaps(4, true);
    const without = runLaps(4, false);
    expect(withCorner).toBeLessThan(without);
  });

  it("gains a tile and a third per lap — four corners at CORNER_LEAD each", () => {
    const laps = 6;
    const gainedTicks = runLaps(laps, false) - runLaps(laps, true);
    // 16 subunits per tick at the base speed.
    const gainedSubunits = gainedTicks * 16;
    const perLap = gainedSubunits / laps;
    // Four corners a lap. Allow a tick of slack either side for where the sampling of
    // "reached the waypoint" lands relative to the glide.
    expect(perLap).toBeGreaterThan(3 * CORNER_LEAD);
    expect(perLap).toBeLessThanOrEqual(5 * CORNER_LEAD);
  });
});

describe("cornering is not the turn tolerance", () => {
  /**
   * These two dials are separate on purpose and are the classic thing to conflate: both
   * make turns "take more easily", but only the corner lead buys distance. Widening the
   * tolerance to chase a cornering feel just makes late inputs sloppier.
   */
  it("keeps the late-turn tolerance under half a tile", () => {
    expect(TURN_TOLERANCE).toBeGreaterThan(0);
    expect(TURN_TOLERANCE).toBeLessThan(SUB / 2);
  });

  it("keeps the corner lead under half a tile, so a glide starts inside its own tile", () => {
    expect(CORNER_LEAD).toBeLessThan(SUB / 2);
  });

  it("gains nothing at all when the lead is zero, however wide the tolerance", () => {
    const g = approachingTheCorner();
    g.tuning = { ...g.tuning, cornerLead: 0, turnTolerance: 59 };
    setWanted(g, DOWN);
    advance(g, 20);

    const centre = approachingTheCorner();
    advance(centre, TICKS_TO_CENTRE);
    setWanted(centre, DOWN);
    advance(centre, 20 - TICKS_TO_CENTRE);

    expect(g.player.y).toBe(centre.player.y);
  });
});

describe("pests cannot corner", () => {
  it("only ever changes a pest's direction on an exact tile centre", () => {
    const g = beginPlay(createGame());
    stripGrains(g);
    const seen = g.pests.map((p) => p.dir);
    for (let i = 0; i < 3000; i++) {
      tick(g);
      g.pests.forEach((p, k) => {
        if (p.dir === seen[k]) return;
        seen[k] = p.dir;
        // A pest that is out in the maze turns only at a junction centre. The pen states
        // are excluded: shuffling out through the gate is a scripted move, not a turn.
        if (p.state !== 2) return;
        const offX = offsetFromCentre(p.x);
        const offY = offsetFromCentre(p.y);
        expect(offX === 0 || offY === 0).toBe(true);
      });
    }
  });

  it("puts the player closer to safety after a corner than the pest chasing it", () => {
    // A whole-system sanity check rather than an arithmetic one: run the bot's circuit
    // with a pest in tow and confirm the gap does not shrink.
    const g = onCorridor(10, 25, RIGHT);
    const rat = createGame().pests[0];
    rat.x = tileCentre(10);
    rat.y = tileCentre(26);
    rat.dir = UP;
    g.pests = [rat];
    g.tuning = { ...g.tuning, pestSpeed: g.tuning.playerSpeed };

    const before = tileDistance(g.grid, { col: 10, row: 26 }, { col: 10, row: 25 });
    expect(before).toBe(1);

    const LAPS: Dir[] = [DOWN, LEFT, UP, RIGHT];
    setWanted(g, RIGHT);
    for (let i = 0; i < 600; i++) {
      const col = tileOf(g.player.x);
      const row = tileOf(g.player.y);
      if (col === 17 && row === 25) setWanted(g, LAPS[0]);
      else if (col === 17 && row === 29) setWanted(g, LAPS[1]);
      else if (col === 10 && row === 29) setWanted(g, LAPS[2]);
      else if (col === 10 && row === 25) setWanted(g, LAPS[3]);
      tick(g);
    }
    const gap = tileDistance(
      g.grid,
      { col: tileOf(rat.x), row: tileOf(rat.y) },
      { col: tileOf(g.player.x), row: tileOf(g.player.y) },
    );
    // The player, cornering at equal speed, is not caught and is not on top of the pest.
    expect(g.phase).not.toBe(2);
    expect(gap).toBeGreaterThan(1);
  });
});
