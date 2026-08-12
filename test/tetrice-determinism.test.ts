/**
 * TETRICE — determinism, which is the property the leaderboard rests on.
 *
 * Same seed + same tick-indexed actions ⇒ byte-identical final state, in the browser and
 * in Node, for ever. If this suite ever goes red, the replay verifier is not wrong — it is
 * meaningless.
 */

import { describe, it, expect } from "vitest";
import { createInitialState, serialize } from "@/games/tetrice/engine/state";
import { run, step, ALL_ACTIONS, type Action } from "@/games/tetrice/engine/step";
import { seedRng, nextState } from "@/games/tetrice/engine/rng";

const SEED = 0x7e771ce;
const TICKS = 4000;

/**
 * A deterministic pseudo-player. Uses the engine's own generator on a SEPARATE seed, so
 * the input log is reproducible without touching the game's RNG — and without
 * `Math.random()`, which appears nowhere in this engine or its tests.
 */
function inputLog(seed: number, ticks: number): Action[][] {
  let s = seedRng(seed);
  const log: Action[][] = [];
  for (let t = 0; t < ticks; t++) {
    s = nextState(s);
    const actions: Action[] = [];
    // Roughly one action every few ticks, weighted toward movement.
    if (s % 5 === 0) actions.push(ALL_ACTIONS[s % ALL_ACTIONS.length]);
    if (s % 37 === 0) actions.push("HardDrop");
    log.push(actions);
  }
  return log;
}

describe("TETRICE determinism", () => {
  it("two runs from the same seed and the same log are byte-identical", () => {
    const log = inputLog(0xa11ce, TICKS);
    const a = run(createInitialState(SEED), log, TICKS);
    const b = run(createInitialState(SEED), log, TICKS);

    // Control: a run that did nothing would also be identical to itself.
    expect(a.ticks, "the run never advanced — this test measured nothing").toBeGreaterThan(100);
    expect(a.score + a.lines, "no piece ever locked — this test measured nothing").toBeGreaterThan(0);

    expect(serialize(a)).toBe(serialize(b));
  });

  it("a different seed produces a different run", () => {
    // The other direction: a serializer that returned a constant would pass the test above.
    const log = inputLog(0xa11ce, TICKS);
    const a = run(createInitialState(SEED), log, TICKS);
    const b = run(createInitialState(SEED + 1), log, TICKS);
    expect(serialize(a)).not.toBe(serialize(b));
  });

  it("a different log produces a different run", () => {
    const a = run(createInitialState(SEED), inputLog(1, TICKS), TICKS);
    const b = run(createInitialState(SEED), inputLog(2, TICKS), TICKS);
    expect(serialize(a)).not.toBe(serialize(b));
  });

  it("step does not mutate the state it is given", () => {
    // Purity, asserted rather than assumed. A `step` that wrote through to the caller's
    // typed arrays would still be deterministic in a single run and would corrupt a
    // replayer that holds an earlier state.
    let s = createInitialState(SEED);
    const log = inputLog(0xbeef, 600);
    let stepped = 0;
    for (let t = 0; t < 600 && !s.over; t++) {
      const before = serialize(s);
      const next = step(s, log[t], t);
      expect(serialize(s), `tick ${t} mutated its input state`).toBe(before);
      s = next;
      stepped += 1;
    }
    // Control: the loop must have actually run, and must have locked pieces — a purity
    // check over a state nothing wrote to is not a purity check.
    expect(stepped).toBeGreaterThan(100);
    expect(s.pieceCounter).toBeGreaterThan(1);
  });

  it("action ORDER within a tick does not matter — the engine fixes it", () => {
    // Two clients emitting the same set differently must produce the same tick, or the
    // trace's meaning depends on array order.
    const base = createInitialState(SEED);
    const forward = step(base, ["MoveLeft", "RotateCW", "SoftDrop"], 0);
    const reversed = step(base, ["SoftDrop", "RotateCW", "MoveLeft"], 0);
    expect(serialize(forward)).toBe(serialize(reversed));
  });

  it("a repeated action in one tick applies once", () => {
    const base = createInitialState(SEED);
    const once = step(base, ["MoveLeft"], 0);
    const thrice = step(base, ["MoveLeft", "MoveLeft", "MoveLeft"], 0);
    expect(serialize(once)).toBe(serialize(thrice));
  });

  it("a frame fed out of order throws rather than producing a plausible wrong run", () => {
    const s = createInitialState(SEED);
    expect(() => step(s, [], 7)).toThrow(/frame 7/);
  });

  it("a finished run absorbs further frames without changing", () => {
    let s = createInitialState(SEED);
    // Bury the spawn rows so the next spawn tops out.
    const well = new Uint8Array(s.well);
    for (let x = 0; x < 10; x++) well[1 * 10 + x] = 1;
    s = { ...s, well };
    s = run(s, [["HardDrop"]], 1);
    expect(s.over).toBe(true);
    const frozen = serialize(s);
    expect(serialize(step(s, ["MoveLeft"], s.ticks))).toBe(frozen);
  });
});
