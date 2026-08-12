/**
 * TETRICE — the 7-bag randomizer.
 *
 * A shape is never more than twelve pieces away and the player can count. That is the
 * whole promise, and this suite pins both halves of it: what the bag guarantees, and what
 * it deliberately does NOT.
 */

import { describe, it, expect } from "vitest";
import { SHAPES, type Shape } from "@/games/tetrice/engine/rules";
import { drawShape } from "@/games/tetrice/engine/state";
import { seedRng } from "@/games/tetrice/engine/rng";

/** Deal `count` shapes straight from the generator, the way the queue does. */
function deal(seed: number, count: number): Shape[] {
  let rng = seedRng(seed);
  let bag: readonly Shape[] = [];
  const out: Shape[] = [];
  for (let i = 0; i < count; i++) {
    const drawn = drawShape(rng, bag);
    rng = drawn.rng;
    bag = drawn.bag;
    out.push(drawn.shape);
  }
  return out;
}

const PIECES = 7007; // 1001 whole bags

describe("TETRICE 7-bag", () => {
  it("every ALIGNED window of 7 contains each shape exactly once", () => {
    const dealt = deal(0xbadc0de, PIECES);
    expect(dealt).toHaveLength(PIECES);
    for (let start = 0; start < dealt.length; start += 7) {
      const window = dealt.slice(start, start + 7);
      const counts = new Map<Shape, number>();
      for (const s of window) counts.set(s, (counts.get(s) ?? 0) + 1);
      expect(
        [...counts.entries()].sort(),
        `bag starting at ${start} is not a permutation: ${window.join("")}`,
      ).toEqual(SHAPES.map((s) => [s, 1] as const).sort());
    }
  });

  it("SLIDING windows of 7 are NOT permutations, and that is correct", () => {
    // Written as an assertion rather than a comment because it is the single most likely
    // thing for someone to "fix". A 7-bag permutes WITHIN a bag; across a boundary the
    // last shape of one bag and the first of the next may be the same, so a sliding
    // window straddling that boundary legitimately contains a duplicate. A test that
    // demanded every sliding window be a permutation would fail on a correct 7-bag and
    // pass only on a generator that had stopped being one.
    const dealt = deal(0xbadc0de, 7000);
    let straddlingDuplicates = 0;
    for (let start = 1; start + 7 <= dealt.length; start++) {
      if (start % 7 === 0) continue;
      if (new Set(dealt.slice(start, start + 7)).size < 7) straddlingDuplicates += 1;
    }
    expect(straddlingDuplicates).toBeGreaterThan(0);
  });

  it("no shape is ever more than 12 pieces away — every window of 14 holds all seven", () => {
    // The real drought bound, and the one the player feels. Worst case is a shape first in
    // one bag and last in the next: 12 pieces between occurrences.
    const dealt = deal(0x1ce, PIECES);
    const lastSeen = new Map<Shape, number>();
    let maxGap = 0;
    dealt.forEach((shape, i) => {
      const prev = lastSeen.get(shape);
      if (prev !== undefined) maxGap = Math.max(maxGap, i - prev - 1);
      lastSeen.set(shape, i);
    });
    expect(maxGap).toBeLessThanOrEqual(12);
    // And the bound is TIGHT — if this drops, the generator has stopped being a 7-bag and
    // started being something more regular.
    expect(maxGap).toBe(12);

    for (let start = 0; start + 14 <= dealt.length; start++) {
      expect(new Set(dealt.slice(start, start + 14)).size, `window at ${start}`).toBe(7);
    }
  });

  it("is deterministic: one seed, one sequence", () => {
    expect(deal(42, 700).join("")).toBe(deal(42, 700).join(""));
    expect(deal(42, 700).join("")).not.toBe(deal(43, 700).join(""));
  });

  it("deals every shape equally often over whole bags", () => {
    const dealt = deal(0x5eed, PIECES);
    const counts = SHAPES.map((s) => dealt.filter((d) => d === s).length);
    expect(new Set(counts).size, `uneven deal: ${counts.join(",")}`).toBe(1);
    expect(counts[0]).toBe(PIECES / 7);
  });
});
