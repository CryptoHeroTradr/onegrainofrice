/**
 * Board scaling — integer multiples of the cell the size gate validated, and never
 * below it.
 *
 * The whole board-size decision rests on 15px really being 15px: the gate looked at a
 * 13-grain chain at that size, on a DPR-3 phone, with every probe passing. A
 * non-integer scale resamples those silhouettes and reintroduces exactly the smudge
 * the gate was built to rule out, so the ladder is 15, 30, 45 and nothing between.
 */
import { describe, it, expect } from "vitest";
import { COLS, ROWS } from "@/lib/grainsnake/rules";
import { boardScale } from "@/components/grainsnake/GrainsnakeCanvas";

const FLOOR = 15;

describe("board scaling", () => {
  it("never returns a cell smaller than the size the gate validated", () => {
    // Including viewports too small to hold the board at all: the honest failure is a
    // board that overflows a container that scrolls, not one that is quietly
    // illegible at a size nobody looked at.
    for (const w of [200, 280, 320, 344, 345, 400]) {
      expect(boardScale(w, w), `${w}px viewport`).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it("only ever returns integer multiples of the floor", () => {
    for (let w = 100; w <= 4000; w += 7) {
      const px = boardScale(w, w);
      expect(px % FLOOR, `${w}px gave ${px}px cells`).toBe(0);
    }
  });

  it("fits a 375px-wide phone at exactly the gate's cell size", () => {
    // 23 × 15 = 345px, which is the case the gate was measured for.
    const px = boardScale(375, 800);
    expect(px).toBe(15);
    expect(COLS * px).toBe(345);
  });

  it("steps up a whole factor when there is room for one, and not before", () => {
    const need2 = COLS * 30;
    expect(boardScale(need2 - 1, 10_000)).toBe(15);
    expect(boardScale(need2, 10_000)).toBe(30);
    expect(boardScale(COLS * 45, 10_000)).toBe(45);
  });

  it("is limited by the smaller axis", () => {
    // A wide, short window is the landscape case: height decides.
    expect(boardScale(10_000, ROWS * 15)).toBe(15);
    expect(boardScale(10_000, ROWS * 30 - 1)).toBe(15);
    expect(boardScale(10_000, ROWS * 30)).toBe(30);
  });

  it("never produces a fractional cell, however awkward the box", () => {
    for (const [w, h] of [
      [393, 852],
      [390, 844],
      [412, 915],
      [768, 1024],
      [1920, 1080],
      [360, 640],
    ]) {
      const px = boardScale(w, h);
      expect(Number.isInteger(px)).toBe(true);
      expect(px % FLOOR).toBe(0);
    }
  });
});
