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

/**
 * *Phase 2, 2026-08-13:* the shape table, the token map, the axis code and `VALUE_SPREAD`
 * now live in `src/games/tetrice/engine/rules.ts` and are imported from there. They were
 * defined in this throwaway file first because it was the only thing that existed; the
 * palette suite imported them from here, and that import was a tripwire set to fire when
 * Phase 6 deleted the page. This is the phase that disarms it. **Nothing shape-related is
 * defined in this file any more** — a second copy is a second thing to drift.
 */
export {
  AXIS,
  SHAPES,
  SHAPE_DEF,
  TOKEN,
  VALUE_SPREAD,
  cellsOf,
  type Axis,
  type Shape,
} from "@/games/tetrice/engine/rules";

import { SHAPES, cellsOf, type Shape } from "@/games/tetrice/engine/rules";



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

/**
 * *Phase 3, 2026-08-13:* grain painting is no longer implemented here. It lives in
 * `src/games/tetrice/client/grains.ts` — the renderer the GAME uses — and this page
 * re-exports it. The gate's whole value is that what it shows is what ships; a private
 * copy of the painter would make its fused-read comparison evidence about a different
 * program.
 */
export {
  paintCell,
  paintPiece,
  paintGhost,
  readPalette,
  GHOST_ALPHA,
  type CellPaint,
  type PaintOpts,
  type Palette,
  type FusionMode,
} from "@/games/tetrice/client/grains";

import { type CellPaint } from "@/games/tetrice/client/grains";

/** Local hash, for the stack sample's deterministic shape order only. */
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
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
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
