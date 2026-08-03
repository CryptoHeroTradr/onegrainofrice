/**
 * RICE CHOMP — painting. Canvas only; no React, no game rules.
 *
 * Everything is drawn procedurally, the way src/components/grains/riceBowlEngine.ts
 * does it — no sprite sheets, no image loads, nothing to 404. It also borrows that
 * file's core performance trick: anything static is painted ONCE onto an offscreen
 * canvas and blitted per frame, so a 60fps loop only ever redraws what moves.
 *
 * Layers, back to front:
 *   1. walls        baked once per size change
 *   2. grains       baked once, then individual tiles punched out as they are eaten
 *   3. golden grains + player   redrawn every frame
 *
 * Colours are the site's own @theme tokens (src/app/globals.css) as literals, matching
 * the precedent in riceBowlEngine.ts and GrainCatch.tsx. No new palette.
 */

import { COLS, ROWS, tileAt } from "./maze";
import { DOWN, GRAIN, LEFT, POWER, RIGHT, SUB, UP, type Dir } from "./types";
import type { Player } from "./game";

const WALL_FILL = "#2a4d8f"; // porcelain
const WALL_EDGE = "#4571c4"; // porcelain, lifted
const GRAIN_FILL = "#c4b370"; // khaki
const POWER_FILL = "#fbf7ee"; // steamed
const PLAYER_FILL = "#fbf7ee"; // steamed
const PLAYER_RIM = "#c4b370"; // khaki
const PLAYER_EYE = "#14110d"; // nori
const GATE_FILL = "#f4a08a"; // salmon

/** Subunits travelled per full open→closed→open chomp. Two tiles per chomp. */
const CHOMP_PERIOD = SUB * 2;
/** Widest mouth half-angle, radians. */
const MOUTH_MAX = 0.92;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Paint the walls. Each wall tile gets a lighter keyline only on the sides that face
 * open space, so blocks read as extruded slabs rather than a flat blue mass — the same
 * read the arcade original gets from its double-line wall style, without hand-authoring
 * any geometry.
 */
export function bakeWalls(grid: Uint8Array, tilePx: number, dpr: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.round(COLS * tilePx * dpr), Math.round(ROWS * tilePx * dpr));
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const lip = Math.max(1, Math.round(tilePx * 0.075));
  const isWall = (c: number, r: number) => r >= 0 && r < ROWS && tileAt(grid, c, r) === 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isWall(c, r)) continue;
      const px = c * tilePx;
      const py = r * tilePx;
      ctx.fillStyle = WALL_FILL;
      ctx.fillRect(px, py, tilePx, tilePx);
      ctx.fillStyle = WALL_EDGE;
      // Column neighbours are read unwrapped on purpose: the maze edge should look
      // like an edge, not like it continues around.
      if (!isWall(c, r - 1)) ctx.fillRect(px, py, tilePx, lip);
      if (!isWall(c, r + 1)) ctx.fillRect(px, py + tilePx - lip, tilePx, lip);
      if (c === 0 || !isWall(c - 1, r)) ctx.fillRect(px, py, lip, tilePx);
      if (c === COLS - 1 || !isWall(c + 1, r)) ctx.fillRect(px + tilePx - lip, py, lip, tilePx);
    }
  }

  // Pen gate — a salmon bar across the opening.
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (tileAt(grid, c, r) !== 4) continue;
      ctx.fillStyle = GATE_FILL;
      ctx.fillRect(c * tilePx, r * tilePx + tilePx / 2 - lip, tilePx, lip * 2);
    }
  }
  return cv;
}

/** Paint every ordinary grain once. Golden grains are animated, so they are excluded. */
export function bakeGrains(grid: Uint8Array, tilePx: number, dpr: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.round(COLS * tilePx * dpr), Math.round(ROWS * tilePx * dpr));
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (tileAt(grid, c, r) !== GRAIN) continue;
      drawGrain(ctx, c * tilePx + tilePx / 2, r * tilePx + tilePx / 2, tilePx);
    }
  }
  return cv;
}

