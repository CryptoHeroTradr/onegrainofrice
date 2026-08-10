/**
 * The renderer's three rules, and the fused trail — asserted rather than eyeballed.
 *
 * `test/canvas2d-shim.ts` cannot be the instrument here: it deliberately does not
 * implement rotation (it throws), and every grain this renderer draws is rotated to
 * its direction of travel. So this suite records the DRAW CALLS instead of the
 * pixels, tracking the transform stack so each ellipse can be placed in board
 * coordinates. That is the right altitude anyway — the claims are geometric
 * ("the head never leads", "consecutive rims overlap"), not chromatic.
 *
 * It is DOM-free: the recorder is forty lines of affine maths, and `paint()` never
 * touches anything but the context it is handed.
 */
import { describe, it, expect } from "vitest";
import { COLS, ROWS } from "@/lib/grainsnake/rules";
import { createGame, segmentAt } from "@/lib/grainsnake/engine";
import { LEFT, RIGHT, UP, type GameState } from "@/lib/grainsnake/types";
import { paint } from "@/components/grainsnake/render";
import {
  expectCouldHaveDied,
  feed,
  stateWithBody,
  stepOneCell,
} from "./grainsnake-support";

const PX = 20;

interface Drawn {
  /** Centre, in board pixels. */
  x: number;
  y: number;
  /** Radii as passed, before the transform. */
  rx: number;
  ry: number;
  rotation: number;
}

/**
 * A canvas context that records where ellipses land.
 *
 * Only the subset `paint()` uses, and a 2×3 affine stack so a `translate` + `rotate`
 * pair resolves to a real position. Anything not implemented is a no-op rather than a
 * throw: this is measuring placement, and a `quadraticCurveTo` in the hat has no
 * bearing on where a segment sits.
 */
function recordingCtx() {
  type M = [number, number, number, number, number, number]; // a b c d e f
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const ellipses: Drawn[] = [];

  const mul = (n: M): void => {
    m = [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  };

  const ctx = {
    ellipses,
    save: () => void stack.push([...m] as M),
    restore: () => {
      const p = stack.pop();
      if (p) m = p;
    },
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      m = [a, b, c, d, e, f];
    },
    translate: (x: number, y: number) => mul([1, 0, 0, 1, x, y]),
    rotate: (r: number) => mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]),
    ellipse: (x: number, y: number, rx: number, ry: number, rot: number) => {
      ellipses.push({
        x: m[0] * x + m[2] * y + m[4],
        y: m[1] * x + m[3] * y + m[5],
        rx,
        ry,
        rotation: Math.atan2(m[1], m[0]) + rot,
      });
    },
    beginPath: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    quadraticCurveTo: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "",
  };
  return ctx;
}

function render(state: GameState, f: number) {
  const ctx = recordingCtx();
  paint(ctx as unknown as CanvasRenderingContext2D, state, PX, f);
  return ctx.ellipses;
}

/** Centre of a cell, in board pixels. */
function centreOf(cell: number): { x: number; y: number } {
  return { x: ((cell % COLS) + 0.5) * PX, y: (Math.floor(cell / COLS) + 0.5) * PX };
}

/**
 * The body grains, separated from the smaller ellipses that make up each grain's
 * spine highlight and the head's hat.
 *
 * **The threshold is half a cell, and it was 0.4 until 2026-08-07.** A segment's long
 * radius is ~0.62 of a cell and its spine is 0.62 of *that* — about 0.38 — so at 0.4
 * the two classes were only just separated, and a jittered segment at the top of its
 * range pushed its own spine over the line. Every assertion below then compared a
 * grain against a highlight and measured nonsense. Half a cell sits in clear air:
 * segments are ≥0.585, the head is 0.54, and no highlight exceeds 0.41.
 */
function bodyGrains(ellipses: Drawn[]): Drawn[] {
  return ellipses.filter((e) => e.rx > PX * 0.5);
}

/** A snake driven a few cells so it has a real history to interpolate against. */
function movedSnake(): GameState {
  const s = createGame(162);
  s.started = true;
  for (let i = 0; i < 4; i++) stepOneCell(s, null);
  return s;
}

