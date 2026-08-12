/**
 * TETRICE — the only terminator, ASSERTED POSITIVELY.
 *
 * Carried over from the 2026-08-08 lesson on GRAINSNAKE, where removing the walls failed
 * zero of 517 tests because every assertion said `expect(dead).toBe(false)`. Every
 * topping-out case here is paired with the nearest SURVIVING one: "it ended" is satisfied
 * by an engine that ends every run, and "it survived" by one that never ends.
 */

import { describe, it, expect } from "vitest";
import { COLS } from "@/games/tetrice/engine/rules";
import { collides, idx } from "@/games/tetrice/engine/state";
import { advance, fresh, render, tick, withActive, withRow } from "./tetrice-support";
import { step } from "@/games/tetrice/engine/step";

describe("TETRICE top-out", () => {
  it("a spawn onto an occupied cell ends the run, and does not throw", () => {
    // Occupy the spawn row — but leave column 9 empty, or the row is a COMPLETE LINE and
    // clears itself on the very lock meant to trigger the overlap. (That is not a
    // hypothetical: it is what the first draft of this test did, and it made a working
    // top-out look broken.)
    let s = withRow(fresh(), 1, [9]);
    s = withActive(s, "T", 0, 4, 20); // a piece resting on the floor, about to lock

    let after = s;
    expect(() => {
      after = tick(s, ["HardDrop"]);
    }).not.toThrow();

    expect(after.over, render(after)).toBe(true);
    expect(after.active, "a topped-out run still has a piece in play").toBeNull();
  });

  it("CONTROL: the same stack one row lower does NOT top out", () => {
    // The pairing. If this also ended the run, the assertion above would be measuring an
    // engine that ends every run rather than the spawn-overlap rule.
    let s = withRow(fresh(), 2); // row 2, the first VISIBLE row — spawn is clear
    s = withActive(s, "T", 0, 4, 19);
    const after = tick(s, ["HardDrop"]);

    expect(after.over, render(after)).toBe(false);
    expect(after.active, "no successor spawned").not.toBeNull();
  });

  it("a hold that swaps into an occupied spawn tops out by the same rule", () => {
    // The spec says the check is identical for a piece from the queue and one out of the
    // hold slot. This is the half that is easy to leave out.
    let s = fresh();
    s = { ...s, hold: "I", holdUsed: false };
    s = withRow(s, 1, [9]); // spawn row occupied, but not a complete line
    s = withActive(s, "T", 0, 4, 10);

    let after = s;
    expect(() => {
      after = tick(s, ["Hold"]);
    }).not.toThrow();
    expect(after.over).toBe(true);
    expect(after.hold, "the outgoing piece was not banked before the run ended").toBe("T");
  });

  it("CONTROL: a hold into a clear spawn keeps the run going", () => {
    let s = fresh();
    s = { ...s, hold: "I", holdUsed: false };
    s = withActive(s, "T", 0, 4, 10);
    const after = tick(s, ["Hold"]);
    expect(after.over).toBe(false);
    expect(after.active?.shape).toBe("I");
    expect(after.hold).toBe("T");
  });

  it("a run ends only on top-out — a full-height stack with a clear spawn keeps going", () => {
    // Every visible row occupied except the spawn rows and one column. The run is in a
    // terrible position and is still a run: there is no height rule, no kill screen.
    let s = fresh();
    for (let y = 2; y < 22; y++) s = withRow(s, y, [9]);
    s = withActive(s, "I", 1, 7, 0); // vertical I down the open column
    const after = tick(s, ["HardDrop"]);
    expect(after.over, render(after)).toBe(false);
    expect(after.lines).toBe(4);
  });

  it("there is NO separate lock-out rule: a piece may lock entirely in the buffer", () => {
    // Deliberately absent (spec: *The matrix*). A piece that locks above the visible field
    // ends nothing by itself; the NEXT spawn is what ends the run, and only if it overlaps.
    let s = fresh();
    for (let y = 2; y < 22; y++) s = withRow(s, y, [0]);
    // A T dropped into column 0's chimney comes to rest with cells in the buffer rows.
    s = withActive(s, "T", 1, -1, 0);
    const after = tick(s, ["HardDrop"]);
    const lockedInBuffer = after.well[idx(0, 1)] !== 0 || after.well[idx(0, 0)] !== 0;
    expect(lockedInBuffer, render(after)).toBe(true);
    // It locked in the buffer and the run continued — the successor spawned fine.
    expect(after.over).toBe(false);
  });

  it("the run stops accruing once it is over", () => {
    let s = withRow(fresh(), 1, [9]);
    s = withActive(s, "T", 0, 4, 20);
    const ended = tick(s, ["HardDrop"]);
    expect(ended.over).toBe(true);

    const scoreAtEnd = ended.score;
    const ticksAtEnd = ended.ticks;
    const later = advance(ended, 120, ["HardDrop", "SoftDrop"]);
    expect(later.score, "a finished run kept scoring").toBe(scoreAtEnd);
    expect(later.ticks, "a finished run kept ticking — duration is derived from this").toBe(ticksAtEnd);
  });

  it("gravity alone tops out an unattended run, without throwing", () => {
    // No inputs at all. Pieces stack up under gravity until a spawn overlaps. This is the
    // end-to-end version: nothing is hand-placed except the seed.
    let s = fresh(0x70907);
    expect(() => {
      s = advance(s, 20000);
    }).not.toThrow();
    expect(s.over, "an unattended run never ended").toBe(true);
    expect(s.pieceCounter, "no pieces were ever played").toBeGreaterThan(10);
  });

  it("the spawn check is exactly `collides` at the spawn position", () => {
    // Pin the rule itself, so a future "helpful" extra condition is visible as a change.
    const s = fresh();
    const buried = withRow(s, 1, [9]);
    for (let x = 0; x < COLS - 1; x++) expect(buried.well[idx(x, 1)]).not.toBe(0);
    expect(collides(buried.well, "T", 0, 4, 0)).toBe(true);
    expect(collides(s.well, "T", 0, 4, 0)).toBe(false);
  });

  it("stepping a topped-out state is a no-op rather than an error", () => {
    let s = withRow(fresh(), 1, [9]);
    s = withActive(s, "T", 0, 4, 20);
    const ended = tick(s, ["HardDrop"]);
    expect(ended.over).toBe(true);
    // Including with a frame number that has run past the tick the run ended on: a caller
    // looping to the end of a trace is ordinary, not a bug.
    expect(() => step(ended, ["MoveLeft"], ended.ticks + 50)).not.toThrow();
  });
});
