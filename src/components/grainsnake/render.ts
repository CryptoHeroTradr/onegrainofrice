/**
 * GRAINSNAKE — painting. Floats live here and nowhere else.
 *
 * The simulation is cell-grained and integer-only; this file is the layer that is
 * allowed to interpolate, and everything it computes is thrown away every frame. It
 * reads state and never writes it.
 *
 * NO RULE IS RE-IMPLEMENTED HERE. Board size, cell geometry and the golden-grain
 * budget all come from `@/lib/grainsnake/rules`. If this file ever needs to know
 * something the engine knows, it imports it.
 *
 * ── THE THREE RULES FROM THE SPEC'S HARD CONSTRAINTS ────────────────────────────
 * 1. **The head renders LAGGING.** At fraction f it is drawn between the cell it came
 *    from and the cell the simulation has already put it in — never between its
 *    current cell and a predicted next one. Extrapolating along the direction vector
 *    draws the head *inside the wall* on the step before the collision resolves, so
 *    the player watches the death happen a frame after it visibly already had.
 * 2. **Each segment interpolates toward its SUCCESSOR CELL**, `cell[i-1]` — where the
 *    segment ahead of it actually is — not along the head's direction. Aiming every
 *    segment along one vector makes the whole body cut the corner on the tick a
 *    buffered turn lands: the turn is in the state, the body is drawn as if it were
 *    not, and for one step the snake is a diagonal.
 * 3. **Pause and game over freeze the fraction**, not only the accumulator. Two
 *    freezes: the host stops adding wall-clock, and `f` is held at its last value.
 *    Freezing only the first leaves a paused snake visibly still sliding between
 *    cells, and a dead one still gliding into the wall that killed it.
 */

import { CELL_COUNT, COLS, GOLDEN_STEPS, ROWS } from "@/lib/grainsnake/rules";
import { segmentAt, vacatedCell } from "@/lib/grainsnake/engine";
import type { GameState } from "@/lib/grainsnake/types";
import { NO_TRAIL_FX, type TrailFx } from "./fx";

// ---------------------------------------------------------------------------
// Palette — from globals.css's @theme. No new colours.
// ---------------------------------------------------------------------------

const PADDY_FILL = "#14110d"; // nori
/**
 * ── THE EDGE READS AS PASSABLE, NOT AS A BUND. ──────────────────────────────────
 * *Changed 2026-08-08 with the wrap.* This used to be `rgba(42,77,143,0.30)` —
 * porcelain — painted as one unbroken `strokeRect` around the field: an inset lip, a
 * raised paddy bund, the thing you do not cross. That was correct while the edge was
 * fatal and it is now actively misleading, because a player who believes the edge
 * kills will avoid a side of the board that is not merely safe but is a route, and the
 * routes are the wrap's entire gameplay contribution.
 *
 * It is the beaded-trail argument in reverse: there the picture under-reported a
 * hazard, here it reported one that does not exist, and both are *the player steers
 * off the picture, not off the model*.
 *
 * What replaces it is a tick at every cell BOUNDARY and nothing along the cell itself,
 * so each row and each column ends in a visible opening — a row of doorways rather
 * than a wall. Olive-deep rather than porcelain: dimmer than what it replaces, because
 * the board is read at 15 cells a second and the edge is decoration. The palette rule
 * that the paddy may not drift lighter covers its border too.
 */
const SEAM_TICK = "rgba(71,77,46,0.75)"; // olive-deep, dim
const GRAIN_FILL = "#eae3d2"; // paper
const GRAIN_SPINE = "#fbf7ee"; // steamed
const GRAIN_RIM = "#474d2e"; // olive-deep
const HEAD_FILL = "#fbf7ee"; // steamed
const HEAD_RIM = "#c4b370"; // khaki
const HEAD_EYE = "#14110d"; // nori
const FOOD_FILL = "#c4b370"; // khaki
const GOLDEN_FILL = "#f4a08a"; // salmon
const GOLDEN_RIM = "#c1443a"; // tuna

