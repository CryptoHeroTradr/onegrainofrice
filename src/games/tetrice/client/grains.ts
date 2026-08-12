/**
 * TETRICE — the grain painter. THE decided render rules, in one place.
 *
 * Everything here was settled in `docs/tetrice-spec.md` (*The pieces*) and measured in the
 * Phase 1 gate. It is implemented, not re-derived:
 *
 *  - seven `@theme` tokens, one per shape;
 *  - a three-way CATEGORICAL grain long-axis code, FIXED IN SCREEN SPACE — it does not
 *    rotate with the piece, because an axis that rotated would stop being an identity cue
 *    and become a rotation indicator the silhouette already provides;
 *  - a cell is four grains in a loose 2x2, not a tile;
 *  - per-grain value variation around the piece's hue, value only, never a hue shift;
 *  - jitter keyed on `(pieceInstanceId, cellIndex, grainIndex)` — NOT world position and
 *    NOT index-from-spawn, so a piece that moves, rotates, is held, or locks re-rolls
 *    nothing, and the key is carried into the locked board cell.
 *
 * No DOM lookups beyond the palette read, no React, no engine rules.
 */

import { AXIS, TOKEN, VALUE_SPREAD, SHAPES, cellsOf, type Axis, type Shape } from "../engine/rules";

export type Palette = Record<Shape, string>;

const FALLBACK: Palette = {
  I: "#2a4d8f",
  J: "#474d2e",
  L: "#c4b370",
  S: "#4e7a3e",
  Z: "#c1443a",
  T: "#f4a08a",
  O: "#6a6c3a",
};

/** Sample the seven chromatic @theme tokens off the live document. */
export function readPalette(root: HTMLElement): Palette {
  const cs = getComputedStyle(root);
  const out = {} as Palette;
  for (const s of SHAPES) out[s] = cs.getPropertyValue(TOKEN[s]).trim() || FALLBACK[s];
  return out;
}

/** Canvas radians: y is down, so ↗ is a negative rotation and ↘ a positive one. */
const AXIS_RAD: Record<Axis, number> = {
  horizontal: 0,
  vertical: Math.PI / 2,
  diagNE: -Math.PI / 4,
  diagSE: Math.PI / 4,
};

// ─── FUSION ──────────────────────────────────────────────────────────────────
//
// THE ONE OPEN RENDER DECISION, and the reason this file has a mode switch.
//
// Phase 1 measured that fusion is ANISOTROPIC: a cluster reaches ~10% past the cell
// boundary along the grain's own axis and falls ~8% short across it. Horizontal-axis
// shapes therefore fuse into bars with a channel between grain rows, vertical ones read as
// strands, and only the three diagonals satisfy "one fused shape" — because a 45° grain
// projects almost equally onto both screen axes and is isotropic by accident.
//
// The spec's constraint is that fusion must be AXIS-INDEPENDENT, and it names two
// candidates. Both are implemented so the choice is made by looking at them side by side
// in `/dev/tetrice-gate`, with the ghost piece already built — because the cost they share
// is overspill blurring the piece's outer edge, and that trades against the ghost read and
// the empty-cell read, neither of which can be judged from a still of a single piece.
export type FusionMode =
  /** Phase 1's behaviour, kept so the gate can show a real before. */
  | "anisotropic"
  /** Candidate 1: the cluster is built in the AXIS frame with equal reach on both axes. */
  | "crossAxis"
  /** Candidate 2: original grain shape; alternate cells offset so channels cannot line up. */
  | "brick";

interface Geometry {
  /** Grain radii, in cell units: along its own long axis, and across it. */
  ru: number;
  rv: number;
  /** Cluster offsets from the cell centre: along the grain axis, and across it. */
  ou: number;
  ov: number;
}

const GEOMETRY: Record<FusionMode, Geometry> = {
  // reach along = 0.25 + 0.30 = 0.55 (10% over the boundary)
  // reach across = 0.25 + 0.165 = 0.415 (8.5% short of it)  ← the channel
  anisotropic: { ru: 0.3, rv: 0.165, ou: 0.25, ov: 0.25 },
  // Equal reach both ways: 0.24 + 0.32 = 0.56 along, 0.26 + 0.24 = 0.50 across. Costs
  // grain shape — 0.32 x 0.24 is a 1.33:1 oval where the original was 1.8:1.
  crossAxis: { ru: 0.32, rv: 0.24, ou: 0.24, ov: 0.26 },
  // Original 1.8:1 grain, unchanged reach. The channel is not closed; its ALIGNMENT is
  // broken, per-cell, by the phase term below.
  brick: { ru: 0.3, rv: 0.175, ou: 0.25, ov: 0.235 },
};

