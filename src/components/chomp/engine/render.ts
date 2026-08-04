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

import { COLS, PEN_BOTTOM, PEN_LEFT, PEN_RIGHT, PEN_TOP, ROWS, tileAt } from "./maze";
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
 * THE PADDY WALL TEXTURE.
 *
 * A self-hosted aerial photograph of flooded paddies — the fields become the wall blocks
 * and the grass bunds between them become the detail — clipped to the wall shapes so the
 * corridors stay flat black and the grains, player and pests keep popping off them.
 *
 * `TEXTURE_DARKEN` is a black veil laid over the photograph before it is masked, so 0.52
 * literally means "52% darker". The spec's range is 40–60%: below about 0.45 the bunds get
 * bright enough to compete with the khaki grains, above about 0.6 the whole thing collapses
 * into the corridors and there was no point loading an image. It is one number, on purpose,
 * because it is the dial that gets tuned by eye.
 *
 * `TEXTURE_LIP_SCALE` is the line item the spec says decides whether any of this works. A
 * flat porcelain wall needs only a hairline to read as a slab; a photograph is BUSY, and
 * without a heavier outline the maze turns to soup — the eye loses where a wall stops and
 * a corridor starts, which in a chase game is not a cosmetic problem. So the keyline that
 * is decoration on the flat board is structure on the textured one, and it is thickened.
 */
const TEXTURE_DARKEN = 0.52;
const TEXTURE_LIP_SCALE = 1.4;

/** Bone lettering, with a nori halo so it holds an edge over any patch of photograph. */
const LETTER_FILL = "#f4efe2"; // bone
const LETTER_HALO = "#14110d"; // nori

/**
 * THE WALL LETTERING, and which walls it is on.
 *
 * Reading down the centre column there are exactly two 8-wide × 2-tall wall blocks above
 * the pit, separated by the row-8 corridor. They take the two halves of the site's name,
 * stacked, sitting directly on top of the pit and its backdrop.
 *
 * There is no third such block: below rows 9-10 comes the row-11 corridor, the gate, and
 * then the pit itself, so "the two-row wall immediately below" the lower one does not
 * exist. Confirmed with the owner before this was drawn.
 *
 * The text is fitted to the block and CLIPPED to it, so it can never bleed into a
 * corridor — a letter stroke lying in a corridor would read as a wall that is not there.
 */
export const LETTER_BLOCKS: readonly {
  text: string;
  col0: number;
  col1: number;
  row0: number;
  row1: number;
}[] = [
  { text: "One Grain of", col0: 10, col1: 17, row0: 6, row1: 7 },
  { text: "$RICE", col0: 10, col1: 17, row0: 9, row1: 10 },
];

/** Fallback stack, used only if the theme's font variable cannot be read. */
const LETTER_FONT_FALLBACK = '"Fredoka", ui-rounded, system-ui, sans-serif';
/** Halo stroke width as a fraction of the font size. Also the fit's safety margin. */
const LETTER_HALO_EM = 0.16;
/**
 * Below this the lettering is not drawn at all.
 *
 * Measured, in Fredoka Bold: at a 13px portrait tile "One Grain of" fits at 16px with an
 * 11px cap height and "$RICE" at 21px with a 15px one, both of which read. A tile small
 * enough to push the long line under about 10px is a board nobody can play anyway, and a
 * smear of grey where a word should be is worse than a plain wall.
 */
const MIN_LETTER_PX = 10;

export interface WallBakeOptions {
  /**
   * Overridden to bake the maze-flash layer. The flash is a second baked canvas rather
   * than a per-frame tint: a tint means compositing the whole board every frame of the
   * strobe, and the whole point of baking is that the hot loop only draws what moves.
   */
  fill?: string;
  edge?: string;
  /** Thickens the keyline for the high-contrast board, where the line IS the wall. */
  lipScale?: number;
  /**
   * The decoded paddy photograph, or null/undefined for a flat board. Null is not a
   * failure mode — it is the high-contrast board, and it is also every frame drawn before
   * the image finishes decoding, which is why first paint never waits on it.
   */
  texture?: CanvasImageSource | null;
  /** Font family for the baked lettering, read from the theme vars by the host. */
  fontFamily?: string;
  /** Lettering colour. Flipped to a dark ink on the flash layer, whose walls are bone. */
  letterFill?: string;
  letterHalo?: string;
}

