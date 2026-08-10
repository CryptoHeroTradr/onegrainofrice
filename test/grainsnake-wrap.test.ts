/**
 * THE BOARD WRAPS. *`ENGINE_VERSION` 2, 2026-08-08.*
 *
 * Going off an edge brings the snake out of the opposite side; self-collision is the
 * only death left. This suite covers the rule itself, the four corners where both axes
 * wrap in consecutive steps, and — the assertion a naive implementation misses —
 * **self-collision THROUGH a seam**.
 *
 * ── WHY THAT LAST ONE IS THE ONE THAT MATTERS ───────────────────────────────────
 * The obvious way to get this wrong is to make the head's POSITION modular and leave
 * the occupancy test reading an index that was never reduced. The snake then passes
 * through itself at the seam and nowhere else: every ordinary collision still works,
 * every wrap still looks right, and the bug appears only when a player runs off one
 * edge into their own trail on the other — which is exactly the manoeuvre wrapping
 * invites, so it is common in play and absent from a suite that only tests the two
 * halves separately.
 *
 * ── AND WHY THIS SUITE EXISTS AT ALL, GIVEN NOTHING BROKE ───────────────────────
 * Removing the walls failed zero of the 517 tests that existed. That is not a clean
 * bill of health: the suite had eleven `expect(dead).toBe(false)` assertions and not
 * one asserting that a death happens, so deleting the only hazard that fires at short
 * lengths could not have failed anything. Positive death coverage lives in
 * `grainsnake-death.test.ts`; this file's job is the geometry.
 */
import { describe, it, expect } from "vitest";
import { COLS, ROWS, CELL_COUNT, ENGINE_VERSION, SCORE_GRAIN, multiplierFor } from "@/lib/grainsnake/rules";
import {
  createGame,
  neighbour,
  colOf,
  rowOf,
  replay,
  runLog,
  segmentAt,
  snapshot,
  stepMut,
  drainTicks,
  outcomeOf,
} from "@/lib/grainsnake/engine";
import { DOWN, LEFT, RIGHT, UP, type Dir, type InputEvent } from "@/lib/grainsnake/types";
import {
  DIRS,
  crossedSeam,
  driveAccumulated,
  head,
  recordGreedyRun,
  stateWithBody,
  stepOneCell,
} from "./grainsnake-support";

const cellAt = (c: number, r: number) => r * COLS + c;

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

describe("neighbour() is total — it can no longer fail", () => {
  it("returns a real cell for every cell × direction on the board", () => {
    // The assertion that makes deleting `if (next < 0) return true` from the test
    // helpers safe rather than optimistic. 529 × 4 = 2,116 cases, which is all of them.
    for (let cell = 0; cell < CELL_COUNT; cell++) {
      for (const d of DIRS) {
        const n = neighbour(cell, d);
        expect(n, `neighbour(${cell}, ${d}) left the board`).toBeGreaterThanOrEqual(0);
        expect(n, `neighbour(${cell}, ${d}) ran past the last cell`).toBeLessThan(CELL_COUNT);
      }
    }
  });

  it("always moves exactly one cell on the torus, never two", () => {
    // Catches the sign bug specifically: JS `%` keeps the dividend's sign, so a
    // missing `+ COLS` makes `-1 % 23` come back `-1` and the step lands somewhere
    // arbitrary rather than on the far edge.
    for (let cell = 0; cell < CELL_COUNT; cell++) {
      for (const d of DIRS) {
        const n = neighbour(cell, d);
        const dx = Math.min(
          Math.abs(colOf(n) - colOf(cell)),
          COLS - Math.abs(colOf(n) - colOf(cell)),
        );
        const dy = Math.min(
          Math.abs(rowOf(n) - rowOf(cell)),
          ROWS - Math.abs(rowOf(n) - rowOf(cell)),
        );
        expect(dx + dy, `neighbour(${cell}, ${d}) is not one step away`).toBe(1);
      }
    }
  });

  it("is reversible — stepping back returns to the cell you left", () => {
    for (let cell = 0; cell < CELL_COUNT; cell++) {
      for (const d of DIRS) {
        expect(neighbour(neighbour(cell, d), (d ^ 2) as Dir)).toBe(cell);
      }
    }
  });
});

