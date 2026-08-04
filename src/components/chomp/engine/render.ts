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
import { DOWN, DX, DY, GRAIN, LEFT, POWER, RIGHT, SUB, UP, type Dir } from "./types";
import { EYES, type Pest } from "./pests";
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

/**
 * The death animation: the grain keeps opening until there is nothing left of it.
 * `progress` runs 0 → 1 and is derived from the tick count, so it replays like everything
 * else. Deliberately the same shape as the chomp — the player is not killed by a
 * different mechanic, they are simply left open.
 */
export function drawPlayerDeath(
  ctx: CanvasRenderingContext2D,
  player: Player,
  tilePx: number,
  progress: number,
): void {
  const t = Math.max(0, Math.min(1, progress));
  const px = (player.x / SUB) * tilePx;
  const py = (player.y / SUB) * tilePx;
  const scale = 1 - t * 0.35;
  const rx = tilePx * 0.46 * scale;
  const ry = tilePx * 0.36 * scale;
  // Sweeps from the widest chomp to a full circle of nothing.
  const mouth = MOUTH_MAX + (Math.PI - MOUTH_MAX) * t;
  if (mouth >= Math.PI - 0.02) return;

  ctx.save();
  ctx.translate(px, py);
  FACING[player.dir](ctx);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, mouth, -mouth);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = PLAYER_FILL;
  ctx.fill();
  ctx.strokeStyle = PLAYER_RIM;
  ctx.lineWidth = Math.max(1, tilePx * 0.05);
  ctx.stroke();
  ctx.restore();
}

// --- the pests --------------------------------------------------------------

/**
 * LEGIBILITY: four SILHOUETTES, not four colours of one shape.
 *
 * Colour is the first thing to fail here. A textured paddy background is coming in a
 * later phase, and a coloured blob on a photograph is a coloured blob; a colourblind
 * player never had the channel to begin with; a phone in sunlight has neither. So each
 * pest is built around one outline feature that survives being printed in black and
 * white, and every one of them is stroked in nori so the shape holds its edge against
 * whatever ends up behind it:
 *
 *   Rat     — two round EARS on top and a long bare TAIL trailing behind. Low, long body.
 *   Sparrow — a wedge BEAK and a fanned TAIL kicked up behind. Plump and round.
 *   Weevil  — a fat domed shell and a long down-curving SNOUT. Wide and low.
 *   Locust  — a Z-kinked JUMPING LEG standing above the back, and long ANTENNAE. Narrow.
 *
 * Squint at them, or turn the saturation off, and they are still four different animals.
 *
 * ORIENTATION differs from the player on purpose. The player is one right-facing sprite
 * rotated bodily, which works because a grain of rice reads at any angle. A rat rotated
 * 90° does not read as a rat, and the silhouette is the entire point here — so pests stay
 * upright, mirror horizontally to face left, and show direction with a lean and with
 * where the eye is looking rather than by turning the body.
 */
const PEST_BODY: readonly string[] = [
  "#c1443a", // Rat     — tuna
  "#f4a08a", // Sparrow — salmon
  "#4e7a3e", // Weevil  — bamboo
  "#6a6c3a", // Locust  — olive
];
const PEST_EDGE = "#14110d"; // nori — every pest carries it, on every background
const PEST_LIGHT = "#f4efe2"; // bone — the highlight that lifts the darker two
const PEST_EYE_WHITE = "#fbf7ee";
const PEST_EYE_PUPIL = "#14110d";

/** Frightened: drained of colour, same silhouette — you still know what is running away. */
const FRIGHT_FILL = "#d9cfb8"; // paper-dark
const FRIGHT_EDGE = "#474d2e"; // olive-deep
const FRIGHT_FLASH = "#f4efe2"; // bone

/** How long before a power window ends the frightened pests start flashing, in ticks. */
export const FRIGHT_FLASH_TICKS = 120;

/** Eyes look where the pest is going. Offset in tile units. */
const PUPIL_SHIFT = 0.07;

