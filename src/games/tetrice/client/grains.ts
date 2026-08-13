/**
 * TETRICE — the grain painter. THE decided render rules, in one place.
 *
 * ── THE REFERENCE ART IS THE AUTHORITY, AND IT IS MONOCHROME ────────────────────────
 * *Rewritten 2026-08-13, after the on-phone check failed. It replaces a seven-hue palette,
 * a three-way grain-axis code and a four-grain cluster; `docs/tetrice-spec.md` carries the
 * superseding notes.*
 *
 * Everything here now derives from one decision: **the pieces are rice, and rice is white
 * and tan.** Piece identity comes from the SILHOUETTE, exactly as it does in the game this
 * is modelled on. Colour was never carrying it — the previous design spent two channels
 * (hue and grain angle) telling the player something the outline already told them, and
 * paid for it in legibility on a real phone.
 *
 * What that buys, stated so nobody re-derives the old design:
 *
 *  - **No per-shape hue.** One rice palette, deterministic value/tint variation per grain.
 *  - **One orientation for every grain.** Horizontal, as in the reference. The old
 *    diagonal classes read on glass as a diagonal SHAPE, which fought the silhouette they
 *    were supposed to support.
 *  - **Tight packing.** A cell is a small brick field of grains, sized so a filled region
 *    shows no background between cells. `test/tetrice-packing.test.ts` measures that at
 *    the three cell sizes this game actually renders at.
 *  - **The falling piece separates from the stack by VALUE, not hue** — brighter, with a
 *    glow. That is what the reference does and it is the only separation channel left.
 *
 * Jitter is still keyed on `(pieceInstanceId, cellIndex, grainIndex)` — NOT world position
 * and NOT index-from-spawn — so a piece that moves, rotates, is held or locks re-rolls
 * nothing, and the key is carried into the locked board cell.
 *
 * No DOM lookups beyond the palette read, no React, no engine rules. Nothing in this file
 * can change a run: it is downstream of `step()` and reads no state the engine writes.
 */

import { cellsOf, type Shape } from "../engine/rules";

// ─── the palette ─────────────────────────────────────────────────────────────
//
// FOUR TINTS, WHITE THROUGH TAN, AND NO HUE PER SHAPE. Every one is an existing site
// token, so the well is lit by the same rice this site is made of rather than by a second
// palette invented for one page. The ramp is ordered — index 0 is the brightest grain in
// the bowl, index 3 the most toasted — and `tintOf` picks along it deterministically.

/** The rice ramp, brightest first. Site tokens: bone, paper, paper-dark, khaki. */
export const RICE_TINTS = ["#f4efe2", "#eae3d2", "#d9cfb8", "#c4b370"] as const;

/**
 * How often a grain is drawn from the toasted end of the ramp.
 *
 * The reference is mostly pale rice with a scattering of tan — not an even mix. A uniform
 * draw over four tints reads as beige noise; this weights the two pale tints to ~72% of
 * grains, which is roughly what the reference shows.
 */
const TINT_WEIGHTS = [0.42, 0.3, 0.18, 0.1] as const;

/**
 * Per-grain value variation, multiplicative, around the chosen tint.
 *
 * *Was `VALUE_SPREAD` in `engine/rules.ts`, moved here 2026-08-13.* It lived there because
 * the palette test needed a home for it that outlived the gate page; that test is gone
 * (it guarded a hue-family guarantee that no longer exists), and a render constant in a
 * file whose header says "changing a constant here bumps ENGINE_VERSION" was always an
 * invitation to a wrong inference. It is render-only and it is here now.
 */
const VALUE_SPREAD = 0.1;

/** Kept as a type alias so callers that spoke `Palette` still compile; it is now a ramp. */
export type Palette = readonly string[];

/**
 * The palette is a CONSTANT, not a document read.
 *
 * It used to sample seven `@theme` tokens off the live root. There is nothing per-shape to
 * sample any more, and the four tints are fixed values rather than themeable ones — a
 * `getComputedStyle` call per mount to fetch four constants would be a DOM dependency
 * bought for nothing. The argument passed by callers is preserved so the render path can
 * still be handed a different ramp in a test.
 */
export function readPalette(): Palette {
  return RICE_TINTS;
}

// ─── layers ──────────────────────────────────────────────────────────────────

/**
 * WHAT COLOUR USED TO DO, VALUE DOES NOW.
 *
 * With hue gone, the one distinction the player must never lose is **which piece is still
 * theirs to move**. In the reference the falling piece is bright and haloed and the
 * settled stack is duller; that is the mechanism, and it is a stronger one than hue was,
 * because it separates the two things a player actually has to tell apart rather than
 * seven things they do not.
 */
