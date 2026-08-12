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
import { boardFit, boardScale } from "@/components/grainsnake/GrainsnakeCanvas";

const FLOOR = 15;

describe("board scaling", () => {
  it("never returns a cell smaller than the size the gate validated", () => {
    // Including viewports too small to hold the board at all: the DRAWING stays on the
    // 15px grid whatever the box, and a box that cannot hold it is handled by
    // `boardFit` — never by resampling each grain at a size nobody looked at.
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

/**
 * The board is shown smaller when it does not fit. It is never shown clipped.
 *
 * *Added 2026-08-12.* The slot centres the canvas, and a centred child overflows
 * equally in both directions — so an oversized board loses its top and bottom rows to
 * the clip, with no scroll position that can reach them. On a torus whose edges wrap,
 * those are the two rows the player most needs to see.
 */
describe("board fit", () => {
  it("is exactly 1 whenever the board fits, so the common path is untouched", () => {
    for (const [w, h] of [
      [345, 345], // the floor board in the smallest box that holds it
      [375, 800],
      [390, 844],
      [1920, 1080],
      [2560, 1440],
    ]) {
      expect(boardFit(w, h, boardScale(w, h)), `${w}×${h}`).toBe(1);
    }
  });

  it("shrinks the board to the box when even the floor does not fit", () => {
    // 315px is the board's slot on a 667px-tall phone with the d-pad open — the case
    // in the report. 345px of board in a 315px box was 15px clipped off each end.
    const px = boardScale(375, 315);
    const fit = boardFit(375, 315, px);
    expect(fit).toBeLessThan(1);
    expect(ROWS * px * fit).toBeLessThanOrEqual(315);
  });

  it("leaves nothing outside the box on any viewport, with or without the d-pad", () => {
    // Portrait phones, minus a controls column that is 0 with the pad closed and
    // ~230px with it open. Every one of these must fit on both axes.
    for (const [w, h] of [
      [320, 480],
      [360, 640],
      [375, 667],
      [390, 844],
      [412, 915],
    ]) {
      for (const controls of [0, 232]) {
        const boxW = w - 24; // the page's horizontal padding
        const boxH = h - 56 - 52 - 12 - controls; // nav, HUD, padding, controls
        if (boxH < ROWS) continue; // degenerate; the resize handler retries instead
        const px = boardScale(boxW, boxH);
        const fit = boardFit(boxW, boxH, px);
        const label = `${w}×${h} controls=${controls}`;
        expect(COLS * px * fit, `${label} width`).toBeLessThanOrEqual(boxW + 0.5);
        expect(ROWS * px * fit, `${label} height`).toBeLessThanOrEqual(boxH + 0.5);
      }
    }
  });

  it("never inflates a board to fill a box bigger than the ladder's next rung", () => {
    // A box between two rungs keeps the smaller rung at 1:1 rather than stretching to
    // a fractional cell — the stepping is the whole point of `boardScale`.
    const boxH = ROWS * 30 - 1;
    const px = boardScale(10_000, boxH);
    expect(px).toBe(15);
    expect(boardFit(10_000, boxH, px)).toBe(1);
  });
});