function eyePair(
  ctx: CanvasRenderingContext2D,
  tilePx: number,
  dir: Dir,
  x: number,
  y: number,
  spread: number,
  radius: number,
): void {
  const r = Math.max(1.2, tilePx * radius);
  const dx = DX[dir] * tilePx * PUPIL_SHIFT;
  const dy = DY[dir] * tilePx * PUPIL_SHIFT;
  for (const side of [-1, 1]) {
    const ex = x * tilePx + side * spread * tilePx;
    const ey = y * tilePx;
    ctx.beginPath();
    ctx.ellipse(ex, ey, r, r * 1.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = PEST_EYE_WHITE;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + dx, ey + dy, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = PEST_EYE_PUPIL;
    ctx.fill();
  }
}

/** Rat: long low body, round ears, bare tail. */
function drawRat(ctx: CanvasRenderingContext2D, tilePx: number, fill: string, edge: string): void {
  const s = tilePx;
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = edge;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Tail first, so the body sits over its root.
  ctx.beginPath();
  ctx.moveTo(-s * 0.34, s * 0.04);
  ctx.quadraticCurveTo(-s * 0.62, s * 0.1, -s * 0.5, -s * 0.22);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.stroke();

  // Ears — the read at a glance, and they sit proud of the head outline.
  for (const ear of [-0.02, 0.16]) {
    ctx.beginPath();
    ctx.arc(ear * s, -s * 0.27, s * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.stroke();
  }

  // Body: long, low, with the snout drawn out to a point at the front.
  ctx.beginPath();
  ctx.moveTo(s * 0.46, -s * 0.02); // nose
  ctx.quadraticCurveTo(s * 0.28, -s * 0.24, s * 0.02, -s * 0.24);
  ctx.quadraticCurveTo(-s * 0.36, -s * 0.24, -s * 0.36, s * 0.04);
  ctx.quadraticCurveTo(-s * 0.36, s * 0.3, s * 0.0, s * 0.3);
  ctx.quadraticCurveTo(s * 0.3, s * 0.3, s * 0.46, -s * 0.02);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();

  // Nose tip.
  ctx.beginPath();
  ctx.arc(s * 0.43, -s * 0.02, s * 0.035, 0, Math.PI * 2);
  ctx.fillStyle = edge;
  ctx.fill();
}

/** Sparrow: plump round body, wedge beak, fanned tail kicked up behind. */
function drawSparrow(
  ctx: CanvasRenderingContext2D,
  tilePx: number,
  fill: string,
  edge: string,
): void {
  const s = tilePx;
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = edge;
  ctx.lineJoin = "round";

  // Fan tail, behind and above — a notched wedge, not a point.
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, s * 0.02);
  ctx.lineTo(-s * 0.52, -s * 0.26);
  ctx.lineTo(-s * 0.44, -s * 0.06);
  ctx.lineTo(-s * 0.54, s * 0.06);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();

  // Body: a fat teardrop.
  ctx.beginPath();
  ctx.ellipse(0, s * 0.02, s * 0.36, s * 0.32, -0.12, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();

  // Wing, as a closed shape so it survives at small sizes.
  ctx.beginPath();
  ctx.moveTo(-s * 0.16, -s * 0.04);
  ctx.quadraticCurveTo(s * 0.02, s * 0.02, -s * 0.06, s * 0.22);
  ctx.quadraticCurveTo(-s * 0.2, s * 0.14, -s * 0.16, -s * 0.04);
  ctx.closePath();
  ctx.fillStyle = PEST_LIGHT;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();

  // Beak: a hard triangular wedge, the one thing no other pest has.
  ctx.beginPath();
  ctx.moveTo(s * 0.3, -s * 0.12);
  ctx.lineTo(s * 0.54, -s * 0.03);
  ctx.lineTo(s * 0.3, s * 0.06);
  ctx.closePath();
  ctx.fillStyle = PEST_LIGHT;
  ctx.fill();
  ctx.stroke();
}

/** Weevil: wide domed shell, split down the middle, with a long curving snout. */
function drawWeevil(
  ctx: CanvasRenderingContext2D,
  tilePx: number,
  fill: string,
  edge: string,
): void {
  const s = tilePx;
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = edge;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Legs, short and stubby, poking out under the shell.
  for (const lx of [-0.24, 0, 0.2]) {
    ctx.beginPath();
    ctx.moveTo(lx * s, s * 0.16);
    ctx.lineTo(lx * s - s * 0.06, s * 0.34);
    ctx.lineWidth = Math.max(1, s * 0.045);
    ctx.stroke();
  }

  // The snout: long, thin, curving down and forward. The weevil's whole identity.
  ctx.beginPath();
  ctx.moveTo(s * 0.24, -s * 0.06);
  ctx.quadraticCurveTo(s * 0.5, -s * 0.02, s * 0.52, s * 0.22);
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.stroke();

  // Shell: a wide low dome.
  ctx.beginPath();
  ctx.ellipse(-s * 0.04, -s * 0.02, s * 0.4, s * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.stroke();

  // Elytra seam, front to back.
  ctx.beginPath();
  ctx.moveTo(-s * 0.42, -s * 0.02);
  ctx.lineTo(s * 0.24, -s * 0.02);
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.strokeStyle = edge;
  ctx.stroke();
}

/** Locust: narrow body, long antennae, and a big Z-kinked jumping leg above the back. */
function drawLocust(
  ctx: CanvasRenderingContext2D,
  tilePx: number,
  fill: string,
  edge: string,
): void {
  const s = tilePx;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = edge;

  // Antennae, swept forward.
  ctx.lineWidth = Math.max(1, s * 0.04);
  for (const spread of [-0.06, 0.06]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.2, -s * 0.12);
    ctx.quadraticCurveTo(s * 0.4, -s * 0.34 + spread * s, s * 0.54, -s * 0.3 + spread * s);
    ctx.stroke();
  }

  // Body: narrow and long.
  ctx.beginPath();
  ctx.ellipse(0, s * 0.04, s * 0.42, s * 0.21, -0.06, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.fill();
  ctx.stroke();

  // Folded wing case along the back.
  ctx.beginPath();
  ctx.moveTo(-s * 0.34, -s * 0.04);
  ctx.quadraticCurveTo(-s * 0.02, -s * 0.16, s * 0.26, -s * 0.02);
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.stroke();

  // THE LEG. A hard Z above the body line — the shape that names this pest in monochrome,
  // and the reason the locust is drawn narrow: the leg needs somewhere to be.
  ctx.beginPath();
  ctx.moveTo(-s * 0.04, s * 0.06);
  ctx.lineTo(-s * 0.3, -s * 0.34);
  ctx.lineTo(-s * 0.46, s * 0.02);
  ctx.lineWidth = Math.max(1.2, s * 0.075);
  ctx.stroke();
  ctx.strokeStyle = PEST_LIGHT;
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.stroke();
}

const PEST_ART: readonly ((
  ctx: CanvasRenderingContext2D,
  tilePx: number,
  fill: string,
  edge: string,
) => void)[] = [drawRat, drawSparrow, drawWeevil, drawLocust];

/** Where the eyes sit on each pest, in tile units: x, y, spread, radius. */
const PEST_EYES: readonly { x: number; y: number; spread: number; r: number }[] = [
  { x: 0.16, y: -0.08, spread: 0.055, r: 0.05 }, // Rat
  { x: 0.16, y: -0.12, spread: 0.05, r: 0.055 }, // Sparrow
  { x: 0.06, y: -0.09, spread: 0.09, r: 0.05 }, //  Weevil
  { x: 0.2, y: -0.02, spread: 0.045, r: 0.05 }, //  Locust
];

/** Just the eyes, for a pest that has been eaten and is on its way home. */
function drawEyesOnly(ctx: CanvasRenderingContext2D, kind: number, tilePx: number, dir: Dir): void {
  const e = PEST_EYES[kind];
  eyePair(ctx, tilePx, dir, 0, e.y, 0.13, 0.075);
}

/**
 * Draw one pest.
 *
 * `flashTicks` is the number of ticks left in the power window, or 0 when none is open;
 * it drives the end-of-window flash. `wobble` is a small deterministic bob supplied by
 * the caller so a frightened pest reads as panicking without any per-frame randomness.
 */
export function drawPest(
  ctx: CanvasRenderingContext2D,
  pest: Pest,
  tilePx: number,
  frightTicks: number,
  animate: boolean,
): void {
  const px = (pest.x / SUB) * tilePx;
  const py = (pest.y / SUB) * tilePx;

  ctx.save();
  ctx.translate(px, py);

  if (pest.state === EYES) {
    drawEyesOnly(ctx, pest.kind, tilePx, pest.dir);
    ctx.restore();
    return;
  }

  // Face the way we are going without ever rotating the silhouette off its feet: mirror
  // for left, and lean into a vertical move rather than turning on its side.
  if (pest.dir === LEFT) ctx.scale(-1, 1);
  else if (pest.dir === UP) ctx.rotate(-0.22);
  else if (pest.dir === DOWN) ctx.rotate(0.22);

  let fill = PEST_BODY[pest.kind];
  let edge = PEST_EDGE;
  if (pest.frightened) {
    // Flash near the end of the window. On the tick count, so it cannot desync.
    const flashing = frightTicks > 0 && frightTicks < FRIGHT_FLASH_TICKS;
    const on = flashing && animate && Math.floor(frightTicks / 8) % 2 === 0;
    fill = on ? FRIGHT_FLASH : FRIGHT_FILL;
    edge = FRIGHT_EDGE;
  }

  PEST_ART[pest.kind](ctx, tilePx, fill, edge);

  const e = PEST_EYES[pest.kind];
  // A frightened pest looks straight ahead at nothing in particular.
  eyePair(ctx, tilePx, pest.frightened ? RIGHT : pest.dir, e.x, e.y, e.spread, e.r);

  ctx.restore();
}

/** Draw all four, penned pests last so an emerging pest is never hidden behind the gate. */
export function drawPests(
  ctx: CanvasRenderingContext2D,
  pests: readonly Pest[],
  tilePx: number,
  frightTicks: number,
  animate: boolean,
): void {
  for (const pest of pests) drawPest(ctx, pest, tilePx, frightTicks, animate);
}

/** Small standing sprite for the HUD's remaining-lives row. */
export function drawPestIcon(
  ctx: CanvasRenderingContext2D,
  kind: number,
  tilePx: number,
): void {
  PEST_ART[kind](ctx, tilePx, PEST_BODY[kind], PEST_EDGE);
}
