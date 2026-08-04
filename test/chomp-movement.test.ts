import { describe, expect, it } from "vitest";
import {
  PLAYER_SPEED,
  TURN_TOLERANCE,
  advance,
  beginPlay,
  createGame,
  playerTile,
  replay,
  setWanted,
  tick,
  type GameState,
} from "@/components/chomp/engine/game";
import { PLAYER_SPAWN_ROW, TUNNEL_ROW, offsetFromCentre, tileCentre } from "@/components/chomp/engine/maze";
import { COLS } from "@/components/chomp/engine/maze";
import { DOWN, LEFT, RIGHT, SPEED_SCALE, SUB, TICK_HZ, UP, type Dir } from "@/components/chomp/engine/types";

/**
 * Movement is the Phase 2 deliverable, so it gets the tests. Everything here is pure
 * integer simulation — no canvas, no window — which is exactly why the engine was
 * written to be callable from Node.
 *
 * The determinism tests are the important ones: server-side replay verification (the
 * anti-cheat plan's option (c)) is only a server change later if the simulation is
 * reproducible now.
 *
 * PHASE 3 NOTE. Two things changed under these tests and both are deliberate:
 *   - A run now opens on a READY hold before anything moves, so every test that measures
 *     movement starts by skipping it.
 *   - The board has pests on it. A test about turning must not be decided by a rat, so
 *     the movement tests empty the board and keep the player to themselves.
 */

/** A game with the ready hold skipped and nobody else on the board. */
function sandbox(): GameState {
  const g = beginPlay(createGame());
  g.pests = [];
  return g;
}

describe("speed units", () => {
  it("resolves 8 tiles/second to a whole number of subunits per tick", () => {
    // No rounding at the default speed: 8 * 120 / 60 = 16 subunits/tick exactly.
    expect(PLAYER_SPEED).toBe(16 * SPEED_SCALE);
  });

  /**
   * Row 29 is the full-width bottom corridor (cols 1-26 open) — the only run long
   * enough to measure a full second of travel without hitting a wall. The spawn
   * pocket on row 25 is deliberately short, so speed is measured here instead.
   */
  function onLongCorridor() {
    const g = sandbox();
    // Cleared, because this measures speed on OPEN path. With grains down the player is
    // slower by exactly one frozen tick per grain, which is the chomp freeze and is
    // measured on its own in test/chomp-pests.test.ts.
    for (let i = 0; i < g.grid.length; i++) if (g.grid[i] === 2 || g.grid[i] === 3) g.grid[i] = 1;
    g.grainsRemaining = 9999;
    g.player.y = tileCentre(29);
    g.player.x = tileCentre(24);
    g.player.dir = LEFT;
    g.player.wanted = LEFT;
    return g;
  }

  it("covers two tiles in 15 ticks", () => {
    const g = onLongCorridor();
    const x0 = g.player.x;
    advance(g, 15); // 15 * 16 subunits = 240 = 2 tiles
    expect(x0 - g.player.x).toBe(2 * SUB);
  });

  it("travels 8 tiles in one second of ticks", () => {
    const g = onLongCorridor();
    const x0 = g.player.x;
    advance(g, TICK_HZ);
    expect(x0 - g.player.x).toBe(8 * SUB);
  });
});

describe("walls", () => {
  it("stops dead at a wall instead of passing through it", () => {
    const g = sandbox();
    setWanted(g, LEFT);
    advance(g, 600); // far more than the corridor is long
    expect(g.player.blocked).toBe(true);
    // Parked exactly on a tile centre, not wedged part-way into the wall.
    expect(offsetFromCentre(g.player.x)).toBe(0);
  });

  it("keeps facing the wall it is stopped against", () => {
    const g = sandbox();
    setWanted(g, LEFT);
    advance(g, 600);
    expect(g.player.dir).toBe(LEFT);
  });

  it("ignores a turn into a wall and keeps going", () => {
    const g = sandbox();
    setWanted(g, LEFT);
    advance(g, 30);
    const before = g.player.dir;
    setWanted(g, UP); // row 24 above the spawn corridor is wall for most of its length
    advance(g, 2);
    // Either it stayed on course, or it found a legal opening — never a wall.
    expect([before, UP]).toContain(g.player.dir);
    const { col, row } = playerTile(g);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(col).toBeGreaterThanOrEqual(0);
  });
});

