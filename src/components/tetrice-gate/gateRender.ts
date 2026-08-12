/**
 * TETRICE — palette + grain-axis GATE renderer. THROWAWAY.
 *
 * This module exists to FALSIFY two decisions in `docs/tetrice-spec.md` (*The pieces*):
 * the seven-token hue mapping, and the three-way categorical grain long-axis code that is
 * meant to carry identity where hue collides. It implements exactly what that section
 * says. It is not an exploration and it is not engine code — nothing here is imported by
 * anything that ships, and Phase 2 deletes it.
 *
 * If something in here looks wrong, the finding belongs in the spec, not in a quiet local
 * improvement to this file.
 */

export type Shape = "I" | "J" | "L" | "S" | "Z" | "T" | "O";
export const SHAPES: readonly Shape[] = ["I", "J", "L", "S", "Z", "T", "O"];

/** Spec table: one @theme token per shape. Read from the live CSS custom properties at
 *  runtime (see `readPalette`) — these are the documented fallbacks, not a second source. */
export const TOKEN: Record<Shape, string> = {
  I: "--color-porcelain",
  J: "--color-olive-deep",
  L: "--color-khaki",
  S: "--color-bamboo",
  Z: "--color-tuna",
  T: "--color-salmon",
  O: "--color-olive",
};

const FALLBACK: Record<Shape, string> = {
  I: "#2a4d8f",
  J: "#474d2e",
  L: "#c4b370",
  S: "#4e7a3e",
  Z: "#c1443a",
  T: "#f4a08a",
  O: "#6a6c3a",
};

/** Spec table: the three-way categorical axis code, in screen space. */
export type Axis = "horizontal" | "vertical" | "diagNE" | "diagSE";
export const AXIS: Record<Shape, Axis> = {
  I: "horizontal",
  J: "vertical",
  S: "diagNE", // ↗
  O: "horizontal",
  L: "diagSE", // ↘
  Z: "diagSE", // ↘
  T: "vertical",
};

/** Canvas radians. y is down, so ↗ is a negative rotation and ↘ a positive one. */
const AXIS_RAD: Record<Axis, number> = {
  horizontal: 0,
  vertical: Math.PI / 2,
  diagNE: -Math.PI / 4,
  diagSE: Math.PI / 4,
};

/** Hue family, for the gate's own labelling only. */
export const FAMILY: Record<Shape, string> = {
  I: "blue",
  J: "green",
  L: "tan",
  S: "green",
  Z: "red",
  T: "red",
  O: "green",
};

// --- shapes -----------------------------------------------------------------
//
// Canonical cells in a bounding box, in a FIXED ORDER. The order is the cell's identity:
// rotation transforms coordinates and leaves the index alone, which is what lets the
// jitter key `(pieceInstanceId, cellIndex)` survive rotation unchanged, per the spec.

interface ShapeDef {
  box: number;
  cells: ReadonlyArray<readonly [number, number]>;
  rotates: boolean;
}

export const SHAPE_DEF: Record<Shape, ShapeDef> = {
  I: { box: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]], rotates: true },
  J: { box: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]], rotates: true },
  L: { box: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]], rotates: true },
  S: { box: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]], rotates: true },
  Z: { box: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]], rotates: true },
  T: { box: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]], rotates: true },
  O: { box: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]], rotates: false },
};

/** Cells of `shape` in rotation state `rot` (0..3), index-stable. O ignores rot. */
export function cellsOf(shape: Shape, rot: number): Array<readonly [number, number]> {
  const def = SHAPE_DEF[shape];
  const turns = def.rotates ? ((rot % 4) + 4) % 4 : 0;
  return def.cells.map(([x, y]) => {
    let cx = x;
    let cy = y;
    for (let t = 0; t < turns; t++) {
      const nx = def.box - 1 - cy;
      const ny = cx;
      cx = nx;
      cy = ny;
    }
    return [cx, cy] as const;
  });
}

// --- deterministic noise ----------------------------------------------------

