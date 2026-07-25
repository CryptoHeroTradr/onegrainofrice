/**
 * Rice-bowl canvas engine — self-contained, NO physics library.
 *
 * A heightfield "sandpile": each column tracks the pile height above the bowl's
 * curved floor. Spawned grains fall under gravity, land on their column's top,
 * and obey a simple angle-of-repose rule (roll to a much-lower neighbour) so a
 * convincing mound forms. Once a column reaches its rim/mound cap, further
 * grains overflow the lip and tumble down to pile on the ground OUTSIDE the
 * bowl — nothing is thrown away. Grains dropped outside the bowl opening (a
 * click beside the bowl) likewise fall to the ground and heap on the floor at
 * the bottom of the canvas.
 *
 * Grains fall from wherever they were released (the character, or the exact
 * click point) rather than always from the top, so a tap on the mascot reads as
 * rice pouring down out of it.
 *
 * Settled grains are painted ONCE onto offscreen canvases (O(1) per grain) and
 * blitted each frame; only the bounded set of falling grains is re-drawn per
 * frame, so it holds ~60fps under rapid clicking with no unbounded allocation.
 */

// --- grain sizing -----------------------------------------------------------
// The landing-page grain is a tiny ellipse (RicePile.tsx: rx≈4 → ~8px long
// axis). GRAIN_SIZE is the long-axis footprint here; ~2.5× larger so grains
// read clearly in the bowl.
export const GRAIN_SIZE = 20; // long axis (px)
export const GRAIN_WIDTH = 9; // short axis (px)
const GRAIN_STEP = 6; // pile height added per settled grain (px)

// --- tunables ---------------------------------------------------------------
const GRAVITY = 3400; // px/s^2 — brisk fall so grains rain down rapidly
const SPAWN_VY = 260; // initial downward speed (px/s) for a snappy release
const MAX_FALLING = 200; // animating falling grains cap (excess settle instantly)
const REPOSE = GRAIN_STEP * 2.3; // neighbour must be this much lower to roll
const MOUND_PEAK = GRAIN_SIZE * 2.6; // how far the centre may heap above the rim
// (also how far the mascot can ride up as the pile grows past the rim)
const EDGE_INSET = GRAIN_SIZE; // floor sits this far below rim at the walls
const SPAWN_TOP = 6; // fallback y grains start from (px from canvas top)
const GROUND_CAP_GAP = GRAIN_SIZE; // ground stops piling this far below the rim
const PREFILL_MAX = 1400; // cap grains materialised for a returning visitor

type OnFull = "overflow" | "ground" | "none";

interface Grain {
  x: number;
  y: number;
  vy: number;
  vx: number;
  rot: number;
  hue: number; // 0..1 jitter
  col: number; // target bowl column (ignored for ground grains — recomputed from x)
  alpha: number;
  ground: boolean; // heading for the floor outside the bowl, not the bowl
}

function grainFill(hue: number): string {
  // Off-white / beige with slight per-grain variation.
  const h = 44 + hue * 12; // 44–56 (warm cream)
  const s = 26 + hue * 10;
  const l = 84 + hue * 8; // 84–92%
  return `hsl(${h} ${s}% ${l}%)`;
}

function drawGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rot: number,
  hue: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.ellipse(0, 0, GRAIN_SIZE / 2, GRAIN_WIDTH / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = grainFill(hue);
  ctx.fill();
  // Soft edge + a hint of highlight for dimension (cheap).
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(120,110,70,0.28)";
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-GRAIN_SIZE * 0.12, -GRAIN_WIDTH * 0.16, GRAIN_SIZE * 0.24, GRAIN_WIDTH * 0.18, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();
  ctx.restore();
}

export class RiceBowl {
  private W = 0;
  private H = 0;

  // bowl geometry
  private centerX = 0;
  private halfW = 0;
  private rimY = 0;
  private bottomY = 0;
  private rimRy = 0;
  private cols = 0;
  private colW = 0;
  private floorYc: Float32Array = new Float32Array(0);
  private capYc: Float32Array = new Float32Array(0);
  private pile: Float32Array = new Float32Array(0);

  // ground (floor outside the bowl) geometry
  private groundCols = 0;
  private groundColW = 0;
  private groundBaseY = 0;
  private groundPile: Float32Array = new Float32Array(0);