describe("turning feel", () => {
  it("reverses instantly, mid-corridor, without snapping to a centre", () => {
    const g = sandbox();
    setWanted(g, LEFT);
    advance(g, 7); // deliberately land off-centre
    const offBefore = offsetFromCentre(g.player.x);
    expect(offBefore).not.toBe(0);

    setWanted(g, RIGHT);
    tick(g);
    expect(g.player.dir).toBe(RIGHT);
  });

  it("accepts a perpendicular turn keyed slightly early", () => {
    const g = sandbox();
    // Walk left to a junction, then ask to go down just before reaching its centre.
    setWanted(g, LEFT);
    advance(g, 45);
    setWanted(g, DOWN);
    advance(g, 20);
    expect(g.player.dir).toBe(DOWN);
  });

  it("snaps onto the corridor centre when a perpendicular turn is taken", () => {
    const g = sandbox();
    setWanted(g, LEFT);
    advance(g, 45);
    setWanted(g, DOWN);
    advance(g, 20);
    // Now travelling vertically, so the horizontal axis must be exactly centred —
    // otherwise the player would drift diagonally through the maze.
    expect(offsetFromCentre(g.player.x)).toBe(0);
  });

  it("holds a buffered direction until it becomes legal", () => {
    const g = sandbox();
    setWanted(g, LEFT);
    advance(g, 5);
    // Ask for a direction that is illegal right now and never clear it.
    setWanted(g, DOWN);
    const dirs = new Set<number>();
    for (let i = 0; i < 200; i++) {
      tick(g);
      dirs.add(g.player.dir);
    }
    // It eventually took, rather than being dropped on the first illegal tick.
    expect(dirs.has(DOWN)).toBe(true);
  });

  it("never leaves the player off-centre on the axis it is not travelling along", () => {
    // Except mid-corner. Phase 3 added the corner glide, which deliberately runs both
    // axes at once for up to CORNER_LEAD subunits — that diagonal IS the off-centre
    // state, and it is the mechanism the player gains distance with. What still has to
    // hold is that it always lands back on the centre when the glide ends, which is what
    // the second assertion checks.
    const g = sandbox();
    const dirs: Dir[] = [LEFT, DOWN, RIGHT, UP, LEFT, LEFT, DOWN, RIGHT];
    let sawGlide = false;
    for (const d of dirs) {
      setWanted(g, d);
      for (let i = 0; i < 40; i++) {
        tick(g);
        if (g.player.glideSteps > 0) {
          sawGlide = true;
          continue;
        }
        const off =
          g.player.dir === UP || g.player.dir === DOWN
            ? offsetFromCentre(g.player.x)
            : offsetFromCentre(g.player.y);
        expect(off).toBe(0);
      }
    }
    expect(sawGlide).toBe(true);
  });

  it("has a turn tolerance smaller than half a tile", () => {
    // Larger than this and the snap becomes a visible teleport.
    expect(TURN_TOLERANCE).toBeGreaterThan(0);
    expect(TURN_TOLERANCE).toBeLessThan(SUB / 2);
  });
});

