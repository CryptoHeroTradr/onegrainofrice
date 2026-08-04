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

// Farmer hat. Straw is khaki, the brim catches more light (paper-dark), and the whole
// silhouette is outlined in olive-deep. That outline is doing the real work: the pellet
// grains are flat khaki with no stroke, so a hard dark edge is the one feature the player
// has that nothing else on the board does.
const HAT_CONE = "#c4b370"; // khaki
const HAT_BRIM = "#d9cfb8"; // paper-dark
const HAT_EDGE = "#474d2e"; // olive-deep
const HAT_RIDGE = "#6a6c3a"; // olive

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

/**
 * ORIENTATION. There is ONE sprite, and it faces RIGHT: the mouth opens rightward, the
 * eye sits above the mouth, the hat sits on top of the head. Hat and eye are drawn in the
 * character's own frame, not the screen's — the hat is worn, so it goes where the head
 * goes.
 *
 * The four facings are transforms of that single sprite, applied to the whole character:
 *
 *   RIGHT  no transform
 *   LEFT   horizontal mirror, scale(-1, 1) — NOT a 180° rotation, so the character stays
 *          upright with the hat on top and the eye above the mouth
 *   UP     rotate 90° counter-clockwise
 *   DOWN   rotate 90° clockwise
 *
 * The tilted facings are therefore tilted whole: going UP the hat points to screen-left
 * and the eye is left of the mouth; going DOWN the hat points screen-right. That is the
 * intended read, not a bug to correct. Counter-rotating the hat to keep it screen-up
 * while the body turns is the thing that looks broken — a body leaning one way under a
 * hat leaning the other.
 *
 * It also dissolves the old UP problem. The mouth now only ever opens through the sprite's
 * own right-hand side, which is never where the hat is, so the hat and the mouth cone can
 * no longer compete for the same space at any facing. The inverted-cone UP hat is gone.
 */
type Facing = (ctx: CanvasRenderingContext2D) => void;

const FACING: Record<Dir, Facing> = {
  [RIGHT]: () => {},
  [LEFT]: (ctx) => ctx.scale(-1, 1),
  [UP]: (ctx) => ctx.rotate(-Math.PI / 2),
  [DOWN]: (ctx) => ctx.rotate(Math.PI / 2),
};

/** Hat geometry, in tile units. */
export const HAT_HALF_WIDTH = 0.38;
export const HAT_HEIGHT = 0.34;

/**
 * Hat and eye placement on the base RIGHT-facing sprite, in tile units.
 *
 * The mouth is a NOTCH cut out of the body, so anything drawn across it fills the gap and
 * reads as a shut mouth even without touching the body outline. The mouth opens in a cone
 * of about ±53° around +x, so both the hat and the eye sit clear of that cone: the hat is
 * set back and tilted so its apex leans behind the head, and the eye sits above and just
 * forward, past the upper lip of the widest chomp.
 */
const HAT_X = -0.2;
const HAT_Y = -0.24;
const HAT_TILT = -0.42;
const EYE_X = 0.08;
const EYE_Y = -0.16;

/**
 * A conical straw hat, centred on the origin with the brim level and the apex up. Drawn
 * brim-first so the cone sits over it and the brim shows as a rim either side, which is
 * what sells the cone shape at small sizes.
 */
function drawHat(ctx: CanvasRenderingContext2D, tilePx: number): void {
  const hw = tilePx * HAT_HALF_WIDTH;
  const hh = tilePx * HAT_HEIGHT;
  const edge = Math.max(1, tilePx * 0.045);

  ctx.lineJoin = "round";
  ctx.lineWidth = edge;
  ctx.strokeStyle = HAT_EDGE;

  ctx.beginPath();
  ctx.ellipse(0, 0, hw, hw * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = HAT_BRIM;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-hw * 0.86, 0);
  ctx.quadraticCurveTo(-hw * 0.4, -hh, 0, -hh);
  ctx.quadraticCurveTo(hw * 0.4, -hh, hw * 0.86, 0);
  ctx.closePath();
  ctx.fillStyle = HAT_CONE;
  ctx.fill();
  ctx.stroke();

  // A single straw seam. Below ~20px tiles it is sub-pixel, so it is skipped rather
  // than smeared into a grey haze over the cone.
  if (tilePx >= 20) {
    ctx.beginPath();
    ctx.moveTo(0, -hh * 0.86);
    ctx.lineTo(0, -hh * 0.06);
    ctx.strokeStyle = HAT_RIDGE;
    ctx.lineWidth = Math.max(0.75, tilePx * 0.022);
    ctx.stroke();
  }
}

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
  // One transform for the whole character — body, hat and eye together. See FACING.
  FACING[player.dir](ctx);

  // Body. The mouth opens along +x, which the facing transform has already aimed.
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

  ctx.save();
  ctx.translate(HAT_X * tilePx, HAT_Y * tilePx);
  ctx.rotate(HAT_TILT);
  drawHat(ctx, tilePx);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(EYE_X * tilePx, EYE_Y * tilePx, Math.max(1, tilePx * 0.055), 0, Math.PI * 2);
  ctx.fillStyle = PLAYER_EYE;
  ctx.fill();

  ctx.restore();
}
