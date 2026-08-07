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
import { COLS } from "@/lib/grainsnake/rules";
import { createGame, segmentAt } from "@/lib/grainsnake/engine";
import { RIGHT, UP, type GameState } from "@/lib/grainsnake/types";
import { paint } from "@/components/grainsnake/render";
import { feed, stepOneCell } from "./grainsnake-support";

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