function drawGrain(ctx: CanvasRenderingContext2D, cx: number, cy: number, tilePx: number): void {
  const rx = Math.max(1.5, tilePx * 0.15);
  const ry = Math.max(1, tilePx * 0.08);
  ctx.fillStyle = GRAIN_FILL;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.45); // a grain lies at a slight angle, never axis-aligned
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Erase the grains that have been eaten since the last call, in place, so eating is
 * O(1) per grain instead of a full re-bake. `baked` is the caller's record of what the
 * layer currently shows and is updated here.
 */
export function syncGrainLayer(
  layer: HTMLCanvasElement,
  baked: Uint8Array,
  grid: Uint8Array,
  tilePx: number,
  dpr: number,
): void {
  const ctx = layer.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < baked.length; i++) {
    if (baked[i] !== GRAIN || grid[i] === GRAIN) continue;
    const c = i % COLS;
    const r = (i - c) / COLS;
    ctx.clearRect(c * tilePx, r * tilePx, tilePx, tilePx);
    baked[i] = grid[i];
  }
}

/**
 * Golden grains. `pulse` is 0..1 and is supplied by the host; pass a constant under
 * reduced motion and they simply sit still at full size.
 */
export function drawPower(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array,
  tilePx: number,
  pulse: number,
): void {
  const base = tilePx * 0.26;
  const r = base * (0.85 + 0.15 * pulse);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (tileAt(grid, col, row) !== POWER) continue;
      const cx = col * tilePx + tilePx / 2;
      const cy = row * tilePx + tilePx / 2;
      ctx.fillStyle = POWER_FILL;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = GRAIN_FILL;
      ctx.lineWidth = Math.max(1, tilePx * 0.055);
      ctx.beginPath();
      ctx.arc(cx, cy, r + tilePx * 0.11, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Facing angle in radians, indexed by Dir (UP, LEFT, DOWN, RIGHT). */
const DIR_ANGLE: Record<Dir, number> = {
  [UP]: -Math.PI / 2,
  [LEFT]: Math.PI,
  [DOWN]: Math.PI / 2,
  [RIGHT]: 0,
};

/**
 * The player: a grain of rice with a mouth. Longer than it is tall, so it reads as a
 * grain rather than a disc, and oriented along travel.
 *
 * The chomp is driven by distance travelled, not by elapsed time — so it stays in
 * lockstep with the deterministic simulation, and, exactly like the arcade original,
 * the mouth freezes when the player is stopped against a wall.
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: Player,
  tilePx: number,
  animate: boolean,
): void {
  const px = (player.x / SUB) * tilePx;
  const py = (player.y / SUB) * tilePx;
  const rx = tilePx * 0.46;
  const ry = tilePx * 0.36;

  // Triangle wave over distance: open → shut → open. Crisper than a sine.
  const phase = animate ? (player.distance % CHOMP_PERIOD) / CHOMP_PERIOD : 0.5;
  const mouth = MOUTH_MAX * (1 - Math.abs(phase * 2 - 1));

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(DIR_ANGLE[player.dir]);

  ctx.beginPath();
  if (mouth > 0.02) {
    ctx.ellipse(0, 0, rx, ry, 0, mouth, -mouth);
    ctx.lineTo(0, 0);
    ctx.closePath();
  } else {
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  }
  ctx.fillStyle = PLAYER_FILL;
  ctx.fill();
  ctx.strokeStyle = PLAYER_RIM;
  ctx.lineWidth = Math.max(1, tilePx * 0.05);
  ctx.stroke();

  // One eye, set back from the mouth. Drawn in the rotated frame but counter-rotated
  // so it never ends up below the grain when travelling left.
  const flip = player.dir === LEFT ? -1 : 1;
  ctx.beginPath();
  ctx.arc(-rx * 0.12, -ry * 0.44 * flip, Math.max(1, tilePx * 0.055), 0, Math.PI * 2);
  ctx.fillStyle = PLAYER_EYE;
  ctx.fill();

  ctx.restore();
}