/**
 * Brick phase: alternate cells of the same piece shift along the grain axis by a quarter
 * pitch, so the gaps between grain rows in neighbouring cells cannot line up into one
 * continuous channel.
 *
 * KEYED ON `cellIndex`, NOT ON BOARD POSITION. A phase keyed on the board row would shift
 * every cell of the piece on every row of gravity — a visible twitch once per fall step,
 * and exactly the world-position dependence the jitter key exists to avoid.
 */
const BRICK_PHASE = 0.12;

function brickPhase(mode: FusionMode, cellIndex: number): number {
  return mode === "brick" ? (cellIndex % 2 === 0 ? BRICK_PHASE : -BRICK_PHASE) : 0;
}

const JITTER_POS = 0.055;
/** Small on purpose: the axis is a CATEGORICAL code and wobble approaching the 45° gap
 *  between categories would be destroying the thing it encodes. */
const JITTER_ANGLE = (5 * Math.PI) / 180;

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

function toMono(r: number, g: number, b: number): [number, number, number] {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [y, y, y];
}

function grainFill(base: string, value: number, mono: boolean, alpha: number): string {
  const [r0, g0, b0] = parseHex(base);
  let r = r0 * value;
  let g = g0 * value;
  let b = b0 * value;
  if (mono) [r, g, b] = toMono(r, g, b);
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return alpha >= 1
    ? `rgb(${c(r)}, ${c(g)}, ${c(b)})`
    : `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${alpha})`;
}

// ─── painting ────────────────────────────────────────────────────────────────

export interface CellPaint {
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
  palette: Palette;
  mono?: boolean;
  fusion?: FusionMode;
  /** Whole-piece alpha. The ghost is drawn at a low value with no other change. */
  alpha?: number;
  originX?: number;
  originY?: number;
}

export function paintCell(ctx: CanvasRenderingContext2D, cell: CellPaint, o: PaintOpts): void {
  const c = o.cell;
  const mode = o.fusion ?? "brick";
  const g = GEOMETRY[mode];
  const alpha = o.alpha ?? 1;
  const ox = (o.originX ?? 0) + cell.col * c;
  const oy = (o.originY ?? 0) + cell.row * c;
  const angle = AXIS_RAD[AXIS[cell.shape]];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const phase = brickPhase(mode, cell.cellIndex);
  const base = o.palette[cell.shape];

  for (let i = 0; i < 4; i++) {
    const rand = streamFrom(hash32(`${cell.pieceInstanceId}:${cell.cellIndex}:${i}`));
    const ju = (rand() * 2 - 1) * JITTER_POS;
    const jv = (rand() * 2 - 1) * JITTER_POS;
    const ja = (rand() * 2 - 1) * JITTER_ANGLE;
    const value = 1 + (rand() * 2 - 1) * VALUE_SPREAD;

    // The cluster is laid out in the AXIS frame — u along the grain, v across it — and
    // then rotated into screen space. Building it here rather than in screen space is what
    // makes "reach along" and "reach across" mean the same thing for all four angles,
    // which is the whole point of an axis-independent fusion rule.
    const u = (i % 2 === 0 ? -g.ou : g.ou) + phase + ju;
    const v = (i < 2 ? -g.ov : g.ov) + jv;
    const dx = u * cos - v * sin;
    const dy = u * sin + v * cos;

    ctx.save();
    ctx.translate(ox + c / 2 + dx * c, oy + c / 2 + dy * c);
    ctx.rotate(angle + ja);
    ctx.fillStyle = grainFill(base, value, o.mono ?? false, alpha);
    ctx.beginPath();
    ctx.ellipse(0, 0, g.ru * c, g.rv * c, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
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
 * The ghost: the same shape at its landing position, low alpha, and **no accent grains** —
 * no highlight, no rim, no second treatment. It is the piece's own silhouette shown faint,
 * so that comparing it against the skyline is a comparison of the same shape rather than
 * of two different drawings.
 */
export const GHOST_ALPHA = 0.22;

export function paintGhost(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rot: number,
  at: { col: number; row: number },
  pieceInstanceId: number | string,
  o: PaintOpts,
): void {
  paintPiece(ctx, shape, rot, at, pieceInstanceId, { ...o, alpha: GHOST_ALPHA });
}
