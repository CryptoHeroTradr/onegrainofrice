/**
 * TETRICE — line clears, the shift, and every way points are earned.
 *
 * The level boundary case has its own test by name: a lock that clears lines AND crosses a
 * level threshold scores at the OLD level and then levels up. That single ordering is the
 * likeliest place for a replay verifier to disagree with a client, on the one run in fifty
 * that crossed a threshold, and it is one line of test.
 */

import { describe, it, expect } from "vitest";
import { LINE_SCORES } from "@/games/tetrice/engine/rules";
import { idx } from "@/games/tetrice/engine/state";
import {
  advance,
  filledCount,
  fresh,
  render,
  tick,
  withActive,
  withCells,
  withCounters,
  withRow,
} from "./tetrice-support";
import type { GameState } from "@/games/tetrice/engine/state";

/** A vertical I dropped down the empty column 0 travels from y = 0 to y = 18. */
const I_DROP_CELLS = 18;

/**
 * A well whose bottom `rows` rows are full except column 0, with a vertical I standing in
 * column 0 ready to hard-drop into the gap. Dropping it clears exactly `rows` rows.
 */
function primed(rows: number, counters: Partial<Pick<GameState, "lines" | "level">> = {}): GameState {
  let s = fresh();
  for (let i = 0; i < rows; i++) s = withRow(s, 21 - i, [0]);
  s = withCounters(s, { score: 0, lines: 0, level: 1, ...counters });
  // I in state R is a single column at box-x 2; origin x = -2 puts it in column 0.
  return withActive(s, "I", 1, -2, 0);
}

describe("TETRICE line clears", () => {
  it.each([
    [1, "single"],
    [2, "double"],
    [3, "triple"],
    [4, "quad"],
  ])("clears %i row(s) — %s — and scores it at level 1", (rows) => {
    const before = primed(rows);
    const after = tick(before, ["HardDrop"]);

    expect(after.lines, render(after)).toBe(rows);
    expect(after.level).toBe(1);

    // Score is the line value plus the hard-drop points for the distance travelled.
    // Column 0 is empty all the way down whatever `rows` is, so the I always falls from
    // y = 0 to y = 18 — eighteen cells.
    expect(after.score).toBe(LINE_SCORES[rows] * 1 + I_DROP_CELLS * 2);
  });

  it.each([
    [1, 100],
    [2, 300],
    [3, 500],
    [4, 800],
  ])("scores %i row(s) at level 7 as %i x 7", (rows, base) => {
    // lines 60 puts the run at level 7, and stays there across a small clear.
    const before = primed(rows, { lines: 60, level: 7 });
    const after = tick(before, ["HardDrop"]);
    expect(after.level).toBe(7);
    expect(after.score - I_DROP_CELLS * 2).toBe(base * 7);
  });

  it("THE LEVEL BOUNDARY: lines are scored at the level they were PLAYED under", () => {
    // 8 lines on the board, a double: it scores at level 1 and then levels up to 2.
    const before = primed(2, { lines: 8, level: 1 });
    const after = tick(before, ["HardDrop"]);
    expect(after.lines).toBe(10);
    expect(after.level, "the level did not advance").toBe(2);
    expect(after.score - I_DROP_CELLS * 2, "scored at the NEW level").toBe(300 * 1);
  });

  it("rows above a cleared row shift down", () => {
    let s = fresh();
    s = withRow(s, 21, [0]); // bottom row, one gap
    s = withCells(s, [[5, 19]], "T"); // a lone marker two rows above
    s = withActive(s, "I", 1, -2, 0);

    expect(s.well[idx(5, 19)]).not.toBe(0);
    const after = tick(s, ["HardDrop"]);

    expect(after.lines).toBe(1);
    // The marker fell exactly one row, and nothing was left behind.
    expect(after.well[idx(5, 19)], render(after)).toBe(0);
    expect(after.well[idx(5, 20)], render(after)).not.toBe(0);
    // The I's other three cells came down with it rather than vanishing.
    expect(filledCount(after)).toBe(1 + 3);
  });

  it("a row that spans a hole does NOT clear", () => {
    // The negative control for the whole mechanism: nine of ten columns filled.
    let s = fresh();
    s = withRow(s, 21, [0, 4]); // two gaps — the piece can only fill one
    s = withActive(s, "I", 1, -2, 0);
    const before = filledCount(s);
    const after = tick(s, ["HardDrop"]);

    expect(after.lines, render(after)).toBe(0);
    expect(after.score, "a non-clear scored line points").toBe(I_DROP_CELLS * 2);
    expect(filledCount(after)).toBe(before + 4);
  });

  it("clears four rows at once without disturbing what is below them", () => {
    // Rows 18..21 clearable, row 17 partially filled and must survive intact one row lower.
    let s = fresh();
    for (const y of [18, 19, 20, 21]) s = withRow(s, y, [0]);
    s = withCells(s, [[2, 17], [3, 17]], "L");
    s = withActive(s, "I", 1, -2, 0);
    const after = tick(s, ["HardDrop"]);

    expect(after.lines).toBe(4);
    expect(after.well[idx(2, 21)], render(after)).not.toBe(0);
    expect(after.well[idx(3, 21)]).not.toBe(0);
    expect(filledCount(after)).toBe(2);
  });
});

describe("TETRICE drop scoring", () => {
  it("soft drop scores one point per cell actually travelled", () => {
    const s = withActive(fresh(), "T", 0, 4, 0);
    const after = advance(s, 5, ["SoftDrop"]);
    expect(after.score).toBe(5);
    expect(after.active?.y).toBe(5);
  });

  it("soft drop into the floor scores nothing for the cell it cannot travel", () => {
    // The control: points must come from movement, not from the input arriving.
    const s = withActive(fresh(), "T", 0, 4, 20); // already resting on the floor
    const after = tick(s, ["SoftDrop"]);
    expect(after.score, "a refused soft drop scored").toBe(0);
  });

  it("hard drop scores two points per cell travelled, and locks on that tick", () => {
    const s = withActive(fresh(), "T", 0, 4, 0);
    const id = s.active!.id;
    const after = tick(s, ["HardDrop"]);
    // T's lowest cells sit at y+1, so it comes to rest at y = 20: twenty cells.
    expect(after.score).toBe(20 * 2);
    expect(after.active?.id, "the piece did not lock on the tick it landed").not.toBe(id);
    expect(filledCount(after)).toBe(4);
  });

  it("a hard drop with nowhere to fall scores nothing and still locks", () => {
    const s = withActive(fresh(), "T", 0, 4, 20);
    const id = s.active!.id;
    const after = tick(s, ["HardDrop"]);
    expect(after.score).toBe(0);
    expect(after.active?.id).not.toBe(id);
  });

  it("soft and hard drop points accrue together over a run", () => {
    let s = withActive(fresh(), "T", 0, 4, 0);
    s = advance(s, 3, ["SoftDrop"]); // 3 points, now at y = 3
    const after = tick(s, ["HardDrop"]); // 17 more cells at 2 points
    expect(after.score).toBe(3 + 17 * 2);
  });
});