  private falling: Grain[] = [];

  // A returning visitor's seeded total, remembered so a resize (which rebuilds
  // geometry and clears the piles) can re-materialise it rather than lose it.
  private prefillCount = 0;

  // Settled-grain layers, painted once each: `off` is clipped to the bowl
  // interior; `groundOff` is the unclipped floor pile outside the bowl.
  private off: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private groundOff: HTMLCanvasElement | null = null;
  private groundOffCtx: CanvasRenderingContext2D | null = null;

  reducedMotion = false;

  resize(W: number, H: number, dpr: number): void {
    this.W = W;
    this.H = H;
    this.buildGeometry();

    // (Re)create the offscreen settled layers at device resolution.
    this.off = this.makeLayer(W, H, dpr);
    this.offCtx = this.off.getContext("2d");
    if (this.offCtx) this.offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.groundOff = this.makeLayer(W, H, dpr);
    this.groundOffCtx = this.groundOff.getContext("2d");
    if (this.groundOffCtx) this.groundOffCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Geometry changed → reset the visual piles (the authoritative counter lives
    // in the WS hook and is unaffected). Resizes are rare.
    this.pile = new Float32Array(this.cols);
    this.groundPile = new Float32Array(this.groundCols);
    this.falling.length = 0;

    // Re-seed the returning-visitor pile into the fresh geometry.
    if (this.prefillCount > 0) this.applyPrefill(this.prefillCount);
  }

  private makeLayer(W: number, H: number, dpr: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(W * dpr));
    c.height = Math.max(1, Math.round(H * dpr));
    return c;
  }

  private buildGeometry(): void {
    const { W, H } = this;
    this.centerX = W / 2;
    const bowlW = Math.max(240, Math.min(W * 0.72, 620));
    this.halfW = bowlW / 2;
    this.rimRy = bowlW * 0.1;

    // Anchor the bowl to the BOTTOM of the canvas with a fixed depth, so the
    // canvas can be tall (grains fall a long way from the character above) while
    // the bowl still sits on the floor. The body curve dips ~0.35·rimRy below
    // `bottomY`, so place bottomY that far up and the rounded base rests exactly
    // on the canvas' bottom edge (no cutoff).
    const bodyH = Math.min(H * 0.6, bowlW * 0.6);
    this.bottomY = H - this.rimRy * 0.35;
    this.rimY = this.bottomY - bodyH;

    this.colW = GRAIN_SIZE * 0.5;
    this.cols = Math.max(8, Math.floor(bowlW / this.colW));
    this.colW = bowlW / this.cols;

    this.floorYc = new Float32Array(this.cols);
    this.capYc = new Float32Array(this.cols);
    const shallow = this.rimY + EDGE_INSET; // floor y at the walls
    for (let c = 0; c < this.cols; c++) {
      const dx = this.colX(c) - this.centerX;
      const t = dx / this.halfW; // -1..1
      this.floorYc[c] = this.bottomY - (this.bottomY - shallow) * t * t;
      this.capYc[c] = this.rimY - MOUND_PEAK * Math.max(0, 1 - t * t);
    }

    // Ground floor spans the full canvas width; grains heap up from the bottom.
    this.groundColW = GRAIN_SIZE * 0.5;
    this.groundCols = Math.max(8, Math.floor(W / this.groundColW));
    this.groundColW = W / this.groundCols;
    this.groundBaseY = H;
  }

  private colX(c: number): number {
    return this.centerX - this.halfW + (c + 0.5) * this.colW;
  }

  private colAt(x: number): number {
    const left = this.centerX - this.halfW;
    const c = Math.floor((x - left) / this.colW);
    return Math.max(0, Math.min(this.cols - 1, c));
  }

  private surfaceY(c: number): number {
    return this.floorYc[c] - this.pile[c];
  }

  private groundColX(gc: number): number {
    return (gc + 0.5) * this.groundColW;
  }

  private groundColAt(x: number): number {
    const gc = Math.floor(x / this.groundColW);
    return Math.max(0, Math.min(this.groundCols - 1, gc));
  }

  private groundSurfaceY(gc: number): number {
    return this.groundBaseY - this.groundPile[gc];
  }

  /** Is this canvas x inside the bowl's opening (vs. beside it on the floor)? */
  private insideOpening(x: number): boolean {
    return x >= this.centerX - this.halfW && x <= this.centerX + this.halfW;
  }