// The conical hat, exactly as RICE CHOMP draws it.
const HAT_CONE = "#c4b370"; // khaki
const HAT_BRIM = "#d9cfb8"; // paper-dark
const HAT_EDGE = "#474d2e"; // olive-deep
const HAT_RIDGE = "#6a6c3a"; // olive
const HAT_HALF_WIDTH = 0.38;
const HAT_HEIGHT = 0.34;
const HAT_X = -0.2;
const HAT_Y = -0.24;
const HAT_TILT = -0.42;
const EYE_X = 0.08;
const EYE_Y = -0.16;

/**
 * ── THE TRAIL READS AS FUSED GRAINS, NOT AS SEPARATED BEADS. ────────────────────
 * *Required by the spec's* Rendering the trail *— a Phase 3 renderer requirement,
 * and it is a gameplay requirement rather than a cosmetic one.*
 *
 * The size gate drew one grain per cell, sized to sit INSIDE it, and the result was a
 * row of individually legible grains with visible gaps between them. Gaps invite a
 * read the rules do not support — *could I have slipped through that?* — and the
 * answer is always no, because the body occupies whole cells and there is no gap in
 * the collision model at all. The player steers off the picture, not the model, so a
 * death into a space that looked passable is an unfair-feeling death, and at tier 7
 * there is no time to reason about it.
 *
 * `SEG_LONG` is therefore over half a cell: consecutive grains overlap along the
 * travel axis until their rims merge and the silhouette is continuous.
 *
 * **The short axis does NOT grow.** Overlapping on both axes thickens the trail into
 * a rope; only the long axis may exceed the cell.
 */
const SEG_LONG = 0.62; // > 0.5, so consecutive grains overlap and the rims merge
const SEG_SHORT = 0.29; // unchanged — a fatter short axis is a rope, not a snake
/**
 * The head obeys the same rule, and it needs stating because 0.5 is the tempting
 * value and it is wrong: at exactly half a cell the head's rim TOUCHES its neighbour
 * rather than overlapping it, which puts the one visible gap in the trail at the one
 * place the player is looking. Caught 2026-08-07 by `grainsnake-render.test.ts`.
 */
const HEAD_LONG = 0.54;
const HEAD_SHORT = 0.32;

/**
 * Per-segment jitter, so a fused trail is still visibly MADE OF individual grains.
 *
 * Without it the fix for the gaps creates the failure the gate was built to catch: a
 * perfectly uniform overlapping chain is an extrusion — a smooth tube with a hat on
 * it — which is the exact outcome the art direction exists to prevent.
 *
 * ── IT IS KEYED ON THE RING POSITION, AND THAT IS THE WHOLE TRICK. ──────────────
 * The obvious key is the segment's index from the head, and it shimmers: a physical
 * grain's distance from the head changes every single step, so its jitter would
 * change every step and the whole trail would crawl. The ring slot a segment was
 * written into never changes for that segment's entire life, so hashing it gives a
 * grain one silhouette from the moment it is eaten to the moment it is dropped.
 *
 * Deterministic and integer-derived: no `Math.random`, nothing per-frame, nothing
 * that could differ between two paints of the same state.
 */