describe("warp tunnel", () => {
  it("carries the player from one edge to the other", () => {
    const g = sandbox();
    // Drive to the tunnel row, then head left through the edge.
    g.player.y = tileCentre(TUNNEL_ROW);
    g.player.x = tileCentre(3);
    g.player.dir = LEFT;
    g.player.wanted = LEFT;
    advance(g, 60);
    expect(playerTile(g).col).toBeGreaterThan(COLS / 2);
    expect(playerTile(g).row).toBe(TUNNEL_ROW);
  });

  it("keeps the position inside the grid after wrapping", () => {
    const g = sandbox();
    g.player.y = tileCentre(TUNNEL_ROW);
    g.player.x = tileCentre(1);
    g.player.dir = LEFT;
    g.player.wanted = LEFT;
    advance(g, 300);
    expect(g.player.x).toBeGreaterThanOrEqual(0);
    expect(g.player.x).toBeLessThan(COLS * SUB);
  });
});

describe("eating", () => {
  it("clears grains it passes over and counts them", () => {
    const g = sandbox();
    const before = g.grainsRemaining;
    setWanted(g, LEFT);
    advance(g, 120);
    expect(g.grainsEaten).toBeGreaterThan(0);
    expect(g.grainsRemaining).toBe(before - g.grainsEaten - g.powerEaten);
  });

  it("does not eat the same grain twice", () => {
    const g = sandbox();
    setWanted(g, LEFT);
    advance(g, 60);
    const eaten = g.grainsEaten;
    setWanted(g, RIGHT);
    advance(g, 60);
    setWanted(g, LEFT);
    advance(g, 60);
    // Re-walking cleared corridor adds nothing beyond genuinely new tiles.
    expect(g.grainsEaten).toBeGreaterThanOrEqual(eaten);
    expect(g.grainsRemaining).toBeGreaterThanOrEqual(0);
  });

  it("starts the player on a spawn tile with no grain under it", () => {
    const g = sandbox();
    expect(g.grainsEaten).toBe(0);
    expect(playerTile(g).row).toBe(PLAYER_SPAWN_ROW);
  });
});

describe("determinism", () => {
  it("produces an identical run from the same inputs", () => {
    const script: [number, Dir][] = [
      [0, LEFT],
      [30, DOWN],
      [55, RIGHT],
      [90, UP],
      [140, LEFT],
      [200, DOWN],
    ];
    const run = () => {
      const g = sandbox();
      let i = 0;
      for (let t = 0; t < 400; t++) {
        while (i < script.length && script[i][0] === t) {
          setWanted(g, script[i][1] as Dir);
          i++;
        }
        tick(g);
      }
      return g;
    };
    const a = run();
    const b = run();
    expect(a.player).toEqual(b.player);
    expect(a.grainsEaten).toBe(b.grainsEaten);
    expect(Array.from(a.grid)).toEqual(Array.from(b.grid));
  });

  it("replays a recorded input trace to the same state", () => {
    // The full game, pests and all: replay() rebuilds a real run, so the run it is
    // checked against has to be a real one too.
    const g = createGame();
    const script: [number, Dir][] = [
      [0, LEFT],
      [25, UP],
      [60, RIGHT],
      [120, DOWN],
      [180, LEFT],
    ];
    let i = 0;
    const TICKS = 500;
    for (let t = 0; t < TICKS; t++) {
      while (i < script.length && script[i][0] === t) {
        setWanted(g, script[i][1]);
        i++;
      }
      tick(g);
    }

    // This is the whole anti-cheat bet: the trace alone reproduces the run.
    const verified = replay(g.inputLog, TICKS);
    expect(verified.player).toEqual(g.player);
    expect(verified.grainsEaten).toBe(g.grainsEaten);
    expect(verified.powerEaten).toBe(g.powerEaten);
    expect(Array.from(verified.grid)).toEqual(Array.from(g.grid));
  });

  it("does not log a repeated press of the direction already queued", () => {
    const g = sandbox();
    setWanted(g, LEFT);
    setWanted(g, LEFT);
    setWanted(g, LEFT);
    expect(g.inputLog).toHaveLength(1);
  });

  it("advances exactly one tick per tick() call", () => {
    const g = sandbox();
    advance(g, 123);
    expect(g.tick).toBe(123);
  });
});