export type Layer = "active" | "locked" | "ghost" | "preview";

interface LayerStyle {
  /** Multiplies the grain's value. */
  value: number;
  /** Canvas `shadowBlur`, in cell units, for the halo. 0 disables the shadow entirely. */
  glow: number;
  alpha: number;
}

/** The ghost is the piece's own silhouette shown faint — no second treatment. */
export const GHOST_ALPHA = 0.22;

const LAYERS: Record<Layer, LayerStyle> = {
  // Bright and haloed. The glow is deliberately soft and warm rather than a rim: a rim
  // would draw an outline the silhouette already draws, and two outlines a pixel apart is
  // how a shape reads as blurred.
  active: { value: 1.12, glow: 0.5, alpha: 1 },
  // Duller, and this is the whole of the stack's treatment. It must stay high enough to
  // read as rice rather than as a grey wall — the stack is most of the screen.
  locked: { value: 0.78, glow: 0, alpha: 1 },
  ghost: { value: 0.9, glow: 0, alpha: GHOST_ALPHA },
  // NEXT and hold render at their own cell size on a panel, away from the stack, so they
  // take the plain treatment rather than the active one.
  preview: { value: 1, glow: 0, alpha: 1 },
};

// ─── the lattice ─────────────────────────────────────────────────────────────
//
// ── PACKING IS THE THING THAT FAILED ON GLASS, AND IT IS MEASURED NOW ───────────────
// At 33 device px the old four-grain cluster read as four separate beads with the board
// showing through between them, so a cell did not read as a block and a piece did not read
// as one shape. The fix is more grains, larger relative to the cell, overlapping in both
// axes — a brick field rather than a 2x2 of dots.
//
// Every number below is checked by `test/tetrice-packing.test.ts`, which samples a filled
// 4x4 region at 15, 33 and 70 px and asserts NO sample lands on background. That test is
// the reason these are constants rather than adjustments: they are not taste, they are the
// smallest values that pass a coverage measurement.

/** Grains across a cell, and grain rows down it. 2 x 4 = 8 per cell (was 4). */
export const GRAIN_COLS = 2;
export const GRAIN_ROWS = 4;

/**
 * Grain half-axes in CELL UNITS. 0.33 x 0.20 is a 1.65:1 oval lying flat — the reference's
 * proportion, near enough, and wide enough that two of them across a cell overlap each
 * other AND spill past both cell edges.
 *
 * The spill is what fuses neighbouring cells: reach is `0.25 + 0.33 = 0.58`, so a grain
 * crosses the boundary by 0.08 of a cell and meets its neighbour's.
 */
const GRAIN_RX = 0.33;
const GRAIN_RY = 0.2;

/**
 * ── THE BRICK OFFSET SURVIVED, AND IT IS NOW ROW-TO-ROW RATHER THAN CELL-TO-CELL ────
 * *Re-derived 2026-08-13. It used to alternate whole CELLS to stop grain-row channels
 * lining up across a piece; that problem was an artefact of the sparse cluster and is gone
 * with it.*
 *
 * What replaces it is ordinary brickwork: alternate grain ROWS shift half a column pitch,
 * so a row's grain sits over the seam between the two below it. It is kept because it is
 * load-bearing — with it, 8 grains per cell cover the region at all three sizes; without
 * it, the four-way gaps between ellipse centres survive and the coverage test fails at
 * 70 px. The measurement is in `test/tetrice-packing.test.ts`, which asserts BOTH — that
 * the shipped lattice covers, and that the same lattice with the offset removed does not.
 *
 * Half the column pitch, and the pitch is `1 / GRAIN_COLS`.
 */
const BRICK_OFFSET = 0.5 / GRAIN_COLS;

/** Jitter, in cell units. Small: this is a woven field, not a spill of loose grains. */
const JITTER_POS = 0.028;
/** A few degrees of wobble. The grains all LIE the same way; they are not machined. */
const JITTER_ANGLE = (6 * Math.PI) / 180;

// ─── deterministic noise ─────────────────────────────────────────────────────

function hash32(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function streamFrom(seed: number): () => number {
  let s = seed || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** Pick a tint from the weighted ramp. Falls through to the last entry on a short ramp. */
function tintOf(ramp: Palette, r: number): string {
  let acc = 0;
  for (let i = 0; i < ramp.length; i++) {
    acc += TINT_WEIGHTS[i] ?? 0;
    if (r < acc) return ramp[i];
  }
  return ramp[ramp.length - 1];
}

// ─── colour ──────────────────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function grainFill(base: string, value: number, alpha: number): string {
  const [r0, g0, b0] = parseHex(base);
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n * value)));
  const [r, g, b] = [c(r0), c(g0), c(b0)];
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── painting ────────────────────────────────────────────────────────────────