/**
 * Paint the walls. Each wall tile gets a lighter keyline only on the sides that face
 * open space, so blocks read as extruded slabs rather than a flat blue mass — the same
 * read the arcade original gets from its double-line wall style, without hand-authoring
 * any geometry.
 *
 * Three passes, and the order is load-bearing: fill, then texture masked to the fill,
 * then the keyline and the lettering ON TOP of the texture. Drawing the keyline first
 * would let the photograph eat the one feature holding the maze together.
 */
export function bakeWalls(
  grid: Uint8Array,
  tilePx: number,
  dpr: number,
  opts: WallBakeOptions = {},
): HTMLCanvasElement {
  const {
    fill = WALL_FILL,
    edge = WALL_EDGE,
    texture = null,
    fontFamily,
    letterFill = LETTER_FILL,
    letterHalo = LETTER_HALO,
  } = opts;
  const lipScale = opts.lipScale ?? (texture ? TEXTURE_LIP_SCALE : 1);

  const cv = makeCanvas(Math.round(COLS * tilePx * dpr), Math.round(ROWS * tilePx * dpr));
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const lip = Math.max(1, Math.round(tilePx * 0.075 * lipScale));
  const isWall = (c: number, r: number) => r >= 0 && r < ROWS && tileAt(grid, c, r) === 0;
  const boardW = COLS * tilePx;
  const boardH = ROWS * tilePx;

  // Pass 1 — the solid fill. This is the whole wall treatment on the flat board and on
  // the high-contrast board, and it is what shows while the texture is still decoding.
  ctx.fillStyle = fill;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isWall(c, r)) ctx.fillRect(c * tilePx, r * tilePx, tilePx, tilePx);
    }
  }

  // Pass 2 — the photograph, darkened, then masked to exactly the tiles just filled.
  //
  // Done on a scratch canvas with `destination-in` rather than by clipping the main
  // context to ~380 tile rects: one composite beats a 380-subpath clip, and the darkening
  // veil can then be a single fillRect over the scratch instead of a per-tile operation.
  if (texture) {
    const scratch = makeCanvas(cv.width, cv.height);
    const sctx = scratch.getContext("2d");
    if (sctx) {
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCover(sctx, texture, 0, 0, boardW, boardH, 0.5);
      sctx.fillStyle = `rgba(0, 0, 0, ${TEXTURE_DARKEN})`;
      sctx.fillRect(0, 0, boardW, boardH);
      sctx.globalCompositeOperation = "destination-in";
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (isWall(c, r)) sctx.fillRect(c * tilePx, r * tilePx, tilePx, tilePx);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(scratch, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // Pass 3 — the keyline, over the texture.
  ctx.fillStyle = edge;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isWall(c, r)) continue;
      const px = c * tilePx;
      const py = r * tilePx;
      // Column neighbours are read unwrapped on purpose: the maze edge should look
      // like an edge, not like it continues around.
      if (!isWall(c, r - 1)) ctx.fillRect(px, py, tilePx, lip);
      if (!isWall(c, r + 1)) ctx.fillRect(px, py + tilePx - lip, tilePx, lip);
      if (c === 0 || !isWall(c - 1, r)) ctx.fillRect(px, py, lip, tilePx);
      if (c === COLS - 1 || !isWall(c + 1, r)) ctx.fillRect(px + tilePx - lip, py, lip, tilePx);
    }
  }

  bakeLetters(ctx, tilePx, lip, fontFamily, letterFill, letterHalo);

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

/**
 * Fit and stamp the two lines into their wall blocks.
 *
 * The size is MEASURED rather than chosen: the text is fitted to whichever of the block's
 * width or height binds first, so one rule covers a 13px portrait tile and a 27px desktop
 * one without a breakpoint. "One Grain of" is width-bound at every size (twelve characters
 * across eight tiles) and "$RICE" is height-bound, which is why the two lines are not the
 * same size and should not be forced to be.
 *
 * The halo is not a drop shadow. It is a stroke of the same glyph, laid down first, so the
 * letterform holds an edge wherever the photograph happens to be pale — the same trick the
 * pests use, for the same reason.
 */
