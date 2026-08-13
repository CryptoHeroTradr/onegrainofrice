/**
 * TETRICE — grain packing. THE MEASUREMENT THE ON-PHONE CHECK TURNED INTO A TEST.
 *
 * *Added 2026-08-13, after a real phone showed cells reading as separate beads at 33 device
 * px with the board visible between them.* The requirement is exact and therefore testable:
 * **a filled region must show no background between cells** at every cell size this game
 * renders at.
 *
 * ── IT MEASURES GEOMETRY, NOT PIXELS, AND THAT IS A CHOICE ──────────────────────────
 * `test/canvas2d-shim.ts` cannot help here: its `ellipse()` is a no-op and it does not
 * implement rotation, so rasterising through it would measure the shim. Instead this
 * samples the region on a sub-pixel grid and asks, for each sample, whether it lies inside
 * at least one grain — a closed-form point-in-rotated-ellipse test. Exact, deterministic,
 * and it needs no canvas at all.
 *
 * It consumes `grainsOfCell()`, which is the SAME function `paintCell()` draws from. There
 * is one description of where a grain goes; a test that recomputed the lattice would be a
 * second implementation agreeing with its own arithmetic.
 *
 * ── THE THREE SIZES ARE THE REAL ONES ───────────────────────────────────────────────
 * 15 px is the measured cell floor (`client/layout.ts`). 33 px is what the phone in the
 * failed check was resolving. 70 px is a desktop well. A packing that covers at one size
 * and not another is the failure mode this is shaped to catch — grain radii scale with the
 * cell, so coverage is scale-invariant in theory and the sampling density is not.
 *
 * ── AND IT CARRIES ITS CONTROL ──────────────────────────────────────────────────────
 * *`CLAUDE.md`: a test that guards a failure must be shown failing when that failure is
 * present.* A coverage test passes trivially if the sampler never finds a gap, so this
 * file also runs the sampler against two lattices that MUST fail it — the old four-grain
 * cluster, and the shipped lattice with the brick offset removed. If either passes, the
 * sampler is broken and the green result above it means nothing.
 */
import { describe, it, expect } from "vitest";
import {
  GRAIN_COLS,
  GRAIN_ROWS,
  grainsOfCell,
  type CellPaint,
  type Grain,
} from "@/games/tetrice/client/grains";

/** The cell sizes this game actually renders at: the floor, a phone, a desktop. */
const SIZES = [15, 33, 70];

/** Samples per cell edge. 24 at a 15px cell is finer than a device pixel. */
const SAMPLES_PER_CELL = 24;

function insideEllipse(g: Grain, x: number, y: number): boolean {
  const dx = x - g.cx;
  const dy = y - g.cy;
  const cos = Math.cos(-g.angle);
  const sin = Math.sin(-g.angle);
  const u = dx * cos - dy * sin;
  const v = dx * sin + dy * cos;
  return (u * u) / (g.rx * g.rx) + (v * v) / (g.ry * g.ry) <= 1;
}

/** A filled 4x4 block, as one piece would never be — which is the point: it is a STACK. */
function filledRegion(cellPx: number, grains: (c: CellPaint) => Grain[]): Grain[] {
  const out: Grain[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      out.push(
        ...grains({
          shape: "O",
          // A DIFFERENT piece id per cell. Adjacent cells in a real stack belong to
          // different pieces, so their jitter is uncorrelated — testing one piece's cells
          // would test a friendlier case than the board ever shows.
          pieceInstanceId: `p${row}-${col}`,
          cellIndex: (row * 4 + col) % 4,
          col,
          row,
        }),
      );
    }
  }
  return out;
}

/**
 * Fraction of sample points inside the region that land on background.
 *
 * The sampled area is the INTERIOR — inset half a cell on every side — because the outer
 * boundary is the silhouette edge, where grains legitimately overhang or fall short. What
 * must not have holes is the seams BETWEEN cells, and every one of those is inside the
 * inset.
 */