describe("the snake wraps on all four edges", () => {
  /** Head on the given border cell, body trailing safely behind it. */
  const atEdge = (headCell: number, dir: Dir) => {
    const back1 = neighbour(headCell, (dir ^ 2) as Dir);
    const back2 = neighbour(back1, (dir ^ 2) as Dir);
    return stateWithBody([headCell, back1, back2], dir);
  };

  const CASES: { name: string; from: number; dir: Dir; to: number }[] = [
    { name: "off the TOP arrives at the bottom", from: cellAt(11, 0), dir: UP, to: cellAt(11, ROWS - 1) },
    { name: "off the BOTTOM arrives at the top", from: cellAt(11, ROWS - 1), dir: DOWN, to: cellAt(11, 0) },
    { name: "off the LEFT arrives at the right", from: cellAt(0, 11), dir: LEFT, to: cellAt(COLS - 1, 11) },
    { name: "off the RIGHT arrives at the left", from: cellAt(COLS - 1, 11), dir: RIGHT, to: cellAt(0, 11) },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const s = atEdge(c.from, c.dir);
      stepOneCell(s, null);
      expect(s.dead, "wrapping is not a death").toBe(false);
      expect(head(s)).toBe(c.to);
      // The other axis must not move. A wrap that also shifts the row is the classic
      // off-by-one in the index arithmetic, and it looks almost right on screen.
      expect(rowOf(head(s)) === rowOf(c.to) && colOf(head(s)) === colOf(c.to)).toBe(true);
    });
  }

  it("preserves the row when crossing a vertical edge, and the column horizontally", () => {
    for (let r = 0; r < ROWS; r++) {
      const s = stateWithBody([cellAt(0, r), cellAt(1, r), cellAt(2, r)], LEFT);
      stepOneCell(s, null);
      expect(rowOf(head(s)), `row ${r} changed row on a left wrap`).toBe(r);
      expect(colOf(head(s))).toBe(COLS - 1);
    }
    for (let c = 0; c < COLS; c++) {
      const s = stateWithBody([cellAt(c, 0), cellAt(c, 1), cellAt(c, 2)], UP);
      stepOneCell(s, null);
      expect(colOf(head(s)), `column ${c} changed column on an up wrap`).toBe(c);
      expect(rowOf(head(s))).toBe(ROWS - 1);
    }
  });
});