describe("rule 1 — the head renders LAGGING, never leading", () => {
  it("sits on the cell it came from at f=0, and on its current cell at f=1", () => {
    const s = movedSnake();
    const cameFrom = centreOf(segmentAt(s, 1));
    const now = centreOf(segmentAt(s, 0));

    // The head is the LAST ellipse of its size to be drawn (drawn after the body).
    const at0 = bodyGrains(render(s, 0)).at(-1)!;
    const at1 = bodyGrains(render(s, 1)).at(-1)!;

    expect(at0.x).toBeCloseTo(cameFrom.x, 5);
    expect(at0.y).toBeCloseTo(cameFrom.y, 5);
    expect(at1.x).toBeCloseTo(now.x, 5);
    expect(at1.y).toBeCloseTo(now.y, 5);
  });

  it("never draws the head past its current cell — no extrapolation at any f", () => {
    // The failure this guards: extrapolating along the direction vector puts the head
    // INSIDE the wall on the step before the collision resolves, so the player watches
    // the death happen a frame after it visibly already had.
    const s = movedSnake();
    const now = centreOf(segmentAt(s, 0));
    const cameFrom = centreOf(segmentAt(s, 1));
    const travel = Math.hypot(now.x - cameFrom.x, now.y - cameFrom.y);

    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const head = bodyGrains(render(s, f)).at(-1)!;
      const fromOrigin = Math.hypot(head.x - cameFrom.x, head.y - cameFrom.y);
      expect(fromOrigin, `f=${f} drew the head beyond its current cell`).toBeLessThanOrEqual(
        travel + 1e-6,
      );
    }
  });
});

describe("rule 2 — each segment interpolates toward its SUCCESSOR cell", () => {
  it("places every segment between its own cell and the one ahead of it", () => {
    const s = movedSnake();
    const f = 0.5;
    const grains = bodyGrains(render(s, f));
    // Drawn tail → head, so the last is the head and the rest ascend from the tail.
    const body = grains.slice(0, -1);

    // Segment j (1-indexed from head) should sit midway between cell[j] and cell[j-1].
    for (let k = 0; k < body.length; k++) {
      const j = body.length - k; // tail-first ordering back to head-relative index
      const to = centreOf(segmentAt(s, j));
      const fromCell = j + 1 <= s.length - 1 ? segmentAt(s, j + 1) : -1;
      if (fromCell < 0) continue; // the tail's origin is the vacated cell, checked below
      const from = centreOf(fromCell);
      expect(body[k].x, `segment ${j} x`).toBeCloseTo(from.x + (to.x - from.x) * f, 5);
      expect(body[k].y, `segment ${j} y`).toBeCloseTo(from.y + (to.y - from.y) * f, 5);
    }
  });

  it("turns the corner rather than cutting it", () => {
    // The failure: aiming every segment along the HEAD's direction makes the whole
    // body cut the corner on the tick a buffered turn lands — the turn is in the
    // state, the body is drawn as if it were not, and the snake is briefly a diagonal.
    const s = createGame(162);
    s.started = true;
    stepOneCell(s, RIGHT);
    stepOneCell(s, null);
    stepOneCell(s, UP); // the corner
    stepOneCell(s, null);

    const grains = bodyGrains(render(s, 1));
    const rotations = grains.map((g) => g.rotation);
    // A cut corner means every grain shares the head's angle. A turned one means at
    // least two distinct headings are on the board at once.
    const distinct = new Set(rotations.map((r) => Math.round(Math.cos(r)) * 2 + Math.round(Math.sin(r))));
    expect(distinct.size, "every segment shares one heading — the corner was cut").toBeGreaterThan(1);
  });
});

describe("rule 3 — a frozen fraction is honoured", () => {
  it("paints identically for the same state and the same f", () => {
    // The host holds `f` while paused or dead; if paint were not a pure function of
    // (state, f), holding it would not hold the picture.
    const s = movedSnake();
    expect(JSON.stringify(render(s, 0.37))).toBe(JSON.stringify(render(s, 0.37)));
  });

  it("paints differently for a different f — the fraction is actually used", () => {
    const s = movedSnake();
    expect(JSON.stringify(render(s, 0))).not.toBe(JSON.stringify(render(s, 1)));
  });
});

describe("the trail reads as FUSED, not as separated beads", () => {
  it("overlaps consecutive segments along the travel axis", () => {
    // The spec's *Rendering the trail*: gaps invite "could I have slipped through
    // that?", the answer is always no because the body occupies whole cells, and a
    // death into a space that looked passable is an unfair-feeling death.
    const s = movedSnake();
    const grains = bodyGrains(render(s, 1));
    expect(grains.length).toBeGreaterThanOrEqual(3);

    for (let i = 1; i < grains.length; i++) {
      const a = grains[i - 1];
      const b = grains[i];
      const gap = Math.hypot(b.x - a.x, b.y - a.y);
      // Rims merge when the half-lengths together exceed the centre distance.
      expect(a.rx + b.rx, `segments ${i - 1}→${i} leave a gap`).toBeGreaterThan(gap);
    }
  });

  it("keeps the long axis over half a cell and the short axis under it", () => {
    // Overlapping on BOTH axes thickens the trail into a rope; only the long axis may
    // exceed the cell.
    const s = movedSnake();
    for (const g of bodyGrains(render(s, 1))) {
      expect(g.rx).toBeGreaterThan(PX * 0.5);
      expect(g.ry).toBeLessThan(PX * 0.5);
    }
  });
});