function uncovered(cellPx: number, grains: (c: CellPaint) => Grain[]): number {
  const all = filledRegion(cellPx, grains);
  const x0 = 0.5 * cellPx;
  const y0 = 0.5 * cellPx;
  const x1 = 3.5 * cellPx;
  const y1 = 3.5 * cellPx;
  const step = cellPx / SAMPLES_PER_CELL;

  let total = 0;
  let miss = 0;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      total++;
      if (!all.some((g) => insideEllipse(g, x, y))) miss++;
    }
  }
  return miss / total;
}

const shipped = (cellPx: number) => (c: CellPaint) => grainsOfCell(c, { cell: cellPx, layer: "locked" });

describe("a filled region shows no background between cells", () => {
  it.each(SIZES)("covers completely at %i px", (cellPx) => {
    expect(uncovered(cellPx, shipped(cellPx))).toBe(0);
  });

  it("packs 8 grains per cell — more than the cluster it replaced", () => {
    // The old design was a 2x2 of four. Named here because "increase the grain count" is
    // half the fix and it is otherwise invisible in a coverage number.
    expect(GRAIN_COLS * GRAIN_ROWS).toBe(8);
    expect(grainsOfCell({ shape: "O", pieceInstanceId: 1, cellIndex: 0, col: 0, row: 0 }, { cell: 33 }))
      .toHaveLength(8);
  });

  it("lays every grain the same way — no axis code survives", () => {
    // The grain-axis code is deleted; all that remains is a few degrees of wobble. A
    // reintroduced 45 degree class would fail this immediately.
    const grains = grainsOfCell(
      { shape: "S", pieceInstanceId: 7, cellIndex: 2, col: 1, row: 1 },
      { cell: 33 },
    );
    for (const g of grains) expect(Math.abs(g.angle)).toBeLessThan(0.11); // ~6.3 degrees
    // ...and a different shape gets the same treatment, which is the whole point.
    const other = grainsOfCell(
      { shape: "I", pieceInstanceId: 7, cellIndex: 2, col: 1, row: 1 },
      { cell: 33 },
    );
    expect(other.map((g) => [g.cx, g.cy, g.rx, g.ry, g.angle])).toEqual(
      grains.map((g) => [g.cx, g.cy, g.rx, g.ry, g.angle]),
    );
  });
});

describe("the sampler can fail — two lattices it must reject", () => {
  /** THE OLD CLUSTER: four grains in a loose 2x2, the thing the phone showed as beads. */
  function oldCluster(cellPx: number) {
    return (c: CellPaint): Grain[] => {
      const out: Grain[] = [];
      const ox = c.col * cellPx;
      const oy = c.row * cellPx;
      for (let i = 0; i < 4; i++) {
        const u = i % 2 === 0 ? -0.25 : 0.25;
        const v = i < 2 ? -0.235 : 0.235;
        out.push({
          cx: ox + cellPx / 2 + u * cellPx,
          cy: oy + cellPx / 2 + v * cellPx,
          rx: 0.3 * cellPx,
          ry: 0.175 * cellPx,
          angle: 0,
          fill: "#fff",
        });
      }
      return out;
    };
  }

  /** The shipped lattice with the brick offset removed — the "does it still help?" case. */
  function noBrick(cellPx: number) {
    return (c: CellPaint): Grain[] =>
      grainsOfCell(c, { cell: cellPx, layer: "locked" }).map((g, i) => {
        const row = Math.floor(i / GRAIN_COLS);
        // Undo the half-pitch shift the shipped lattice applies to odd rows.
        return row % 2 === 1 ? { ...g, cx: g.cx - (0.5 / GRAIN_COLS) * cellPx } : g;
      });
  }

  it("REJECTS the four-grain cluster this replaced, at every size", () => {
    for (const size of SIZES) {
      expect(uncovered(size, oldCluster(size)), `${size}px`).toBeGreaterThan(0);
    }
  });

  it("REJECTS the same lattice with the brick offset removed — so the offset EARNS its place", () => {
    // This is the evidence for keeping the brick offset rather than an assertion that it
    // is nice. Remove it and the four-way gaps between ellipse centres reopen.
    const failures = SIZES.filter((size) => uncovered(size, noBrick(size)) > 0);
    expect(failures.length).toBeGreaterThan(0);
  });
});