  /**
   * Spawn one grain. `x` is the release point (canvas x); `originY` is the
   * canvas y it falls FROM (e.g. the character's position) — defaults to the
   * top. A release beside the bowl heaps on the floor instead of in the bowl.
   */
  spawn(x: number, originY?: number): void {
    const ground = !this.insideOpening(x);
    if (this.reducedMotion || this.falling.length >= MAX_FALLING) {
      // Bound the animating set / honour reduced motion: settle instantly.
      if (ground) this.depositGround(this.groundColAt(x), Math.random(), Math.random() * Math.PI);
      else this.deposit(this.colAt(x), Math.random(), Math.random() * Math.PI);
      return;
    }
    const startY = originY == null ? SPAWN_TOP : Math.max(SPAWN_TOP, originY);
    // In-bowl grains aim for the current lowest open column so they land where
    // the bowl is filling (a natural scatter), not always at the drop point.
    let col: number;
    let baseX: number;
    if (ground) {
      col = this.groundColAt(x);
      baseX = x;
    } else {
      const drop = this.colAt(x);
      const target = this.lowestOpenColumn(drop);
      col = target < 0 ? drop : target;
      baseX = this.colX(col);
    }
    this.falling.push({
      x: baseX + (Math.random() - 0.5) * this.colW,
      y: startY + Math.random() * 10,
      vy: SPAWN_VY,
      vx: 0,
      rot: Math.random() * Math.PI,
      hue: Math.random(),
      col,
      alpha: 1,
      ground,
    });
  }