function jitterFor(ringPos: number): { long: number; rot: number } {
  let h = (ringPos * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = (h * 2246822519) >>> 0;
  h ^= h >>> 13;
  h = (h * 3266489917) >>> 0;
  h ^= h >>> 16;
  const a = (h & 0xffff) / 0xffff;
  const b = ((h >>> 16) & 0xffff) / 0xffff;
  return { long: (a - 0.5) * 0.07, rot: (b - 0.5) * 0.22 };
}

// ---------------------------------------------------------------------------
// Geometry helpers (render-side; floats are fine here)
// ---------------------------------------------------------------------------

/**
 * ── THE SEAM. EVERYTHING BELOW EXISTS BECAUSE THE BOARD WRAPS. ──────────────────
 * *Added 2026-08-08 with `ENGINE_VERSION` 2.*
 *
 * The renderer interpolates every grain from the cell it came from to the cell it is
 * in. A grain that has just wrapped came from column 22 and is in column 0, and the
 * straight line between those two **streaks the full width of the board** — one grain
 * flying backwards across the whole screen, once per wrap, which is both wrong and the
 * most eye-catching thing on the page.
 *
 * The fix is two halves and both are needed:
 *   1. Interpolate along the SHORTEST path on the torus (`wrapDelta`), so a wrapping
 *      grain travels one cell outward past the edge instead of 22 cells backward.
 *   2. Draw that grain a second time, offset by exactly one board width or height, so
 *      it enters one side as it leaves the other (`forEachWrapCopy`).
 *
 * Not clipping and not snapping: a clipped grain is a hole in the trail at the seam —
 * which reads as a gap the player could steer through, the exact unfair-feeling death
 * the fused-trail rule exists to prevent — and a snapped one teleports.
 */

/** The signed one-axis step from `a` to `b` by the shortest way round a ring of `n`. */
function wrapDelta(a: number, b: number, n: number): number {
  let d = b - a;
  if (d > n / 2) d -= n;
  else if (d < -n / 2) d += n;
  return d;
}

/** Interpolated position in CELL units — may sit outside the board by up to one cell. */
function lerpCell(from: number, to: number, f: number): { x: number; y: number } {
  const ax = (from % COLS) + 0.5;
  const ay = Math.floor(from / COLS) + 0.5;
  return {
    x: ax + wrapDelta(ax, (to % COLS) + 0.5, COLS) * f,
    y: ay + wrapDelta(ay, Math.floor(to / COLS) + 0.5, ROWS) * f,
  };
}

/**
 * Call `draw` once per visible copy of a grain at cell-space `(x, y)`.
 *
 * Normally that is exactly one call. A grain straddling an edge gets two; a grain
 * straddling a CORNER gets four, which is why the two axes are offered independently
 * rather than as a single edge test — a corner is where both axes wrap on consecutive
 * steps, and an implementation that handles one axis at a time still gets the pair
 * wrong. Costs at most three extra ellipse draws per frame in total.
 */
function forEachWrapCopy(
  x: number,
  y: number,
  px: number,
  draw: (x: number, y: number) => void,
): void {
  // One cell of slack: a grain's long axis is 0.62 of a cell, so anything further
  // inside the board than that cannot have a visible copy on the far side.
  const xs = x < 1 ? [x, x + COLS] : x > COLS - 1 ? [x, x - COLS] : [x];
  const ys = y < 1 ? [y, y + ROWS] : y > ROWS - 1 ? [y, y - ROWS] : [y];
  for (const cxx of xs) for (const cyy of ys) draw(cxx * px, cyy * px);
}

/**
 * The angle from `from` to `to`, or `fallback` when they are the same cell.
 *
 * Wrap-aware, and it has to be: raw column subtraction across a seam gives -22 and
 * `atan2` turns that into a head pointing back the way it came — the snake spinning
 * 180° for one step every time it crosses an edge.
 */
function angleBetween(from: number, to: number, fallback: number): number {
  if (from === to || from < 0 || to < 0) return fallback;
  const dx = wrapDelta(from % COLS, to % COLS, COLS);
  const dy = wrapDelta(Math.floor(from / COLS), Math.floor(to / COLS), ROWS);
  return Math.atan2(dy, dx);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Verbatim port of RICE CHOMP's `drawHat()`, including the sub-20px seam skip. */
function drawHat(ctx: CanvasRenderingContext2D, px: number): void {
  const hw = px * HAT_HALF_WIDTH;
  const hh = px * HAT_HEIGHT;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, px * 0.045);
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

  // Below ~20px the straw seam is sub-pixel and is skipped rather than smeared into a
  // grey haze. At the ~15px cell this board implies on a phone, it is always skipped —
  // which is why the hat's legibility is a matter of CONTRAST and not of detail. See
  // the palette constraint in the spec's *Hard constraints*.
  if (px >= 20) {
    ctx.beginPath();
    ctx.moveTo(0, -hh * 0.86);
    ctx.lineTo(0, -hh * 0.06);
    ctx.strokeStyle = HAT_RIDGE;
    ctx.lineWidth = Math.max(0.75, px * 0.022);
    ctx.stroke();
  }
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  px: number,
  angle: number,
  ringPos: number,
  /**
   * A transient multiplier for the newest segment growing in. 1 for every other
   * segment and by default, so `SEG_LONG`, the short axis, the draw order and the
   * jitter keying are all exactly what the gate validated.
   */
  grow = 1,
): void {
  const j = jitterFor(ringPos);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + j.rot);

  const rx = px * (SEG_LONG + j.long) * grow;
  const ry = px * SEG_SHORT * grow;

  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = GRAIN_FILL;
  ctx.fill();
  ctx.lineWidth = Math.max(1, px * 0.055);
  ctx.strokeStyle = GRAIN_RIM;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(-rx * 0.1, -ry * 0.32, rx * 0.62, ry * 0.27, 0, 0, Math.PI * 2);
  ctx.fillStyle = GRAIN_SPINE;
  ctx.fill();

  ctx.restore();
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  px: number,
  angle: number,
  /** Head pop on eat, 0..1. Scales BOTH axes, so the head swells rather than stretches. */
  pop = 0,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Small on purpose: the head must stay the same shape a player tracks at 15 cells
  // a second, and a big pop reads as the head changing size rather than reacting.
  const swell = 1 + pop * 0.16;
  ctx.beginPath();
  ctx.ellipse(0, 0, px * HEAD_LONG * swell, px * HEAD_SHORT * swell, 0, 0, Math.PI * 2);
  ctx.fillStyle = HEAD_FILL;
  ctx.fill();
  ctx.lineWidth = Math.max(1, px * 0.05);
  ctx.strokeStyle = HEAD_RIM;
  ctx.stroke();

  ctx.save();
  ctx.translate(HAT_X * px, HAT_Y * px);
  ctx.rotate(HAT_TILT);
  drawHat(ctx, px);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(EYE_X * px, EYE_Y * px, Math.max(1, px * 0.055), 0, Math.PI * 2);
  ctx.fillStyle = HEAD_EYE;
  ctx.fill();

  ctx.restore();
}