function bakeLetters(
  ctx: CanvasRenderingContext2D,
  tilePx: number,
  lip: number,
  fontFamily: string | undefined,
  fillStyle: string,
  haloStyle: string,
): void {
  const family = fontFamily && fontFamily.trim() ? fontFamily : LETTER_FONT_FALLBACK;
  // Keep clear of the keyline on all four sides, or a descender lands on the outline and
  // reads as a nick in the wall.
  const inset = lip + tilePx * 0.1;

  for (const block of LETTER_BLOCKS) {
    const x = block.col0 * tilePx;
    const y = block.row0 * tilePx;
    const w = (block.col1 - block.col0 + 1) * tilePx;
    const h = (block.row1 - block.row0 + 1) * tilePx;
    const maxW = w - inset * 2;
    const maxH = h - inset * 2;
    if (maxW <= 0 || maxH <= 0) continue;

    // Measure at a probe size and scale linearly — canvas text metrics are linear in the
    // font size, so one measurement is enough and the fit is exact rather than iterated.
    //
    // The vertical extent is MEASURED, not assumed. The two lines do not have the same
    // ink height — "$RICE" is 0.82em because the dollar sign overshoots both the cap line
    // and the baseline, against 0.75em for "One Grain of" — so a single "cap height is
    // about 0.74em" constant fits one of them and clips the other. actualBoundingBox is
    // exactly this measurement and is in every browser this game runs in; the fallback is
    // the pessimistic figure, which shrinks rather than overflows.
    const PROBE = 100;
    ctx.font = `700 ${PROBE}px ${family}`;
    const m = ctx.measureText(block.text);
    const emW = (m.width || PROBE) / PROBE;
    const inkH = (m.actualBoundingBoxAscent ?? 0) + (m.actualBoundingBoxDescent ?? 0);
    const emH = inkH > 0 ? inkH / PROBE : 0.85;
    // The halo is a stroke centred on the outline, so half of it sits OUTSIDE the glyph on
    // every side. Fitting the fill and then stroking it is how text ends up clipped.
    const halo = LETTER_HALO_EM;
    const size = Math.floor(Math.min(maxW / (emW + halo), maxH / (emH + halo)));
    if (size < MIN_LETTER_PX) continue; // below this it is a smudge, not a word

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip(); // no bleed into a corridor, ever — this is the guarantee, not the intent
    ctx.font = `700 ${size}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(1, size * halo);
    // Sit the INK box in the middle of the block rather than the baseline, so a line with
    // a descender is not optically high and one without is not optically low.
    const f = ctx.measureText(block.text);
    const asc = f.actualBoundingBoxAscent ?? size * 0.7;
    const desc = f.actualBoundingBoxDescent ?? 0;
    const baseline = y + h / 2 + (asc - desc) / 2;
    ctx.strokeStyle = haloStyle;
    ctx.strokeText(block.text, x + w / 2, baseline);
    ctx.fillStyle = fillStyle;
    ctx.fillText(block.text, x + w / 2, baseline);
    ctx.restore();
  }
}

/**
 * Draw a source into a destination rect with COVER semantics — fill the box, crop the
 * overflow — cropping on the axis that overflows. `focus` picks the slice on that axis:
 * 0 keeps the top/left, 1 the bottom/right, 0.5 the middle.
 *
 * Shared by the wall texture and the pit video so there is one piece of fit maths in the
 * file rather than two that can disagree.
 */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  focus: number,
): void {
  const sw0 = srcWidth(src);
  const sh0 = srcHeight(src);
  if (!sw0 || !sh0 || dw <= 0 || dh <= 0) return;
  const sw = Math.min(sw0, sh0 * (dw / dh));
  const sh = Math.min(sh0, sw0 * (dh / dw));
  const sx = (sw0 - sw) * 0.5;
  const sy = (sh0 - sh) * focus;
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
}

function srcWidth(src: CanvasImageSource): number {
  const v = src as HTMLVideoElement;
  if (typeof v.videoWidth === "number") return v.videoWidth;
  const i = src as HTMLImageElement;
  return typeof i.naturalWidth === "number" ? i.naturalWidth : (i.width as number) || 0;
}

function srcHeight(src: CanvasImageSource): number {
  const v = src as HTMLVideoElement;
  if (typeof v.videoHeight === "number") return v.videoHeight;
  const i = src as HTMLImageElement;
  return typeof i.naturalHeight === "number" ? i.naturalHeight : (i.height as number) || 0;
}

/**
 * THE PIT BACKDROP.
 *
 * A looping, silent video drawn into the pen interior. It goes through the canvas rather
 * than sitting in a DOM layer behind it, and that is the decision worth keeping: on the
 * canvas it inherits the letterbox, the DPR and the z-order the renderer already has, so
 * it stays aligned through every resize for free and the pests waiting in the pen draw
 * OVER it without a single line of stacking-context work. A positioned <img> or <video>
 * would have needed all of that maintained by hand, twice.
 *
 * `drawImage` on a video pulls whatever frame is showing at the moment of the call, so a
 * paused element paints a still and a playing one animates — which is exactly the two
 * behaviours reduced motion needs, with no branch here.
 *
 * It is drawn per frame because it MUST be: it is the one part of the board that changes
 * without the simulation changing, so it is the one part that cannot live in the bake.
 * Everything else still does.
 *
 * ── THE CROP ────────────────────────────────────────────────────────────────────
 * The source is square and the pit is 6×4 tiles (3:2), so COVER crops the vertical: the
 * middle two-thirds of the frame is kept and the top and bottom sixth are cut. That is
 * the right trade for a square source in a landscape hole — the alternative, CONTAIN,
 * leaves pillar bars inside the pit and the pit is a lit window, not a letterbox.
 *
 * `PIT_VIDEO_FOCUS` is that slice's centre, named rather than hardcoded at 0.5 so the
 * framing can be nudged — lower it to keep more of the top of the frame, raise it to keep
 * more of the bottom — without going anywhere near the draw maths.
 */
export const PIT_VIDEO_FOCUS = 0.5;

/** The pit interior in pixels, at a given tile size. Cols 11-16, rows 13-16. */
export function pitRect(tilePx: number): { x: number; y: number; w: number; h: number } {
  return {
    x: PEN_LEFT * tilePx,
    y: PEN_TOP * tilePx,
    w: (PEN_RIGHT - PEN_LEFT + 1) * tilePx,
    h: (PEN_BOTTOM - PEN_TOP + 1) * tilePx,
  };
}

/**
 * Paint the pit backdrop. A no-op until the video has enough data to yield a frame —
 * drawing a video with no current frame throws in some browsers and paints nothing in
 * others, and the pit is simply black until then, which is what it was before.
 */
export function drawPitVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  tilePx: number,
): void {
  if (!video || video.readyState < 2 /* HAVE_CURRENT_DATA */) return;
  const { x, y, w, h } = pitRect(tilePx);
  ctx.save();
  // Clip as well as fit: a rounding error at some DPR must not paint a pixel of video
  // onto the pen wall, where it would read as a hole in the maze.
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  drawCover(ctx, video, x, y, w, h, PIT_VIDEO_FOCUS);
  ctx.restore();
}

/**
 * THE HIGH-CONTRAST BOARD.
 *
 * Not a second art style — the same maze with the one thing that carries it
 * turned all the way up. Ordinary walls are porcelain on black, which is a
 * contrast ratio of about 2.4:1: pretty, and genuinely hard to read for anyone
 * whose eyes or screen are not ideal. It also gets worse, not better, when the
 * paddy wall texture lands, which is why the spec pairs that decoration with
 * this switch.
 *
 * So: the wall FILL goes plain black — no texture, no image, nothing to decode —
 * and the keyline that was decoration becomes the whole wall, in bone at double
 * thickness. Bone on black is about 18:1. The grains go bone too, because khaki
 * grains against a bone keyline is the one pair this change would otherwise make
 * worse. Everything else is untouched: the player's hat outline, the four pest
 * silhouettes and the six bonus shapes were already built to read in monochrome,
 * and re-tinting them here would undo work rather than add to it.
 */
export const CONTRAST_WALL_FILL = "#000000";
export const CONTRAST_WALL_EDGE = "#f4efe2"; // bone
export const CONTRAST_GRAIN_FILL = "#f4efe2"; // bone
export const CONTRAST_LIP_SCALE = 2;

/** Paint every ordinary grain once. Golden grains are animated, so they are excluded. */
export function bakeGrains(
  grid: Uint8Array,
  tilePx: number,
  dpr: number,
  fill: string = GRAIN_FILL,
): HTMLCanvasElement {
  const cv = makeCanvas(Math.round(COLS * tilePx * dpr), Math.round(ROWS * tilePx * dpr));
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (tileAt(grid, c, r) !== GRAIN) continue;
      drawGrain(ctx, c * tilePx + tilePx / 2, r * tilePx + tilePx / 2, tilePx, fill);
    }
  }
  return cv;
}

function drawGrain(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tilePx: number,
  fill: string = GRAIN_FILL,
): void {
  const rx = Math.max(1.5, tilePx * 0.15);
  const ry = Math.max(1, tilePx * 0.08);
  ctx.fillStyle = fill;
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
  drawPlayerBody(ctx, tilePx, mouth, rx, ry);
  ctx.restore();
}

/**
 * The character itself, in its own local space, facing RIGHT and centred on the origin.
 *
 * Split out of drawPlayer so the HUD's lives row can draw the SAME grain rather than a
 * hand-made icon beside it. That is the whole point of the split: a second drawing of the
 * player is a second thing to keep in step, and the one thing the spec asks of this
 * character is that a player never loses track of which grain they are. An icon that
 * drifts from the sprite teaches the wrong silhouette.
 */
function drawPlayerBody(
  ctx: CanvasRenderingContext2D,
  tilePx: number,
  mouth: number,
  rx: number,
  ry: number,
): void {
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
}

/**
 * ONE LIFE, at HUD size — the player's own grain, hat and all.
 *
 * The HUD used to spend a `◆` per life. A diamond is not the character, and the lives row
 * is the one place a player looks between deaths, so it is worth the few drawing calls to
 * make it the same grain they were just steering. It goes through drawPlayerBody, which is
 * the function the board uses, so the icon cannot drift from the sprite.
 *
 * Drawn centred on the origin with the mouth half open — the same pose the board shows
 * when the player is stopped — and facing right, which is the base sprite with no
 * transform at all. `tilePx` here is the icon's own size, not the board's.
 */
export function drawPlayerIcon(ctx: CanvasRenderingContext2D, tilePx: number): void {
  ctx.save();
  ctx.translate(tilePx / 2, tilePx / 2);
  drawPlayerBody(ctx, tilePx, MOUTH_MAX * 0.55, tilePx * 0.46, tilePx * 0.36);
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

// --- bonus items ------------------------------------------------------------

/**
 * SIX SILHOUETTES, at one tile.
 *
 * Same rule as the pests, and a harder version of it: these are ONE tile — about 27px on
 * a desktop and less on a phone — they appear for nine seconds, and the player is reading
 * them out of the corner of an eye while being chased. Anything that needs a second look
 * has already failed. So each is built from one unmistakable outline property:
 *
 *   Soy sauce  — a NECK. Tall body, hard shoulder, narrow throat, cap on top.
 *   Chopsticks — two thin DIAGONALS with daylight between them. The only item that is
 *                not one solid mass, and the only one made of straight lines.
 *   Nori       — a wide sheet with a CURLED CORNER. The curl is the whole point: a plain
 *                rectangle and a trapezoid are the same shape at this size, so the sheet
 *                gets a rolled corner and the cup keeps its foot.
 *   Sake cup   — a FOOT. Flared bowl on a pedestal, with an open elliptical rim.
 *   Chili      — a CURVE. The only organic asymmetric shape, with a stem kinked against
 *                the bend of the pod.
 *   Sesame     — THREE separate seeds. The only item that is not a single object.
 *
 * Turn the saturation off and they are still six different things, which is the test.
 * Colour is a second channel, not the first: nori is bamboo green rather than black
 * because a black sheet on a black corridor is not a sheet, it is a hole.
 */
const BONUS_EDGE = "#14110d"; // nori — the same hard edge every character carries
const BONUS_BONE = "#f4efe2";
const BONUS_STEAMED = "#fbf7ee";
const BONUS_TUNA = "#c1443a";
const BONUS_BAMBOO = "#4e7a3e";
const BONUS_PAPER_DARK = "#d9cfb8";
const BONUS_PORCELAIN = "#2a4d8f";
const BONUS_OLIVE_DEEP = "#474d2e";

/** Soy sauce: the neck is the read. */
function drawSoy(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = BONUS_EDGE;

  // Body: straight sides, hard shoulder, pinched into a throat.
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, s * 0.42);
  ctx.lineTo(-s * 0.22, -s * 0.04);
  ctx.lineTo(-s * 0.09, -s * 0.24); // shoulder
  ctx.lineTo(-s * 0.09, -s * 0.36); // throat
  ctx.lineTo(s * 0.09, -s * 0.36);
  ctx.lineTo(s * 0.09, -s * 0.24);
  ctx.lineTo(s * 0.22, -s * 0.04);
  ctx.lineTo(s * 0.22, s * 0.42);
  ctx.closePath();
  ctx.fillStyle = BONUS_BONE;
  ctx.fill();
  ctx.stroke();

  // The sauce inside, so the bottle is not an empty outline at a glance.
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, s * 0.42);
  ctx.lineTo(-s * 0.22, s * 0.06);
  ctx.lineTo(s * 0.22, s * 0.06);
  ctx.lineTo(s * 0.22, s * 0.42);
  ctx.closePath();
  ctx.fillStyle = BONUS_OLIVE_DEEP;
  ctx.fill();

  // Cap.
  ctx.beginPath();
  ctx.rect(-s * 0.13, -s * 0.48, s * 0.26, s * 0.14);
  ctx.fillStyle = BONUS_TUNA;
  ctx.fill();
  ctx.stroke();
}

/** Chopsticks: the only item made of daylight and straight lines. */
function drawChopsticks(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const stick = (offset: number, lean: number) => {
    ctx.beginPath();
    ctx.moveTo(offset * s - lean * s, -s * 0.42);
    ctx.lineTo(offset * s + lean * s, s * 0.42);
    ctx.strokeStyle = BONUS_EDGE;
    ctx.lineWidth = Math.max(2, s * 0.17);
    ctx.stroke();
    ctx.strokeStyle = BONUS_PAPER_DARK;
    ctx.lineWidth = Math.max(1, s * 0.11);
    ctx.stroke();
    // Lacquered tip, at the eating end.
    ctx.beginPath();
    ctx.moveTo(offset * s + lean * s * 0.45, s * 0.16);
    ctx.lineTo(offset * s + lean * s, s * 0.42);
    ctx.strokeStyle = BONUS_TUNA;
    ctx.lineWidth = Math.max(1, s * 0.11);
    ctx.stroke();
  };
  // Splayed, so the gap between them is unmistakable rather than a single thick bar.
  stick(-0.13, -0.07);
  stick(0.13, 0.07);
}

/** Nori: a wide sheet whose top-right corner has rolled up. */
function drawNori(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = BONUS_EDGE;

  ctx.beginPath();
  ctx.moveTo(-s * 0.42, -s * 0.3);
  ctx.lineTo(s * 0.16, -s * 0.3);
  // The curl: the corner peels back on itself.
  ctx.quadraticCurveTo(s * 0.3, -s * 0.34, s * 0.34, -s * 0.16);
  ctx.quadraticCurveTo(s * 0.38, -s * 0.02, s * 0.42, -s * 0.06);
  ctx.lineTo(s * 0.42, s * 0.3);
  ctx.lineTo(-s * 0.42, s * 0.3);
  ctx.closePath();
  ctx.fillStyle = BONUS_BAMBOO;
  ctx.fill();
  ctx.stroke();

  // Underside of the roll, so the curl reads as depth and not as a dent.
  ctx.beginPath();
  ctx.moveTo(s * 0.16, -s * 0.3);
  ctx.quadraticCurveTo(s * 0.34, -s * 0.3, s * 0.34, -s * 0.14);
  ctx.strokeStyle = BONUS_BONE;
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.stroke();

  // Two pinholes. Skipped when they would be sub-pixel mush.
  if (s >= 20) {
    ctx.fillStyle = BONUS_EDGE;
    for (const [hx, hy] of [
      [-0.2, -0.06],
      [0.02, 0.14],
    ]) {
      ctx.beginPath();
      ctx.arc(hx * s, hy * s, Math.max(0.75, s * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Sake cup: the pedestal foot is the read. */
function drawSake(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = BONUS_EDGE;

  // Foot first, so the bowl sits over its stem.
  ctx.beginPath();
  ctx.moveTo(-s * 0.1, s * 0.1);
  ctx.lineTo(-s * 0.22, s * 0.36);
  ctx.lineTo(s * 0.22, s * 0.36);
  ctx.lineTo(s * 0.1, s * 0.1);
  ctx.closePath();
  ctx.fillStyle = BONUS_STEAMED;
  ctx.fill();
  ctx.stroke();

  // Flared bowl.
  ctx.beginPath();
  ctx.moveTo(-s * 0.36, -s * 0.24);
  ctx.lineTo(-s * 0.13, s * 0.14);
  ctx.lineTo(s * 0.13, s * 0.14);
  ctx.lineTo(s * 0.36, -s * 0.24);
  ctx.closePath();
  ctx.fillStyle = BONUS_STEAMED;
  ctx.fill();
  ctx.stroke();

  // Open rim — an ellipse, so the cup reads as a vessel and not as a wedge.
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.24, s * 0.36, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = BONUS_PORCELAIN;
  ctx.fill();
  ctx.stroke();
}

/** Chili: the only curve on the board. */
function drawChili(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = BONUS_EDGE;

  // Pod: fat at the shoulder, tapering to a point that hooks back.
  ctx.beginPath();
  ctx.moveTo(-s * 0.14, -s * 0.24);
  ctx.quadraticCurveTo(s * 0.26, -s * 0.16, s * 0.24, s * 0.16);
  ctx.quadraticCurveTo(s * 0.22, s * 0.42, s * 0.02, s * 0.4);
  ctx.quadraticCurveTo(-s * 0.06, s * 0.36, -s * 0.02, s * 0.14);
  ctx.quadraticCurveTo(s * 0.02, -s * 0.08, -s * 0.14, -s * 0.24);
  ctx.closePath();
  ctx.fillStyle = BONUS_TUNA;
  ctx.fill();
  ctx.stroke();

  // Stem, kinked AGAINST the bend of the pod so the two curves do not merge into one.
  ctx.beginPath();
  ctx.moveTo(-s * 0.12, -s * 0.22);
  ctx.quadraticCurveTo(-s * 0.32, -s * 0.3, -s * 0.28, -s * 0.44);
  ctx.strokeStyle = BONUS_EDGE;
  ctx.lineWidth = Math.max(2, s * 0.13);
  ctx.stroke();
  ctx.strokeStyle = BONUS_BAMBOO;
  ctx.lineWidth = Math.max(1, s * 0.085);
  ctx.stroke();
}

/** Sesame: three of them, because "more than one" is itself the silhouette. */
function drawSesame(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.strokeStyle = BONUS_EDGE;
  const seed = (x: number, y: number, angle: number) => {
    ctx.save();
    ctx.translate(x * s, y * s);
    ctx.rotate(angle);
    ctx.beginPath();
    // Teardrop: one end blunt, one end pointed. A sesame seed is not a circle.
    ctx.moveTo(-s * 0.17, 0);
    ctx.quadraticCurveTo(-s * 0.04, -s * 0.13, s * 0.17, 0);
    ctx.quadraticCurveTo(-s * 0.04, s * 0.13, -s * 0.17, 0);
    ctx.closePath();
    ctx.fillStyle = BONUS_BONE;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  seed(-0.16, -0.2, -0.35);
  seed(0.19, -0.05, 0.42);
  seed(-0.08, 0.24, -0.12);
}

const BONUS_ART: readonly ((ctx: CanvasRenderingContext2D, s: number) => void)[] = [
  drawSoy,
  drawChopsticks,
  drawNori,
  drawSake,
  drawChili,
  drawSesame,
];

/**
 * Draw a bonus item centred on the origin, at `size` pixels per tile. Used both on the
 * board and for the HUD's level-indicator strip, so there is exactly one definition of
 * what each item looks like.
 */
export function drawBonusItem(
  ctx: CanvasRenderingContext2D,
  kind: number,
  size: number,
): void {
  const art = BONUS_ART[kind];
  if (!art) return;
  ctx.save();
  art(ctx, size);
  ctx.restore();
}

/**
 * The item on the board. `bob` is 0..1 from the host and gives it a slow rise and fall —
 * one more channel separating it from everything else on a busy board, and stilled under
 * reduced motion by passing a constant.
 */
export function drawBonus(
  ctx: CanvasRenderingContext2D,
  bonus: { x: number; y: number; ticks: number },
  kind: number,
  tilePx: number,
  bob: number,
): void {
  if (bonus.ticks <= 0) return;
  const px = (bonus.x / SUB) * tilePx;
  const py = (bonus.y / SUB) * tilePx + (bob - 0.5) * tilePx * 0.1;
  ctx.save();
  ctx.translate(px, py);
  drawBonusItem(ctx, kind, tilePx);
  ctx.restore();
}

// --- interstitials ----------------------------------------------------------

/**
 * The two cutscenes, drawn procedurally from the SAME sprite functions the game uses.
 * That is the whole trick and the reason these are cheap: no new art, no timeline format,
 * no asset. A cutscene here is two characters, a horizontal position each, and a caption.
 *
 * `progress` is 0..1 and comes from the host's own clock — cutscenes consume no simulation
 * ticks (see game.ts) so nothing here can desync a run.
 *
 *   0  THE THEFT     the Rat hauls a stolen grain off to the left, the player in pursuit
 *                    and not gaining. It sets up the debt.
 *   1  THE RECKONING the player comes back the other way, mouth wide, and the Rat is the
 *                    one running. It pays it off.
 */
export function drawCutscene(
  ctx: CanvasRenderingContext2D,
  index: number,
  progress: number,
  widthPx: number,
  heightPx: number,
  tilePx: number,
  animate: boolean,
): void {
  const t = Math.max(0, Math.min(1, progress));
  const lane = heightPx * 0.5;
  // Travel from fully off one edge to fully off the other, so nobody pops in or out.
  const span = widthPx + tilePx * 6;
  const revenge = index === CUTSCENE_REVENGE_INDEX;

  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, widthPx, heightPx);

  // A single floor line, so the characters are running along something.
  ctx.strokeStyle = "#2a4d8f";
  ctx.lineWidth = Math.max(1, tilePx * 0.09);
  ctx.beginPath();
  ctx.moveTo(0, lane + tilePx * 0.62);
  ctx.lineTo(widthPx, lane + tilePx * 0.62);
  ctx.stroke();

  // Distance travelled, and which way. The chase runs left in the first beat and right in
  // the second, which is what makes the pair read as a reversal rather than a repeat.
  const travelled = t * span;
  const leadX = revenge ? -tilePx * 3 + travelled : widthPx + tilePx * 3 - travelled;
  const chaseX = revenge ? leadX - tilePx * 3.4 : leadX + tilePx * 3.4;
  const dir: Dir = revenge ? RIGHT : LEFT;

  // The bob is on the same clock as everything else, and flat under reduced motion.
  const hop = animate ? Math.abs(Math.sin(t * Math.PI * 9)) * tilePx * 0.16 : 0;

  if (revenge) {
    // The player leads, the Rat flees. Drawn in that order so the pursuer is on top.
    drawCutscenePest(ctx, chaseX, lane - hop, tilePx, dir, true);
    drawCutscenePlayer(ctx, leadX, lane, tilePx, dir, animate ? t : 0, 1.35);
  } else {
    // The Rat leads with the stolen grain; the player trails.
    drawCutscenePest(ctx, leadX, lane - hop, tilePx, dir, false);
    drawStolenGrain(ctx, leadX + tilePx * 0.75, lane + tilePx * 0.1, tilePx);
    drawCutscenePlayer(ctx, chaseX, lane, tilePx, dir, animate ? t : 0, 1);
  }

  ctx.restore();
}

/** Index of the second cutscene. Mirrors CUTSCENE_REVENGE in levels.ts. */
const CUTSCENE_REVENGE_INDEX = 1;

function drawCutscenePest(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tilePx: number,
  dir: Dir,
  frightened: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  if (dir === LEFT) ctx.scale(-1, 1);
  const size = tilePx * 1.6;
  const fill = frightened ? FRIGHT_FILL : PEST_BODY[0];
  const edge = frightened ? FRIGHT_EDGE : PEST_EDGE;
  PEST_ART[0](ctx, size, fill, edge);
  const e = PEST_EYES[0];
  eyePair(ctx, size, RIGHT, e.x, e.y, e.spread, e.r);
  ctx.restore();
}

function drawCutscenePlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tilePx: number,
  dir: Dir,
  phase: number,
  scale: number,
): void {
  // A throwaway Player: drawPlayer only reads position, facing and distance, and the
  // distance drives the chomp, so a synthetic value animates the mouth correctly.
  const size = tilePx * 1.6 * scale;
  drawPlayer(
    ctx,
    {
      x: (x / size) * SUB,
      y: (y / size) * SUB,
      dir,
      wanted: -1,
      moveAcc: 0,
      distance: Math.round(phase * SUB * 14),
      blocked: false,
      freeze: 0,
      glideSteps: 0,
      glideFrom: dir,
      glideBack: false,
    } as Player,
    size,
    true,
  );
}

/** The grain the Rat has made off with. */
function drawStolenGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tilePx: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, tilePx * 0.34, tilePx * 0.19, 0, 0, Math.PI * 2);
  ctx.fillStyle = GRAIN_FILL;
  ctx.fill();
  ctx.strokeStyle = BONUS_EDGE;
  ctx.lineWidth = Math.max(1, tilePx * 0.06);
  ctx.stroke();
  ctx.restore();
}

/** The value of a collected item, hanging in the air where it was taken. */
export function drawBonusScore(
  ctx: CanvasRenderingContext2D,
  bonus: { x: number; y: number; scoreTicks: number; scoreValue: number },
  tilePx: number,
  totalTicks: number,
): void {
  if (bonus.scoreTicks <= 0) return;
  const t = 1 - bonus.scoreTicks / totalTicks;
  const px = (bonus.x / SUB) * tilePx;
  const py = (bonus.y / SUB) * tilePx - t * tilePx * 0.8;
  ctx.save();
  ctx.font = `600 ${Math.round(tilePx * 0.62)}px ui-rounded, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, tilePx * 0.16);
  ctx.strokeStyle = BONUS_EDGE;
  ctx.strokeText(String(bonus.scoreValue), px, py);
  ctx.fillStyle = BONUS_STEAMED;
  ctx.fillText(String(bonus.scoreValue), px, py);
  ctx.restore();
}
