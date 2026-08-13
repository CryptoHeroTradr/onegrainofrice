/**
 * TETRICE — the well renderer.
 *
 * Canvas, not DOM cells. The visible field is 10 x 20; **the two buffer rows are not
 * rendered** — not dimmed, not faded, not shown. A piece appears at the top edge, which is
 * what a player of this genre expects, and drawing the buffer would show them a piece the
 * rules treat as not yet on the board.
 *
 * Everything cosmetic in here runs OFF the engine's already-computed state. No effect
 * gates, delays or advances the simulation clock: the engine resolves clear, score and
 * spawn on the lock tick with no ARE and no clear delay, and an animation that made the
 * next piece wait would quietly reintroduce one.
 */

import {
  BUFFER_ROWS,
  COLS,
  ROWS,
  SHAPES,
  VISIBLE_ROWS,
  cellsOf,
  type Shape,
} from "../engine/rules";
import { collides, idx, type GameState } from "../engine/state";
import { paintCell, paintGhost, paintPiece, type Palette } from "./grains";

export const FIELD = "#0a0805";
export const GRID = "rgba(196, 179, 112, 0.13)";
export const BORDER = "rgba(196, 179, 112, 0.45)";

// ─── cosmetic effects ────────────────────────────────────────────────────────

const CLEAR_FLASH_MS = 90;
const CLEAR_COLLAPSE_MS = 130;
/** 220 ms total, under the 250 ms budget, and it delays nothing. */
export const CLEAR_TOTAL_MS = CLEAR_FLASH_MS + CLEAR_COLLAPSE_MS;
const TRAIL_MS = 140;

interface ClearFx {
  kind: "clear";
  rows: number[];
  start: number;
}
interface TrailFx {
  kind: "trail";
  colFrom: number;
  colTo: number;
  rowFrom: number;
  rowTo: number;
  start: number;
}
type Fx = ClearFx | TrailFx;

export class Effects {
  private fx: Fx[] = [];

  clear(rows: number[], now: number): void {
    if (rows.length) this.fx.push({ kind: "clear", rows, start: now });
  }

  trail(colFrom: number, colTo: number, rowFrom: number, rowTo: number, now: number): void {
    if (rowTo > rowFrom) this.fx.push({ kind: "trail", colFrom, colTo, rowFrom, rowTo, start: now });
  }

  prune(now: number): void {
    this.fx = this.fx.filter((f) =>
      f.kind === "clear" ? now - f.start < CLEAR_TOTAL_MS : now - f.start < TRAIL_MS,
    );
  }

  /** How far the stack above a clear should still be lifted, in cells. Cosmetic only. */
  collapseLift(now: number): { rows: number[]; lift: number } | null {
    const c = this.fx.find((f): f is ClearFx => f.kind === "clear");
    if (!c) return null;
    const t = now - c.start;
    if (t < CLEAR_FLASH_MS) return { rows: c.rows, lift: c.rows.length };
    const p = Math.min((t - CLEAR_FLASH_MS) / CLEAR_COLLAPSE_MS, 1);
    const eased = 1 - (1 - p) * (1 - p);
    return { rows: c.rows, lift: c.rows.length * (1 - eased) };
  }