describe("the trail stays FUSED ACROSS THE SEAM", () => {
  /**
   * *Added 2026-08-08, with the wrap.* The fuse gate measured a trail mid-board. The
   * edge is now somewhere players deliberately go — it is the whole gameplay
   * contribution of wrapping — so the gate's result has to hold there too, and it does
   * not hold for free: a segment that crosses a seam is at column 22 and column 0 at
   * once, and drawing it in only one of those places opens a gap at exactly the place
   * the player is steering through.
   *
   * The criterion is the same one the mid-board test uses, made torus-aware: for every
   * consecutive pair of grains, the SHORTEST distance between any drawn copy of one and
   * any drawn copy of the other is one cell, and their rims merge over it. Comparing
   * copies rather than primary positions is the point — the copy outside the board is
   * what makes the seam continuous.
   */
  const W = COLS * PX;
  const H = ROWS * PX;

  /** Every drawn copy of the grain that belongs at `cell`, including off-board ones. */
  function copiesAt(grains: Drawn[], cell: number): Drawn[] {
    const c = centreOf(cell);
    const out: Drawn[] = [];
    for (const g of grains) {
      for (const ox of [-1, 0, 1]) {
        for (const oy of [-1, 0, 1]) {
          if (Math.abs(g.x - (c.x + ox * W)) < 0.001 && Math.abs(g.y - (c.y + oy * H)) < 0.001) {
            out.push(g);
          }
        }
      }
    }
    return out;
  }

  /**
   * A trail laid across the left/right seam, travelling LEFT: the head has just left
   * column 0 and arrived at column 22, with its body still at columns 0, 1, 2.
   *
   * The direction has to agree with the BODY, not merely be declared. The first draft
   * put the head at column 0 with the body at 22, 21, 20 and labelled it LEFT — but a
   * head that came from column 22 and is at column 0 has travelled one step RIGHT, so
   * the renderer correctly drew it facing right and the 180° test correctly reported a
   * π discrepancy against a genuinely-leftward control. The fixture was wrong, not the
   * renderer.
   */
  function straddlingSnake(): GameState {
    return stateWithBody(
      [COLS - 1 + 5 * COLS, 0 + 5 * COLS, 1 + 5 * COLS, 2 + 5 * COLS],
      LEFT,
    );
  }

  it("draws a wrapping grain at BOTH edges", () => {
    const s = straddlingSnake();
    const grains = bodyGrains(render(s, 1));
    // The head is at column 0. Its copy belongs one cell past the right edge, so the
    // grain behind it at column 22 has something to merge with.
    const headCell = segmentAt(s, 0);
    const copies = copiesAt(grains, headCell);
    expect(copies.length, "the wrapping head was drawn only once").toBeGreaterThanOrEqual(2);
    expect(copies.some((g) => g.x < 0 || g.x > W), "no copy outside the board").toBe(true);
  });

  it("leaves NO HOLE in the trail — every segment is visible on the board at every f", () => {
    /**
     * The gameplay assertion, and the one the "both edges" test above is too weak to
     * make. *Added after a mutation run: drawing only the primary copy failed exactly
     * one assertion, because at f=1 the primary positions of a wrapping pair are
     * already adjacent to each other — they are simply both OFF the board.*
     *
     * A segment drawn only outside the field is a gap in the trail where the player is
     * looking, which is the unfair-feeling death the fused-trail rule exists to
     * prevent, and it is worse at the seam than anywhere because the seam is where
     * wrapping invites them to steer.
     */
    const s = straddlingSnake();
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const grains = bodyGrains(render(s, f));
      // Bounds INCLUSIVE: at f=0.5 a wrapping grain sits exactly on the seam, with its
      // two copies at x=0 and x=W. Both are half-visible and both are correct; a strict
      // inequality counts neither and reports a hole that is not there.
      const onBoard = grains.filter((g) => g.x >= 0 && g.x <= W && g.y >= 0 && g.y <= H);
      expect(onBoard.length, `f=${f}: a segment vanished off the board`).toBeGreaterThanOrEqual(
        s.length,
      );
    }
  });

  it("keeps consecutive grains exactly one cell apart, seam or no seam", () => {
    const s = straddlingSnake();
    const grains = bodyGrains(render(s, 1));

    for (let i = 1; i < s.length; i++) {
      const a = copiesAt(grains, segmentAt(s, i - 1));
      const b = copiesAt(grains, segmentAt(s, i));
      expect(a.length, `segment ${i - 1} was not drawn`).toBeGreaterThan(0);
      expect(b.length, `segment ${i} was not drawn`).toBeGreaterThan(0);

      let best = Infinity;
      let bestPair: [Drawn, Drawn] | null = null;
      for (const g of a) {
        for (const h of b) {
          const d = Math.hypot(h.x - g.x, h.y - g.y);
          if (d < best) {
            best = d;
            bestPair = [g, h];
          }
        }
      }
      expect(best, `segments ${i - 1}→${i} are not one cell apart`).toBeCloseTo(PX, 5);
      const [g, h] = bestPair!;
      expect(g.rx + h.rx, `segments ${i - 1}→${i} leave a gap at the seam`).toBeGreaterThan(best);
    }
  });

  it("overlaps at the seam by the same amount it does mid-board", () => {
    // The comparison that makes the number mean something: the same two ring slots,
    // hence the same jitter, measured in both places.
    const seam = straddlingSnake();
    const mid = stateWithBody(
      [10 + 5 * COLS, 11 + 5 * COLS, 12 + 5 * COLS, 13 + 5 * COLS],
      LEFT,
    );

    const overlapOf = (s: GameState): number[] => {
      const grains = bodyGrains(render(s, 1));
      const out: number[] = [];
      for (let i = 1; i < s.length; i++) {
        const a = copiesAt(grains, segmentAt(s, i - 1));
        const b = copiesAt(grains, segmentAt(s, i));
        let best = Infinity;
        let sum = 0;
        for (const g of a)
          for (const h of b) {
            const d = Math.hypot(h.x - g.x, h.y - g.y);
            if (d < best) {
              best = d;
              sum = g.rx + h.rx;
            }
          }
        out.push(sum - best);
      }
      return out;
    };

    const atSeam = overlapOf(seam);
    const atMid = overlapOf(mid);
    expect(atSeam.length).toBe(atMid.length);
    for (let i = 0; i < atSeam.length; i++) {
      expect(atSeam[i], `pair ${i}: seam overlap differs from mid-board`).toBeCloseTo(atMid[i], 5);
      expect(atSeam[i], `pair ${i}: rims do not merge`).toBeGreaterThan(0);
    }
  });

  it("the head does not spin 180° when it crosses a seam", () => {
    // Raw column subtraction across a seam gives -22, and `atan2` turns that into a
    // head pointing back the way it came for one step per crossing.
    const s = straddlingSnake();
    const grains = bodyGrains(render(s, 1));
    const headDraw = grains.at(-1)!;
    // Travelling LEFT: the head's long axis points along ±x, i.e. angle ≈ 0 or π. The
    // failure is a 180° flip, so compare against the mid-board control's angle.
    const mid = stateWithBody([10 + 5 * COLS, 11 + 5 * COLS, 12 + 5 * COLS, 13 + 5 * COLS], LEFT);
    const midHead = bodyGrains(render(mid, 1)).at(-1)!;
    const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    expect(norm(headDraw.rotation)).toBeCloseTo(norm(midHead.rotation), 5);
  });
});

