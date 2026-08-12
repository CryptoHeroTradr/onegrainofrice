/**
 * TETRICE — lock delay, and the rule that a RESET REQUIRES A STATE CHANGE.
 *
 * The three refused-input instances are asserted separately, each paired with its positive
 * control (the same input in open space, which DOES reset). Without the pairing, an engine
 * that never resets the lock delay passes all three.
 */

import { describe, it, expect } from "vitest";
import { LOCK_DELAY_FRAMES, MAX_LOCK_RESETS } from "@/games/tetrice/engine/rules";
import { advance, fresh, tick, withActive, withCells } from "./tetrice-support";
import type { GameState } from "@/games/tetrice/engine/state";

/** A T resting flat on the floor, in the middle, free to move either way. */
function resting(): GameState {
  // T spawn cells are (1,0),(0,1),(1,1),(2,1): the wide row is at y+1, so y = 20 puts it
  // on the bottom row.
  return withActive(fresh(), "T", 0, 4, 20);
}

/** True once the piece under test has locked (a successor has spawned). */
function locked(s: GameState, startId: number): boolean {
  return s.active === null || s.active.id !== startId;
}

describe("TETRICE lock delay", () => {
  it("locks after exactly LOCK_DELAY_FRAMES resting frames, not one sooner", () => {
    const s = resting();
    const id = s.active!.id;
    const justBefore = advance(s, LOCK_DELAY_FRAMES - 1);
    expect(locked(justBefore, id), "locked early").toBe(false);
    const onSchedule = tick(justBefore);
    expect(locked(onSchedule, id), "did not lock on schedule").toBe(true);
  });

  it("a successful move restarts the timer", () => {
    const s = resting();
    const id = s.active!.id;
    let cur = advance(s, LOCK_DELAY_FRAMES - 1); // one frame from locking
    cur = tick(cur, ["MoveLeft"]);
    expect(locked(cur, id), "the reset did not happen").toBe(false);
    expect(cur.lockResets).toBe(1);

    // The full delay starts again from that frame — one of which has already elapsed.
    const almost = advance(cur, LOCK_DELAY_FRAMES - 2);
    expect(locked(almost, id)).toBe(false);
    expect(locked(tick(almost), id)).toBe(true);
  });

  it("a successful rotation restarts the timer", () => {
    const s = resting();
    const id = s.active!.id;
    let cur = advance(s, LOCK_DELAY_FRAMES - 1);
    cur = tick(cur, ["RotateCW"]);
    expect(locked(cur, id)).toBe(false);
    expect(cur.lockResets).toBe(1);
  });

  describe("A RESET REQUIRES A STATE CHANGE", () => {
    it("instance 1: a rotate input on an O does not reset", () => {
      const s = withActive(fresh(), "O", 0, 4, 20);
      const id = s.active!.id;
      let cur = advance(s, LOCK_DELAY_FRAMES - 1);
      cur = tick(cur, ["RotateCW"]);
      expect(cur.lockResets, "an O rotation spent a reset").toBe(0);
      expect(locked(cur, id), "an O was held on the surface by tapping rotate").toBe(true);
    });

    it("instance 1 control: a rotate on a T in the same place DOES reset", () => {
      const s = withActive(fresh(), "T", 0, 4, 20);
      const id = s.active!.id;
      let cur = advance(s, LOCK_DELAY_FRAMES - 1);
      cur = tick(cur, ["RotateCW"]);
      expect(cur.lockResets).toBe(1);
      expect(locked(cur, id)).toBe(false);
    });

    it("instance 2: a move into the WALL does not reset — the common one", () => {
      // A T hard against the left wall. Holding left is what everybody does while
      // deciding; if a refused move reset the timer the piece would hang for 8 seconds.
      const s = withActive(fresh(), "T", 0, 0, 20);
      const id = s.active!.id;
      let cur = advance(s, LOCK_DELAY_FRAMES - 1);
      cur = tick(cur, ["MoveLeft"]);
      expect(cur.lockResets, "a refused move spent a reset").toBe(0);
      expect(locked(cur, id), "holding left at the wall stalled the piece").toBe(true);
    });

    it("instance 2 control: the same piece moving RIGHT (which succeeds) does reset", () => {
      const s = withActive(fresh(), "T", 0, 0, 20);
      const id = s.active!.id;
      let cur = advance(s, LOCK_DELAY_FRAMES - 1);
      cur = tick(cur, ["MoveRight"]);
      expect(cur.lockResets).toBe(1);
      expect(locked(cur, id)).toBe(false);
    });

    it("instance 2b: a move into the STACK does not reset either", () => {
      let s = withActive(fresh(), "T", 0, 4, 20);
      // Wall off the cells the piece would move into, on both sides.
      s = withCells(s, [[3, 21], [7, 21], [4, 20], [8, 20]]);
      const id = s.active!.id;
      let cur = advance(s, LOCK_DELAY_FRAMES - 1);
      cur = tick(cur, ["MoveLeft", "MoveRight"]);
      expect(cur.lockResets).toBe(0);
      expect(locked(cur, id)).toBe(true);
    });

    it("instance 3: a rotation whose every kick fails does not reset", () => {
      // Box a T so no offset in the table resolves.
      let s = withActive(fresh(), "T", 0, 4, 10);
      const walls: Array<readonly [number, number]> = [];
      for (let y = 8; y <= 14; y++) {
        for (let x = 0; x < 10; x++) {
          if (x >= 4 && x <= 6 && y >= 10 && y <= 11) continue;
          walls.push([x, y]);
        }
      }
      s = withCells(s, walls);
      const id = s.active!.id;
      let cur = advance(s, LOCK_DELAY_FRAMES - 1);
      cur = tick(cur, ["RotateCW"]);
      expect(cur.active?.rot, "the rotation should not have happened").not.toBe(1);
      expect(cur.lockResets, "a failed rotation spent a reset").toBe(0);
      expect(locked(cur, id)).toBe(true);
    });

    it("instance 3 control: the same T with room DOES rotate and reset", () => {
      const s = withActive(fresh(), "T", 0, 4, 20);
      let cur = advance(s, LOCK_DELAY_FRAMES - 1);
      cur = tick(cur, ["RotateCW"]);
      expect(cur.lockResets).toBe(1);
    });
  });

  it("the 16th reset does not reset, and the forced lock happens on schedule", () => {
    // The maximal stall: wait out 29 frames, spend a reset on the 30th, fifteen times.
    // Then keep trying — the 16th attempt must do nothing and the piece must lock.
    const s = resting();
    const id = s.active!.id;
    let cur = s;
    let elapsed = 0;

    for (let i = 0; i < MAX_LOCK_RESETS; i++) {
      // The first cycle starts from "not resting" (timer -1). Every later one starts from
      // timer 1, because the frame a reset is spent on is ALSO the first frame of the new
      // delay — so it can only wait 28 more before it must reset again.
      const wait = i === 0 ? LOCK_DELAY_FRAMES - 1 : LOCK_DELAY_FRAMES - 2;
      cur = advance(cur, wait);
      elapsed += wait;
      expect(locked(cur, id), `locked during reset cycle ${i}`).toBe(false);
      cur = tick(cur, [i % 2 === 0 ? "MoveLeft" : "MoveRight"]);
      elapsed += 1;
      expect(cur.lockResets, `reset ${i + 1} was not counted`).toBe(i + 1);
    }
    expect(cur.lockResets).toBe(MAX_LOCK_RESETS);

    // The 16th attempt. It moves the piece — but the reset budget is spent, so the timer
    // must keep running rather than restart.
    const timerBefore = cur.lockTimer;
    cur = tick(cur, ["MoveLeft"]);
    elapsed += 1;
    expect(cur.lockResets, "a 16th reset was granted").toBe(MAX_LOCK_RESETS);
    expect(cur.lockTimer, "the timer restarted on the 16th").toBeGreaterThan(timerBefore);

    // It locks on schedule from the 15th reset, not from the 16th move.
    const remaining = LOCK_DELAY_FRAMES - cur.lockTimer;
    const justBefore = advance(cur, remaining - 1);
    elapsed += remaining - 1;
    expect(locked(justBefore, id), "locked early").toBe(false);
    cur = tick(justBefore);
    elapsed += 1;
    expect(locked(cur, id), "never locked — infinity spin is possible").toBe(true);

    // THE REAL WORST-CASE STALL, stated in frames so that a change to it is visible.
    //
    //   first cycle          30 frames  (timer -1 -> 29, then the reset frame)
    //   14 further cycles    29 frames each = 406
    //   final wait           29 frames  (timer 1 -> 30)
    //                        ------------------------------
    //                        465 frames = 7.75 s at 60 Hz
    //
    // The spec quotes 480 (= 30 + 15x30, "8 seconds"). That arithmetic treats the frame a
    // reset is spent on as sitting OUTSIDE the delay it starts; the engine counts it as
    // the first frame of that delay, which is what makes a reset cost a frame rather than
    // being free. 15 frames of difference, in the safe direction, and recorded here rather
    // than silently rounded to match the prose.
    const expected =
      LOCK_DELAY_FRAMES + (MAX_LOCK_RESETS - 1) * (LOCK_DELAY_FRAMES - 1) + (LOCK_DELAY_FRAMES - 1);
    expect(elapsed).toBe(expected);
    expect(elapsed).toBe(465);
  });

  it("a piece in the air has no lock timer running", () => {
    const s = withActive(fresh(), "T", 0, 4, 4);
    const cur = advance(s, 10, ["MoveLeft"]);
    expect(cur.lockTimer).toBe(-1);
    expect(cur.lockResets, "moving in mid-air spent lock resets").toBe(0);
  });

  it("hold does not reset the lock delay — it spawns a new piece with a fresh one", () => {
    const s = resting();
    let cur = advance(s, 10);
    expect(cur.lockTimer).toBe(10);
    cur = tick(cur, ["Hold"]);
    expect(cur.hold).toBe("T");
    expect(cur.holdUsed).toBe(true);
    expect(cur.lockResets).toBe(0);
  });
});