/** FNV-1a over the key string. The key is the contract: piece instance + cell + grain. */
function hash32(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** xorshift32, so one key yields a short deterministic stream. */
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

// --- colour -----------------------------------------------------------------

export type Palette = Record<Shape, string>;

/** Sample the seven chromatic @theme tokens off the live document. */
export function readPalette(root: HTMLElement): Palette {
  const cs = getComputedStyle(root);
  const out = {} as Palette;
  for (const s of SHAPES) {
    const v = cs.getPropertyValue(TOKEN[s]).trim();
    out[s] = v || FALLBACK[s];
  }
  return out;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Per-grain value variation around the piece's hue — the white/tan variation from the
 * mood board. VALUE ONLY: the channels are scaled together, so nothing shifts hue.
 * ±14% is the cap; wider than that and it reads as a second colour, which the spec
 * forbids.
 */
export const VALUE_SPREAD = 0.14;

/** Rec.709 luminance. The greyscale pass is a real render, not a filter over the output. */
function toMono(r: number, g: number, b: number): [number, number, number] {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [y, y, y];
}

function grainFill(base: string, value: number, mono: boolean): string {
  const [r0, g0, b0] = parseHex(base);
  let r = r0 * value;
  let g = g0 * value;
  let b = b0 * value;
  if (mono) [r, g, b] = toMono(r, g, b);
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

// --- grains -----------------------------------------------------------------

/**
 * Geometry, in units of the cell size.
 *
 * The 2x2 cluster is loose: four grains at the quarter points. The grain's long radius is
 * larger than a quarter-cell on purpose — the cluster spills ~8% past the cell boundary so
 * that two cells of the same piece MERGE at their shared edge and the piece reads as one
 * fused shape rather than four beads (spec: *grains overlap slightly along shared cell
 * edges*).
 */
const GRAIN_LONG = 0.30;
const GRAIN_SHORT = 0.165;
const CLUSTER_OFFSET = 0.25;
const JITTER_POS = 0.055;
/** Angle jitter is deliberately small. The axis is a CATEGORICAL code; wobble that
 *  approaches the 45° gap between categories would be destroying the thing under test. */
const JITTER_ANGLE = (5 * Math.PI) / 180;

export interface CellPaint {
  shape: Shape;
  /** Survives movement and rotation, and is carried into the locked board cell. */
  pieceInstanceId: string;
  /** Index of the cell WITHIN the piece — not a world position, not an index from spawn. */
  cellIndex: number;
  /** Where to paint it, in cells. */
  col: number;
  row: number;
}

export interface PaintOpts {
  cell: number;
  palette: Palette;
  mono: boolean;
  originX?: number;
  originY?: number;
}

/** Paint one cell: four grains in a loose 2x2, on this shape's fixed screen-space axis. */
export function paintCell(
  ctx: CanvasRenderingContext2D,
  cell: CellPaint,
  o: PaintOpts,
): void {
  const c = o.cell;
  const ox = (o.originX ?? 0) + cell.col * c;
  const oy = (o.originY ?? 0) + cell.row * c;
  const base = o.palette[cell.shape];
  const angle = AXIS_RAD[AXIS[cell.shape]];

  for (let g = 0; g < 4; g++) {
    // THE KEY. Piece instance + cell index + grain index. No world position, no index
    // from spawn — so a piece that moves, rotates or locks re-rolls nothing.
    const rand = streamFrom(hash32(`${cell.pieceInstanceId}:${cell.cellIndex}:${g}`));
    const jx = (rand() * 2 - 1) * JITTER_POS * c;
    const jy = (rand() * 2 - 1) * JITTER_POS * c;
    const ja = (rand() * 2 - 1) * JITTER_ANGLE;
    const value = 1 + (rand() * 2 - 1) * VALUE_SPREAD;

    const qx = g % 2 === 0 ? -CLUSTER_OFFSET : CLUSTER_OFFSET;
    const qy = g < 2 ? -CLUSTER_OFFSET : CLUSTER_OFFSET;

    ctx.save();
    ctx.translate(ox + c / 2 + qx * c + jx, oy + c / 2 + qy * c + jy);
    ctx.rotate(angle + ja);
    ctx.fillStyle = grainFill(base, value, o.mono);
    ctx.beginPath();
    ctx.ellipse(0, 0, GRAIN_LONG * c, GRAIN_SHORT * c, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// --- field ------------------------------------------------------------------

export const FIELD = "#0a0805";
/** The faint gold grid. Khaki, low alpha — the spec's "black field with the faint gold grid". */
export const GRID = "rgba(196, 179, 112, 0.13)";

export function paintField(
  ctx: CanvasRenderingContext2D,
  wCells: number,
  hCells: number,
  o: { cell: number; grid: boolean; originX?: number; originY?: number },
): void {
  const c = o.cell;
  const ox = o.originX ?? 0;
  const oy = o.originY ?? 0;
  ctx.fillStyle = FIELD;
  ctx.fillRect(ox, oy, wCells * c, hCells * c);
  if (!o.grid) return;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let x = 0; x <= wCells; x++) {
    ctx.beginPath();
    ctx.moveTo(Math.round(ox + x * c) + 0.5, oy);
    ctx.lineTo(Math.round(ox + x * c) + 0.5, oy + hCells * c);
    ctx.stroke();
  }
  for (let y = 0; y <= hCells; y++) {
    ctx.beginPath();
    ctx.moveTo(ox, Math.round(oy + y * c) + 0.5);
    ctx.lineTo(ox + wCells * c, Math.round(oy + y * c) + 0.5);
    ctx.stroke();
  }
}

/** Paint a whole piece at a cell offset. */
export function paintPiece(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  rot: number,
  at: { col: number; row: number },
  pieceInstanceId: string,
  o: PaintOpts,
): void {
  cellsOf(shape, rot).forEach(([x, y], cellIndex) => {
    paintCell(ctx, {
      shape,
      pieceInstanceId,
      cellIndex,
      col: at.col + x,
      row: at.row + y,
    }, o);
  });
}

// --- the stacked-field sample ----------------------------------------------

export type StackCell = CellPaint;

/**
 * A dense 10x6 stack of locked pieces, filled deterministically so the sample is the same
 * on every load. Cells keep the piece instance and cell index they were locked with, which
 * is the spec's "the axis persists into the locked stack".
 */
export function buildStack(cols: number, rows: number, seed: number): StackCell[] {
  const occupied: (StackCell | null)[] = Array.from({ length: cols * rows }, () => null);
  const rand = streamFrom(seed);
  const out: StackCell[] = [];
  let pieceNo = 0;

  const fits = (cells: Array<readonly [number, number]>, cx: number, cy: number) =>
    cells.every(([x, y]) => {
      const px = cx + x;
      const py = cy + y;
      return px >= 0 && px < cols && py >= 0 && py < rows && !occupied[py * cols + px];
    });

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (occupied[row * cols + col]) continue;
      // Try shapes and rotations in a deterministic but varied order.
      const order = [...SHAPES].sort(
        (a, b) => hash32(`${seed}:${row}:${col}:${a}`) - hash32(`${seed}:${row}:${col}:${b}`),
      );
      let placed = false;
      for (const shape of order) {
        for (let rot = 0; rot < 4 && !placed; rot++) {
          const cells = cellsOf(shape, rot);
          // Anchor so this piece covers the cell we are standing on.
          for (const [ax, ay] of cells) {
            const cx = col - ax;
            const cy = row - ay;
            if (!fits(cells, cx, cy)) continue;
            const id = `stack-${pieceNo++}`;
            cells.forEach(([x, y], cellIndex) => {
              const sc: StackCell = {
                shape,
                pieceInstanceId: id,
                cellIndex,
                col: cx + x,
                row: cy + y,
              };
              occupied[(cy + y) * cols + (cx + x)] = sc;
              out.push(sc);
            });
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) {
        // Leave the hole. A real stack has them, and an unfillable cell is not a finding.
        void rand();
      }
    }
  }
  return out;
}
