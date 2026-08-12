/**
 * TETRICE — SRS rotation and its two kick tables.
 *
 * Three layers, because each catches something the others cannot:
 *  1. The tables are pinned as DATA against the published reference.
 *  2. Named geometric cases — a wall kick, and the I-piece floor kick.
 *  3. A property sweep: whenever a rotation kicks, the offset taken must be the FIRST
 *     feasible entry in that transition's table. That is the part an implementation can
 *     get subtly wrong (right table, wrong order) while passing every named case.
 */

import { describe, it, expect } from "vitest";
import {
  KICKS_I,
  KICKS_JLSTZ,
  SHAPES,
  kickOffsets,
  type Rotation,
  type Shape,
} from "@/games/tetrice/engine/rules";
import { collides } from "@/games/tetrice/engine/state";
import { seedRng, nextState } from "@/games/tetrice/engine/rng";
import { fresh, tick, withActive, withCells } from "./tetrice-support";

const TRANSITIONS: ReadonlyArray<readonly [Rotation, Rotation]> = [
  [0, 1], [1, 0], [1, 2], [2, 1], [2, 3], [3, 2], [3, 0], [0, 3],
];

describe("SRS kick tables — pinned as data", () => {
  // Transcribed from the published tables, +y UP. `kickOffsets` negates y into engine
  // axes. Written out longhand so a diff against the reference is a diff, not a mapping
  // exercise.
  const EXPECTED_JLSTZ: Record<string, number[][]> = {
    "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const EXPECTED_I: Record<string, number[][]> = {
    "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };

  it.each(TRANSITIONS)("JLSTZ %i>%i matches the reference", (from, to) => {
    const key = `${from}>${to}`;
    expect(KICKS_JLSTZ[key].map((c) => [...c])).toEqual(EXPECTED_JLSTZ[key]);
  });

  it.each(TRANSITIONS)("I %i>%i matches the reference, and is its own table", (from, to) => {
    const key = `${from}>${to}`;
    expect(KICKS_I[key].map((c) => [...c])).toEqual(EXPECTED_I[key]);
    expect(KICKS_I[key]).not.toEqual(KICKS_JLSTZ[key]);
  });

  it("every transition offers exactly five offsets, starting with the identity", () => {
    for (const [from, to] of TRANSITIONS) {
      for (const shape of ["T", "I"] as Shape[]) {
        const offsets = kickOffsets(shape, from, to);
        expect(offsets).toHaveLength(5);
        expect(offsets[0]).toEqual([0, 0]);
      }
    }
  });

  it("the y axis is flipped on the way out, exactly once", () => {
    // The tables are stored +y up and the engine is +y down. A double flip or no flip
    // would put every vertical kick in the wrong direction, which is the kind of bug that
    // still lets most rotations succeed.
    expect(kickOffsets("T", 1, 0)[3]).toEqual([0, -2]); // published (0,+2) = up 2
    expect(kickOffsets("T", 0, 1)[3]).toEqual([0, 2]); // published (0,-2) = down 2
  });
});

describe("SRS rotation", () => {
  it("rotates in open space with no kick, through all four states", () => {
    let s = withActive(fresh(), "T", 0, 4, 8);
    for (const expected of [1, 2, 3, 0]) {
      s = tick(s, ["RotateCW"]);
      expect(s.active?.rot).toBe(expected);
      expect(s.active?.x).toBe(4);
    }
  });

  it("O NEVER MOVES when rotated, in any state, in either direction", () => {
    for (const rot of [0, 1, 2, 3] as Rotation[]) {
      for (const action of ["RotateCW", "RotateCCW"] as const) {
        const before = withActive(fresh(), "O", rot, 4, 8);
        const after = tick(before, [action]);
        expect(after.active?.shape).toBe("O");
        expect(after.active?.rot).toBe(rot);
        expect(after.active?.x).toBe(before.active?.x);
        // y may advance by gravity; the rotation itself must move nothing.
        expect(after.active?.y).toBe(before.active?.y);
      }
    }
  });

  it("JLSTZ wall kick: a T against the left wall kicks right by one", () => {
    // T in state R occupies column x+1; at origin x=-1 that column is the wall column.
    // Rotating back to spawn would put a cell at x=-1, so offset 1 = (+1,0) is taken.
    const s = withActive(fresh(), "T", 1, -1, 8);
    const after = tick(s, ["RotateCCW"]);
    expect(after.active?.rot).toBe(0);
    expect(after.active?.x).toBe(0);
  });

  it("I-PIECE FLOOR KICK: a flat I on the floor kicks up two rows", () => {
    // The named case, and the one only the I table provides. A horizontal I resting on
    // the bottom row cannot become vertical without leaving the matrix — offsets 0..3 all
    // fail, and the fifth, (+1,-2) in engine axes, lifts it clear.
    const s = withActive(fresh(), "I", 0, 3, 20);
    expect(s.active?.y).toBe(20);
    const after = tick(s, ["RotateCW"]);
    expect(after.active?.rot).toBe(1);
    expect(after.active?.x).toBe(4);
    expect(after.active?.y).toBe(18);
  });

  it("a rotation with no free offset does not happen at all", () => {
    // Box a T in so every kick collides. Nothing about the piece may change.
    let s = withActive(fresh(), "T", 0, 4, 10);
    const walls: Array<readonly [number, number]> = [];
    for (let y = 8; y <= 14; y++) {
      for (let x = 0; x < 10; x++) {
        if (x >= 4 && x <= 6 && y >= 10 && y <= 11) continue; // leave the piece's own cells
        walls.push([x, y]);
      }
    }
    s = withCells(s, walls);
    const after = tick(s, ["RotateCW"]);
    expect(after.active?.rot).toBe(0);
    expect(after.active?.x).toBe(4);
    expect(after.active?.y).toBe(10);
  });

  it("PROPERTY: a kicked rotation always takes the FIRST feasible offset", () => {
    // The sweep. Random-ish wells from the engine's own generator (never Math.random),
    // every shape, every transition. Whenever a rotation succeeds, re-derive which offset
    // it must have used and assert every earlier one was genuinely blocked — which is the
    // ordering bug a named case cannot see.
    let rnd = seedRng(0xc0ffee);
    let checked = 0;
    let kicked = 0;

    for (let trial = 0; trial < 400; trial++) {
      let s = fresh();
      const junk: Array<readonly [number, number]> = [];
      for (let i = 0; i < 40; i++) {
        rnd = nextState(rnd);
        junk.push([rnd % 10, 6 + (rnd % 15)]);
      }
      s = withCells(s, junk);

      for (const shape of SHAPES) {
        for (const [from, to] of TRANSITIONS) {
          rnd = nextState(rnd);
          const x = (rnd % 10) - 1;
          rnd = nextState(rnd);
          const y = 4 + (rnd % 14);
          if (collides(s.well, shape, from, x, y)) continue;

          const before = withActive(s, shape, from, x, y);
          const dir = (to - from + 4) % 4 === 1 ? "RotateCW" : "RotateCCW";
          const after = tick(before, [dir]);
          const p = after.active;
          if (!p || p.rot === from) continue; // refused, or O
          checked += 1;

          const offsets = kickOffsets(shape, from, to);
          const usedIndex = offsets.findIndex(
            ([dx, dy]) => p.x === x + dx && p.y === y + dy,
          );
          expect(usedIndex, `${shape} ${from}>${to} landed off-table at ${p.x},${p.y}`).toBeGreaterThanOrEqual(0);
          if (usedIndex > 0) kicked += 1;
          for (let i = 0; i < usedIndex; i++) {
            const [dx, dy] = offsets[i];
            expect(
              collides(s.well, shape, to, x + dx, y + dy),
              `${shape} ${from}>${to} skipped a FREE offset ${i} (${dx},${dy})`,
            ).toBe(true);
          }
        }
      }
    }

    // Controls: the sweep must have actually rotated things, and must have actually
    // kicked. A sweep where every rotation was refused would pass vacuously.
    expect(checked, "no rotation ever succeeded — the sweep measured nothing").toBeGreaterThan(200);
    expect(kicked, "no rotation ever kicked — the sweep never exercised the tables").toBeGreaterThan(10);
  });
});