export interface CellPaint {
  /** Kept for the caller's convenience and for preview layout; NOTHING reads it for
   *  colour or angle any more. A cell of an S looks exactly like a cell of an O. */
  shape: Shape;
  /** Stable for the whole life of the piece, including after it locks. */
  pieceInstanceId: number | string;
  /** Index of the cell WITHIN the piece. Not a world position. */
  cellIndex: number;
  col: number;
  row: number;
}

export interface PaintOpts {
  cell: number;
  palette?: Palette;
  layer?: Layer;
  /** Overrides the layer's alpha. */
  alpha?: number;
  originX?: number;
  originY?: number;
}

/** One grain, in device pixels, ready to draw or to measure. */
export interface Grain {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Radians. Near zero — every grain lies the same way. */
  angle: number;
  fill: string;
}

/**
 * The lattice, as data.
 *
 * `paintCell` draws exactly what this returns and the packing test measures exactly what
 * this returns, so there is ONE description of where a grain goes. A test that recomputed
 * the layout would be a second implementation agreeing with its own arithmetic.
 */
export function grainsOfCell(cell: CellPaint, o: PaintOpts): Grain[] {
  const c = o.cell;
  const ramp = o.palette ?? RICE_TINTS;
  const style = LAYERS[o.layer ?? "locked"];
  const alpha = o.alpha ?? style.alpha;
  const ox = (o.originX ?? 0) + cell.col * c;
  const oy = (o.originY ?? 0) + cell.row * c;

  const out: Grain[] = [];
  for (let row = 0; row < GRAIN_ROWS; row++) {
    for (let col = 0; col < GRAIN_COLS; col++) {
      const i = row * GRAIN_COLS + col;
      const rand = streamFrom(hash32(`${cell.pieceInstanceId}:${cell.cellIndex}:${i}`));
      const jx = (rand() * 2 - 1) * JITTER_POS;
      const jy = (rand() * 2 - 1) * JITTER_POS;
      const ja = (rand() * 2 - 1) * JITTER_ANGLE;
      const tint = tintOf(ramp, rand());
      const value = style.value * (1 + (rand() * 2 - 1) * VALUE_SPREAD);

      // Centres on a regular grid spanning the cell, alternate rows shifted half a pitch.
      // `(col + 0.5) / GRAIN_COLS - 0.5` puts the columns symmetrically about the centre.
      const brick = row % 2 === 1 ? BRICK_OFFSET : 0;
      const u = (col + 0.5) / GRAIN_COLS - 0.5 + brick + jx;
      const v = (row + 0.5) / GRAIN_ROWS - 0.5 + jy;

      out.push({
        cx: ox + c / 2 + u * c,
        cy: oy + c / 2 + v * c,
        rx: GRAIN_RX * c,
        ry: GRAIN_RY * c,
        angle: ja,
        fill: grainFill(tint, value, alpha),
      });
    }
  }
  return out;
}

export function paintCell(ctx: CanvasRenderingContext2D, cell: CellPaint, o: PaintOpts): void {
  const style = LAYERS[o.layer ?? "locked"];
  const grains = grainsOfCell(cell, o);

  // The halo is drawn ONCE for the cell, as a shadow under the grains, rather than per
  // grain: eight overlapping shadows stack into a bright blob that swallows the shape.
  if (style.glow > 0) {
    ctx.save();
    ctx.shadowColor = "rgba(248, 240, 214, 0.75)";
    ctx.shadowBlur = style.glow * o.cell;
  }

  for (const g of grains) {
    ctx.save();
    ctx.translate(g.cx, g.cy);
    if (g.angle !== 0) ctx.rotate(g.angle);
    ctx.fillStyle = g.fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, g.rx, g.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (style.glow > 0) ctx.restore();
}

export function paintPiece(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rot: number,
  at: { col: number; row: number },
  pieceInstanceId: number | string,
  o: PaintOpts,
): void {
  cellsOf(shape, rot).forEach(([x, y], cellIndex) => {
    paintCell(ctx, { shape, pieceInstanceId, cellIndex, col: at.col + x, row: at.row + y }, o);
  });
}

/**
 * The ghost: the same shape at its landing position, low alpha, and no other change. It is
 * the piece's own silhouette shown faint, so comparing it against the skyline is a
 * comparison of the same shape rather than of two different drawings.
 */
export function paintGhost(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rot: number,
  at: { col: number; row: number },
  pieceInstanceId: number | string,
  o: PaintOpts,
): void {
  paintPiece(ctx, shape, rot, at, pieceInstanceId, { ...o, layer: "ghost" });
}