  draw(ctx: CanvasRenderingContext2D, now: number, cell: number): void {
    for (const f of this.fx) {
      if (f.kind === "clear") {
        const t = now - f.start;
        if (t > CLEAR_FLASH_MS) continue;
        const a = 0.55 * (1 - t / CLEAR_FLASH_MS);
        ctx.fillStyle = `rgba(244, 239, 226, ${a})`;
        for (const r of f.rows) {
          const y = (r - BUFFER_ROWS) * cell;
          if (y + cell > 0) ctx.fillRect(0, y, COLS * cell, cell);
        }
      } else {
        const t = (now - f.start) / TRAIL_MS;
        if (t >= 1) continue;
        const x0 = f.colFrom * cell;
        const w = (f.colTo - f.colFrom + 1) * cell;
        const y0 = Math.max((f.rowFrom - BUFFER_ROWS) * cell, 0);
        const y1 = (f.rowTo - BUFFER_ROWS + 1) * cell;
        const grad = ctx.createLinearGradient(0, y0, 0, y1);
        const a = 0.30 * (1 - t);
        grad.addColorStop(0, `rgba(244, 239, 226, 0)`);
        grad.addColorStop(1, `rgba(244, 239, 226, ${a})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x0, y0, w, y1 - y0);
      }
    }
  }
}

// ─── the static layer ────────────────────────────────────────────────────────

/** The field and the faint gold grid, painted once and blitted. */
export function paintBackdrop(ctx: CanvasRenderingContext2D, cell: number): void {
  const w = COLS * cell;
  const h = VISIBLE_ROWS * cell;
  ctx.fillStyle = FIELD;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x * cell) + 0.5, 0);
    ctx.lineTo(Math.round(x * cell) + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y <= VISIBLE_ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y * cell) + 0.5);
    ctx.lineTo(w, Math.round(y * cell) + 0.5);
    ctx.stroke();
  }
}

// ─── the well ────────────────────────────────────────────────────────────────

export interface DrawOpts {
  cell: number;
  palette: Palette;
  ghost: boolean;
  effects: Effects;
  now: number;
  /** Accumulator fraction, for interpolating the falling piece. */
  alpha: number;
  /** The state one tick back, so the piece is drawn LAGGING rather than predicted. */
  prev: GameState | null;
}

/** The row the active piece would come to rest on. */
export function landingRow(s: GameState): number | null {
  const p = s.active;
  if (!p) return null;
  let y = p.y;
  while (!collides(s.well, p.shape, p.rot, p.x, y + 1)) y += 1;
  return y;
}

export function drawWell(
  ctx: CanvasRenderingContext2D,
  s: GameState,
  o: DrawOpts,
): void {
  const c = o.cell;
  ctx.clearRect(0, 0, COLS * c, VISIBLE_ROWS * c);
  paintBackdrop(ctx, c);

  const lift = o.effects.collapseLift(o.now);
  const liftRows = lift?.lift ?? 0;
  const liftAbove = lift?.rows.length ? Math.min(...lift.rows) : -1;

  // Locked cells. Each carries the piece instance and cell index it was locked with, so a
  // settled grain is the same grain it was while falling — the jitter key survives the lock.
  for (let row = BUFFER_ROWS; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = idx(col, row);
      const code = s.well[i];
      if (code === 0) continue;
      const shape = SHAPES[code - 1] as Shape;
      // Rows that were above a clear slide down into place; purely a draw offset.
      const dy = liftAbove >= 0 && row < liftAbove ? -liftRows : 0;
      paintCell(
        ctx,
        {
          shape,
          pieceInstanceId: s.wellPiece[i],
          cellIndex: s.wellCellIndex[i],
          col,
          row: row - BUFFER_ROWS + dy,
        },
        // LOCKED: the duller treatment. The stack is most of the screen, and with hue
        // gone this value step is the only thing separating it from the piece in play.
        { cell: c, palette: o.palette, layer: "locked" },
      );
    }
  }

  const p = s.active;
  if (p) {
    if (o.ghost) {
      const gy = landingRow(s);
      if (gy !== null && gy !== p.y) {
        paintGhost(ctx, p.shape, p.rot, { col: p.x, row: gy - BUFFER_ROWS }, p.id, {
          cell: c,
          palette: o.palette,
        });
      }
    }

    // Interpolate toward the CURRENT cell from the PREVIOUS one — lagging, never leading.
    // A predicted position draws the piece inside the stack on the frame before the lock
    // resolves, so the player watches the landing happen after it visibly already had.
    const was = o.prev?.active;
    const fromY = was && was.id === p.id ? was.y : p.y;
    const y = fromY + (p.y - fromY) * o.alpha;
    // ACTIVE: brighter, and haloed. This is what hue used to do — see `grains.ts`,
    // *layers*. Drawn LAST so its glow lies over the stack rather than under it.
    paintPiece(ctx, p.shape, p.rot, { col: p.x, row: y - BUFFER_ROWS }, p.id, {
      cell: c,
      palette: o.palette,
      layer: "active",
    });
  }

  o.effects.draw(ctx, o.now, c);
}

/** A single piece centred in a preview box — NEXT and HOLD. */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  shape: Shape | null,
  boxCells: number,
  o: { cell: number; palette: Palette; id: string },
): void {
  const c = o.cell;
  ctx.clearRect(0, 0, boxCells * c, boxCells * c);
  ctx.fillStyle = FIELD;
  ctx.fillRect(0, 0, boxCells * c, boxCells * c);
  if (!shape) return;
  const cells = cellsOf(shape, 0);
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  const offX = (boxCells - w) / 2 - Math.min(...xs);
  const offY = (boxCells - h) / 2 - Math.min(...ys);
  paintPiece(ctx, shape, 0, { col: offX, row: offY }, o.id, {
    cell: c,
    palette: o.palette,
    layer: "preview",
  });
}