describe("the four corners", () => {
  /**
   * A corner is where BOTH axes wrap on consecutive steps, and it is its own case
   * because an implementation that reduces one axis correctly can still compose the
   * pair wrong — the second wrap reads a column index the first one already moved.
   */
  const CORNERS: { name: string; cell: number; first: Dir; second: Dir; end: number }[] = [
    {
      name: "top-left, up then left",
      cell: cellAt(0, 0),
      first: UP,
      second: LEFT,
      end: cellAt(COLS - 1, ROWS - 1),
    },
    {
      name: "top-right, up then right",
      cell: cellAt(COLS - 1, 0),
      first: UP,
      second: RIGHT,
      end: cellAt(0, ROWS - 1),
    },
    {
      name: "bottom-left, down then left",
      cell: cellAt(0, ROWS - 1),
      first: DOWN,
      second: LEFT,
      end: cellAt(COLS - 1, 0),
    },
    {
      name: "bottom-right, down then right",
      cell: cellAt(COLS - 1, ROWS - 1),
      first: DOWN,
      second: RIGHT,
      end: cellAt(0, 0),
    },
  ];

  for (const c of CORNERS) {
    it(`${c.name} wraps both axes and lands on the opposite corner`, () => {
      // Body laid out along the axis it is NOT about to leave, so neither step can be
      // a self-collision and the only thing under test is the arithmetic.
      const back = neighbour(c.cell, (c.second ^ 2) as Dir);
      const back2 = neighbour(back, (c.second ^ 2) as Dir);
      const s = stateWithBody([c.cell, back, back2], c.first);

      stepOneCell(s, null); // off one edge
      expect(s.dead).toBe(false);
      stepOneCell(s, c.second); // off the other
      expect(s.dead).toBe(false);
      expect(head(s)).toBe(c.end);
    });
  }

  it("a diagonal lap of the whole board returns to where it started", () => {
    // COLS and ROWS are equal and odd, so alternating one step right and one step down
    // from any cell returns to it after exactly 2 × COLS steps. An arithmetic error at
    // either seam breaks the identity.
    const start = cellAt(3, 7);
    const s = stateWithBody([start, cellAt(2, 7), cellAt(1, 7)], RIGHT);
    s.length = 1; // a single grain cannot collide with itself; isolate the geometry
    s.occupied.fill(0);
    s.occupied[start] = 1;
    s.cells[s.headPos] = start;

    for (let i = 0; i < COLS; i++) {
      stepOneCell(s, RIGHT);
      stepOneCell(s, DOWN);
    }
    expect(s.dead).toBe(false);
    expect(head(s)).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// A wrap changes nothing else
// ---------------------------------------------------------------------------

describe("growth, scoring and spawning are unaffected by a wrap", () => {
  /** Head one step from the left edge, about to wrap onto a grain waiting there. */
  function aboutToWrapOntoAGrain() {
    const s = stateWithBody([cellAt(0, 9), cellAt(1, 9), cellAt(2, 9)], LEFT);
    s.grain = cellAt(COLS - 1, 9); // straight through the seam
    return s;
  }

  it("eating on the wrapping step grows the snake by exactly one", () => {
    const s = aboutToWrapOntoAGrain();
    const before = s.length;
    stepOneCell(s, null);
    expect(s.dead).toBe(false);
    expect(head(s), "did not arrive on the grain").toBe(cellAt(COLS - 1, 9));
    expect(s.length).toBe(before + 1);
    expect(s.foodEaten).toBe(1);
  });

  it("scores a wrapped grain at exactly the same value as any other", () => {
    const wrapped = aboutToWrapOntoAGrain();
    stepOneCell(wrapped, null);

    // The control: the identical eat, mid-board, at the same tier.
    const plain = stateWithBody([cellAt(9, 9), cellAt(10, 9), cellAt(11, 9)], LEFT);
    plain.grain = cellAt(8, 9);
    stepOneCell(plain, null);

    expect(wrapped.score).toBe(plain.score);
    expect(wrapped.score).toBe(SCORE_GRAIN * multiplierFor(0));
    expect(wrapped.length).toBe(plain.length);
  });

  it("respawns the grain on a free cell after a wrapped eat", () => {
    const s = aboutToWrapOntoAGrain();
    stepOneCell(s, null);
    expect(s.grain).toBeGreaterThanOrEqual(0);
    expect(s.grain).toBeLessThan(CELL_COUNT);
    expect(s.occupied[s.grain], "grain spawned inside the trail").toBe(0);
  });

  it("the tail still vacates across a seam — the exemption is not edge-specific", () => {
    // A ring of four cells straddling the left/right seam: the head steps into the cell
    // its own tail is leaving, on the wrapping step. That must survive.
    const s = stateWithBody(
      [cellAt(0, 5), cellAt(0, 4), cellAt(COLS - 1, 4), cellAt(COLS - 1, 5)],
      DOWN,
    );
    // Head at (0,5) facing DOWN; the tail is (22,5). Steering LEFT wraps into it.
    const tailBefore = segmentAt(s, s.length - 1);
    expect(tailBefore).toBe(cellAt(COLS - 1, 5));
    stepOneCell(s, LEFT);
    expect(s.dead, "moving into the vacating tail across a seam must survive").toBe(false);
    expect(head(s)).toBe(cellAt(COLS - 1, 5));
  });
});

// ---------------------------------------------------------------------------
// The one a naive implementation misses
// ---------------------------------------------------------------------------

describe("self-collision THROUGH a wrap kills", () => {
  it("moving off the top into your own trail at the bottom is a death", () => {
    // The exact case named in the spec's acceptance criteria. The trail lies along the
    // bottom row; the head sits in the top row of the same column, facing UP.
    const col = 6;
    const body = [
      cellAt(col, 0), // head, in the top row
      cellAt(col + 1, 0),
      cellAt(col + 2, 0),
      cellAt(col + 2, ROWS - 1), // …and the trail reaches the bottom row
      cellAt(col + 1, ROWS - 1),
      cellAt(col, ROWS - 1), // directly "above" the head across the seam
      // Two more cells so the collision target is NOT the tail: the vacating-tail
      // exemption would otherwise make this manoeuvre survivable, and the test would
      // be asserting the wrong rule.
      cellAt(col - 1, ROWS - 1),
      cellAt(col - 2, ROWS - 1),
    ];
    const s = stateWithBody(body, UP);
    const target = neighbour(head(s), UP);

    expect(target, "the step under test does not cross the seam").toBe(cellAt(col, ROWS - 1));
    expect(crossedSeam(head(s), target)).toBe(true);
    expect(s.occupied[target], "the fixture is wrong — nothing to collide with").toBe(1);
    expect(target, "must not be the exempt vacating tail").not.toBe(segmentAt(s, s.length - 1));

    stepOneCell(s, null);
    expect(s.dead, "passed through its own trail at the seam").toBe(true);
  });

  it("kills on every edge, not only the top", () => {
    const CASES: { dir: Dir; label: string }[] = [
      { dir: UP, label: "top" },
      { dir: DOWN, label: "bottom" },
      { dir: LEFT, label: "left" },
      { dir: RIGHT, label: "right" },
    ];
    for (const { dir, label } of CASES) {
      // Head on the border facing out; the cell it wraps into is occupied by the far
      // end of its own trail, joined to it the long way round so the body is a legal
      // shape rather than a hand-drawn impossibility.
      const start = dir === UP ? cellAt(8, 0) : dir === DOWN ? cellAt(8, ROWS - 1) : dir === LEFT ? cellAt(0, 8) : cellAt(COLS - 1, 8);
      const wrapTo = neighbour(start, dir);
      const back = (dir ^ 2) as Dir;
      const body = [start, neighbour(start, back), neighbour(neighbour(start, back), back)];
      const s = stateWithBody(body, dir);
      // Plant the far end of the trail in the arrival cell, and make it not the tail.
      s.occupied[wrapTo] = 1;
      s.cells[(s.headPos - 1 + CELL_COUNT) % CELL_COUNT] = wrapTo;

      stepOneCell(s, null);
      expect(s.dead, `wrapping off the ${label} edge into the trail did not kill`).toBe(true);
    }
  });

  it("CONTROL: the same wrap into an EMPTY cell does not kill", () => {
    // Without this the suite above is satisfied by an engine that kills on every wrap.
    const s = stateWithBody([cellAt(8, 0), cellAt(8, 1), cellAt(8, 2)], UP);
    stepOneCell(s, null);
    expect(s.dead).toBe(false);
    expect(head(s)).toBe(cellAt(8, ROWS - 1));
  });
});

// ---------------------------------------------------------------------------
// A wrapping run is still a deterministic, replayable run
// ---------------------------------------------------------------------------

/**
 * A RECORDED run rather than a hand-written script.
 *
 * A blind script almost never meets a grain — the first four candidates ate nothing in
 * 1,800 ticks — so it would replay a snake that never grew, never drew the PRNG and
 * never scored, which is the vacuous pass this project has already been caught by once.
 * `recordGreedyRun` drives a grain-chasing bot through the real engine and keeps the
 * `(tick, dir)` pairs it actually produced; on this seed that is 21 grains eaten and 9
 * seams crossed.
 */
const WRAP_SEED = 1;
const WRAP_TICKS = 3000;
const RECORDED = recordGreedyRun(WRAP_SEED, WRAP_TICKS);
const WRAP_SCRIPT: InputEvent[] = RECORDED.inputs;
const byTick = new Map<number, Dir>(WRAP_SCRIPT.map((e) => [e.tick, e.dir]));

describe("a wrapping run is deterministic and replayable", () => {
  it("the recorded run actually wraps AND eats — otherwise everything below is vacuous", () => {
    expect(RECORDED.wraps, "the run never crossed a seam").toBeGreaterThan(0);
    expect(RECORDED.state.dead, "the run died before it could be compared").toBe(false);
    expect(RECORDED.state.tick).toBe(WRAP_TICKS);
    expect(RECORDED.state.foodEaten, "ate nothing, so the PRNG was never drawn").toBeGreaterThan(0);
    expect(RECORDED.state.score).toBeGreaterThan(0);
  });

  it("is identical at 120, 60 and 45 Hz", () => {
    // The frame-counting bug is deterministic at every rate — it just produces a
    // DIFFERENT run at each — so a suite that only drives 16.67 ms frames passes on it.
    const shots = [1000 / 120, 1000 / 60, 1000 / 45].map((ms) =>
      snapshot(driveAccumulated(WRAP_SEED, byTick, WRAP_TICKS, ms, drainTicks)),
    );
    expect(shots[0]).toBe(shots[1]);
    expect(shots[1]).toBe(shots[2]);
  });

  it("the frame-rate runs are the same run the tick-driver produced", () => {
    const direct = runLog(WRAP_SEED, WRAP_SCRIPT, WRAP_TICKS);
    const framed = driveAccumulated(WRAP_SEED, byTick, WRAP_TICKS, 1000 / 120, drainTicks);
    expect(snapshot(framed)).toBe(snapshot(direct));
  });

  it("replays to the same score", () => {
    const direct = runLog(WRAP_SEED, WRAP_SCRIPT, WRAP_TICKS);
    const r = replay(
      { seed: WRAP_SEED, inputs: WRAP_SCRIPT, ticks: WRAP_TICKS, engineVersion: ENGINE_VERSION },
      ENGINE_VERSION,
    );
    expect(r.ok, r.reason).toBe(true);
    expect(r.outcome).toEqual(outcomeOf(direct));
    expect(r.outcome!.foodEaten, "a run that ate nothing replays trivially").toBeGreaterThan(0);
  });

  it("refuses the run under the OLD engine version", () => {
    // The rule that stops a tuning pass rescoring history. A version-1 trace is not
    // re-simulated under version-2 geometry — it is refused.
    const r = replay(
      { seed: WRAP_SEED, inputs: WRAP_SCRIPT, ticks: WRAP_TICKS, engineVersion: ENGINE_VERSION - 1 },
      ENGINE_VERSION,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/version/i);
  });
});