  /** Advance falling grains by dt seconds. */
  step(dt: number): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const g = this.falling[i];
      g.vy += GRAVITY * dt;
      g.y += g.vy * dt;
      g.x += g.vx * dt;
      if (g.ground) {
        // Land on the floor beneath the grain's current x (overflow grains arc).
        const gc = this.groundColAt(g.x);
        if (g.y >= this.groundSurfaceY(gc) - GRAIN_STEP * 0.5) {
          this.depositGround(gc, g.hue, g.rot);
          this.falling.splice(i, 1);
        }
      } else {
        if (g.y >= this.surfaceY(g.col) - GRAIN_STEP * 0.5) {
          this.deposit(g.col, g.hue, g.rot);
          this.falling.splice(i, 1);
        }
      }
    }
  }

  /**
   * The lowest still-fillable column (greatest surfaceY = deepest point) that
   * won't exceed its cap when a grain is added. Ties (columns within ~a grain of
   * each other) are broken toward `preferCol`. Returns -1 when the bowl is full.
   *
   * Depositing into this column each time makes the rice fill like water: the
   * deepest points fill first, so the surface rises LEVEL across the whole bowl
   * (widening as it climbs). Because `capYc` is a dome (higher in the centre),
   * the shallow edges reach their cap first and later grains build a centre peak
   * before the bowl finally overflows.
   */
  private lowestOpenColumn(preferCol: number): number {
    const EPS = GRAIN_STEP * 0.75; // columns this close count as "equally low"
    let maxS = -Infinity;
    for (let i = 0; i < this.cols; i++) {
      if (this.surfaceY(i) - GRAIN_STEP < this.capYc[i]) continue; // no room left
      const s = this.surfaceY(i);
      if (s > maxS) maxS = s;
    }
    if (maxS === -Infinity) return -1; // every column is capped → bowl is full
    let target = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.cols; i++) {
      if (this.surfaceY(i) - GRAIN_STEP < this.capYc[i]) continue;
      if (this.surfaceY(i) >= maxS - EPS) {
        const d = Math.abs(i - preferCol);
        if (d < bestDist) {
          bestDist = d;
          target = i;
        }
      }
    }
    return target;
  }

  /**
   * Land a grain: it settles at the current lowest open point (water-fill, see
   * `lowestOpenColumn`) — `c` only nudges tie-breaks toward where it fell. When
   * the bowl is full, `onFull` decides its fate: "overflow" tumbles it over the
   * rim onto the floor (live clicks), "ground" heaps it there instantly
   * (prefill), "none" drops it.
   */
  private deposit(c: number, hue: number, rot: number, onFull: OnFull = "overflow"): void {
    const t = this.lowestOpenColumn(c);
    if (t < 0) {
      const side = Math.random() < 0.5 ? 0 : this.cols - 1; // spill over a random lip
      if (onFull === "overflow") this.overflowToGround(side, hue, rot);
      else if (onFull === "ground") this.overflowToGroundInstant(side, hue, rot);
      return;
    }
    const sc = this.surfaceY(t);
    if (this.offCtx) drawGrain(this.offCtx, this.colX(t), sc - GRAIN_STEP * 0.5, rot, hue);
    this.pile[t] += GRAIN_STEP;
  }

  /** Heap a grain onto the floor at ground column `gc` (with repose). */
  private depositGround(gc: number, hue: number, rot: number): void {
    let t = gc;
    for (let guard = 0; guard < this.groundCols; guard++) {
      const sc = this.groundSurfaceY(t);
      const leftLower = t > 0 && this.groundSurfaceY(t - 1) - sc > REPOSE;
      const rightLower = t < this.groundCols - 1 && this.groundSurfaceY(t + 1) - sc > REPOSE;
      if (leftLower && rightLower) t += this.groundSurfaceY(t - 1) > this.groundSurfaceY(t + 1) ? -1 : 1;
      else if (leftLower) t -= 1;
      else if (rightLower) t += 1;
      else break;
    }
    // Don't let the floor pile climb past the bowl rim (keeps the scene legible).
    if (this.groundSurfaceY(t) - GRAIN_STEP < this.rimY - GROUND_CAP_GAP) return;
    if (this.groundOffCtx) drawGrain(this.groundOffCtx, this.groundColX(t), this.groundSurfaceY(t) - GRAIN_STEP * 0.5, rot, hue);
    this.groundPile[t] += GRAIN_STEP;
  }

  /** Launch an animated overflow grain off the rim of column `c` toward the floor. */
  private overflowToGround(c: number, hue: number, rot: number): void {
    if (this.falling.length >= MAX_FALLING) {
      this.overflowToGroundInstant(c, hue, rot);
      return;
    }
    const dir = this.colX(c) >= this.centerX ? 1 : -1;
    this.falling.push({
      x: this.centerX + dir * this.halfW,
      y: this.rimY,
      vy: -20 - Math.random() * 30,
      vx: dir * (40 + Math.random() * 60),
      rot,
      hue,
      col: c,
      alpha: 1,
      ground: true,
    });
  }

  /** Settle an overflow grain on the floor just outside the rim, no animation. */
  private overflowToGroundInstant(c: number, hue: number, rot: number): void {
    const dir = this.colX(c) >= this.centerX ? 1 : -1;
    const x = this.centerX + dir * (this.halfW + GRAIN_SIZE * (0.5 + Math.random() * 3));
    this.depositGround(this.groundColAt(x), hue, rot);
  }

  /**
   * Materialise `n` already-earned grains at once (a returning visitor's saved
   * total), filling the bowl and spilling the surplus onto the floor — no
   * animation. Resets any existing visual pile first.
   */
  prefill(n: number): void {
    this.prefillCount = Math.max(0, Math.floor(n));
    this.pile.fill(0);
    this.groundPile.fill(0);
    this.offCtx?.clearRect(0, 0, this.W, this.H);
    this.groundOffCtx?.clearRect(0, 0, this.W, this.H);
    this.falling.length = 0;
    this.applyPrefill(this.prefillCount);
  }

  private applyPrefill(n: number): void {
    const target = Math.min(n, PREFILL_MAX);
    for (let i = 0; i < target; i++) {
      this.deposit(Math.floor(Math.random() * this.cols), Math.random(), Math.random() * Math.PI, "ground");
    }
  }

  /**
   * The three wall curves from the LEFT rim down and around to the RIGHT rim.
   * Assumes the current path point is already at (cx-hw, rimY) — it only appends
   * curves (no beginPath), so it can be spliced into a larger clip path.
   */
  private bowlWalls(ctx: CanvasRenderingContext2D): void {
    const { centerX: cx, halfW: hw, rimY, bottomY } = this;
    ctx.quadraticCurveTo(cx - hw * 1.04, (rimY + bottomY) / 2, cx - hw * 0.16, bottomY);
    ctx.quadraticCurveTo(cx, bottomY + this.rimRy * 0.7, cx + hw * 0.16, bottomY);
    ctx.quadraticCurveTo(cx + hw * 1.04, (rimY + bottomY) / 2, cx + hw, rimY);
  }

  private bowlBodyPath(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.moveTo(this.centerX - this.halfW, this.rimY);
    this.bowlWalls(ctx);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { W, H, centerX: cx, halfW: hw, rimY, rimRy } = this;
    ctx.clearRect(0, 0, W, H);

    // --- bowl body: darker translucent grey so cream grains read clearly ---
    this.bowlBodyPath(ctx);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, rimY, 0, this.bottomY);
    grad.addColorStop(0, "rgba(96,96,98,0.30)");
    grad.addColorStop(1, "rgba(70,70,72,0.40)");
    ctx.fillStyle = grad;
    ctx.fill();
    // Back rim (far lip) — a darker translucent ellipse behind the pile.
    ctx.beginPath();
    ctx.ellipse(cx, rimY, hw, rimRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(88,88,90,0.36)";
    ctx.fill();

    // --- settled pile (clipped to the bowl interior + the peak zone above the
    //     rim). Build ONE continuous path: down the left wall extension, around
    //     the bowl walls, up the right wall extension, then close across the top.
    //     (bowlWalls appends — it must NOT reset the path, or the top edge would
    //     collapse into a diagonal and clip the upper corners of the pile.) ---
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - hw, rimY - MOUND_PEAK - 20);
    ctx.lineTo(cx - hw, rimY);
    this.bowlWalls(ctx); // current point is at (cx-hw, rimY) → append the walls
    ctx.lineTo(cx + hw, rimY - MOUND_PEAK - 20);
    ctx.closePath();
    ctx.clip();
    if (this.off) ctx.drawImage(this.off, 0, 0, W, H);
    // Falling grains already inside the bowl.
    for (const g of this.falling) if (!g.ground && g.y >= rimY) drawGrain(ctx, g.x, g.y, g.rot, g.hue);
    ctx.restore();

    // --- front rim (near lip) over the pile ---
    ctx.beginPath();
    ctx.ellipse(cx, rimY, hw, rimRy, 0, 0, Math.PI, false);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#2a4d8f"; // --color-porcelain (canvas needs a literal)
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, rimY, hw, rimRy, 0, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(42,77,143,0.35)";
    ctx.stroke();

    // --- bowl-bound grains still in the air (above the rim) ---
    for (const g of this.falling) if (!g.ground && g.y < rimY) drawGrain(ctx, g.x, g.y, g.rot, g.hue);

    // --- floor pile outside the bowl (settled), then ground-bound grains still falling ---
    if (this.groundOff) ctx.drawImage(this.groundOff, 0, 0, W, H);
    for (const g of this.falling) if (g.ground) drawGrain(ctx, g.x, g.y, g.rot, g.hue, Math.max(0, g.alpha));
  }

  /** Whether anything is currently animating (used to idle the rAF loop). */
  get active(): boolean {
    return this.falling.length > 0;
  }

  /**
   * Canvas-space y at which the mascot's feet should rest: on the front rim by
   * default, rising with the pile once it mounds above the rim near the centre
   * (where the mascot stands). Smaller y = higher on screen.
   *
   * Averages a NARROW band directly under his feet. It used to take the MINIMUM
   * (i.e. the highest point) across the whole middle third of the bowl, so a
   * single tall spike anywhere in that band snapped him up to its height — he
   * rose long before the pile beneath him had actually grown, and hung in the air
   * above the rice. Averaging a band the width of his stance plants him on the
   * surface he is actually standing on, and it rises smoothly with the pile.
   */
  mascotFeetY(): number {
    if (this.cols === 0) return this.rimY;

    // Half-width of his footing, in columns (≈12% of the bowl, min 1 column).
    const half = Math.max(1, Math.round(this.cols * 0.06));
    const mid = Math.floor(this.cols / 2);
    const lo = Math.max(0, mid - half);
    const hi = Math.min(this.cols, mid + half + 1);

    let sum = 0;
    let n = 0;
    for (let c = lo; c < hi; c++) {
      sum += this.surfaceY(c);
      n++;
    }
    const surface = n > 0 ? sum / n : this.rimY;

    // Sit on the rim until the pile under him actually pushes above it.
    return Math.min(this.rimY, surface);
  }
}