function drawFood(
  ctx: CanvasRenderingContext2D,
  cell: number,
  px: number,
  fill: string,
  rim: string | null,
  scale: number,
): void {
  const x = ((cell % COLS) + 0.5) * px;
  const y = (Math.floor(cell / COLS) + 0.5) * px;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.45); // a grain lies at an angle, never axis-aligned
  ctx.beginPath();
  ctx.ellipse(0, 0, px * 0.34 * scale, px * 0.19 * scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (rim) {
    ctx.lineWidth = Math.max(1, px * 0.06);
    ctx.strokeStyle = rim;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The board's edge, drawn as openings rather than as a boundary.
 *
 * One short tick at each cell BOUNDARY on all four sides, and nothing across the cell
 * itself — so every row ends in a gap on the left and the right, and every column ends
 * in a gap top and bottom. There is no continuous line anywhere on the field.
 *
 * The ticks are the SAME on opposing sides by construction, because both are drawn from
 * the same boundary index: the gap in row 7 on the left lines up with the gap in row 7
 * on the right, which is where a grain leaving one arrives at the other.
 */
function drawSeamEdge(ctx: CanvasRenderingContext2D, px: number): void {
  const w = COLS * px;
  const h = ROWS * px;
  const len = px * 0.3; // well short of a cell, so the opening dominates the mark
  ctx.save();
  ctx.strokeStyle = SEAM_TICK;
  ctx.lineWidth = Math.max(1, px * 0.06);
  ctx.lineCap = "butt";
  ctx.beginPath();
  for (let r = 0; r <= ROWS; r++) {
    const y = Math.round(r * px) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(len, y);
    ctx.moveTo(w - len, y);
    ctx.lineTo(w, y);
  }
  for (let c = 0; c <= COLS; c++) {
    const x = Math.round(c * px) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, len);
    ctx.moveTo(x, h - len);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/**
 * Paint one frame.
 *
 * `f` is the interpolation fraction in [0, 1] — how far through the current step the
 * renderer should draw. The HOST owns it, holds it frozen while paused or dead, and
 * passes 1 when the player prefers reduced motion (which snaps to cell positions
 * without altering a single rule).
 */
export function paint(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  px: number,
  f: number,
  /**
   * Transient scales from the fx layer. DEFAULTS TO A NO-OP — with no argument this
   * function draws exactly what it drew before feedback existed, which is what keeps
   * `test/grainsnake-render.test.ts` measuring the gate-validated geometry.
   */
  fx: TrailFx = NO_TRAIL_FX,
): void {
  const w = COLS * px;
  const h = ROWS * px;

  ctx.fillStyle = PADDY_FILL;
  ctx.fillRect(0, 0, w, h);
  drawSeamEdge(ctx, px);

  // Food first, so the snake is drawn over it as it arrives.
  if (state.grain >= 0) drawFood(ctx, state.grain, px, FOOD_FILL, null, 1);
  if (state.golden >= 0) {
    // The golden grain pulses toward nothing as its travel budget runs out — a size
    // cue rather than a colour one, because colour is doing enough work already.
    const left = state.goldenSteps / GOLDEN_STEPS;
    drawFood(ctx, state.golden, px, GOLDEN_FILL, GOLDEN_RIM, 0.85 + 0.35 * left);
  }

  /**
   * Draw TAIL → HEAD, and the order is load-bearing for the fused look: each grain's
   * rim is painted over the previous grain's fill, so the overlap shows as an arc
   * between neighbours instead of a seam. Drawn head-first, the newest grain would sit
   * UNDER its neighbour and the trail would read back-to-front.
   */
  const vacated = vacatedCell(state);

  /**
   * Where physical grain `j` (0 = head) is travelling FROM.
   *
   * Every grain moves into the cell the grain ahead of it is leaving, so grain `j`
   * comes from `cell[j+1]` — RULE 2, and it is a pure read of the body's own history.
   * The tail has no `cell[j+1]`; its origin is the cell it vacated. When that is not
   * recoverable — the snake grew this step, so the tail did not move at all — the
   * grain is drawn static, which in a fused trail is invisible and is never a guess.
   */
  const originOf = (j: number, to: number): number => {
    if (j <= state.length - 2) return segmentAt(state, j + 1);
    return vacated >= 0 ? vacated : to;
  };

  for (let j = state.length - 1; j >= 1; j--) {
    const to = segmentAt(state, j);
    const from = originOf(j, to);
    const ringPos = (state.headPos - j + CELL_COUNT) % CELL_COUNT;
    // Only the NEWEST segment grows in. It is the tail rather than the head, because
    // eating holds the tail still for a step — so the new grain appears at the back.
    const grow = j === state.length - 1 ? fx.tailGrow : 1;
    const p = lerpCell(from, to, f);
    const angle = angleBetween(from, to, 0);
    // BOTH EDGES. Every segment resolves its own copies, which is what keeps a fused
    // trail fused across the seam: the grain behind is still drawn at the edge the
    // grain ahead is leaving, so their rims merge there exactly as they do anywhere.
    forEachWrapCopy(p.x, p.y, px, (x, y) => drawSegment(ctx, x, y, px, angle, ringPos, grow));
  }

  // RULE 1: the head LAGS. `segmentAt(1)` is the cell it came FROM — the body is its
  // own history — so this is a read, never an extrapolation. There is deliberately no
  // code path in this file that computes a "next" cell.
  const headCell = segmentAt(state, 0);
  const cameFrom = originOf(0, headCell);
  const hp = lerpCell(cameFrom, headCell, f);
  const headAngle = angleBetween(cameFrom, headCell, 0);
  forEachWrapCopy(hp.x, hp.y, px, (x, y) => drawHead(ctx, x, y, px, headAngle, fx.headPop));
}