describe("jitter is stable — the trail does not shimmer", () => {
  it("gives a grain the same silhouette on every frame of a step", () => {
    const s = movedSnake();
    const a = bodyGrains(render(s, 0.1)).map((g) => g.rx);
    const b = bodyGrains(render(s, 0.9)).map((g) => g.rx);
    expect(a).toEqual(b);
  });

  it("gives a grain the same silhouette ACROSS steps — keyed on the ring, not the index", () => {
    // The failure this catches: jitter keyed on distance-from-head changes for every
    // grain on every step, and the whole trail crawls. Keyed on the ring slot, a grain
    // keeps one silhouette from the moment it is eaten to the moment it is dropped.
    //
    // Needs a snake long enough to have a middle: at the starting length of 3 there is
    // no segment far enough from either end for "one step older" to be meaningful.
    const s = createGame(162);
    feed(s, 8);
    expectCouldHaveDied(s, "the jitter fixture");
    expect(s.dead).toBe(false);

    // `bodyGrains` is drawn tail-first, so index (n-1-k) is the grain k back from the
    // head. Track one specific grain as it ages by one step.
    const before = bodyGrains(render(s, 1));
    const target = before[before.length - 1 - 2];

    stepOneCell(s, null);
    const after = bodyGrains(render(s, 1));
    expect(after.length).toBeGreaterThanOrEqual(4);
    const moved = after[after.length - 1 - 3];

    expect(moved, "the snake was too short to age a segment").toBeDefined();
    expect(moved.rx, "a segment's long axis changed as it aged").toBeCloseTo(target.rx, 9);
  });
});
