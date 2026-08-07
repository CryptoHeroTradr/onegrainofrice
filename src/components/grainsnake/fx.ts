"use client";

/**
 * GRAINSNAKE — husk particles, screen shake, and the two transient scales.
 *
 * ── THIS FILE DRAWS OVER THE TRAIL. IT NEVER DRAWS INTO IT. ─────────────────────
 * The fused trail passed a gate on a phone, and the four things that made it pass —
 * `SEG_LONG`, the short axis, the tail→head draw order, and jitter keyed on the ring
 * slot — are in `render.ts` and are not touched here. Particles are painted AFTER
 * `paint()` returns, as a separate pass over the same context.
 *
 * The only reach into the trail is a pair of transient SCALE multipliers (head pop,
 * new-segment grow-in), passed to `paint()` as an optional argument that defaults to
 * a no-op. They multiply a radius; they do not change which radius, in what order, or
 * with what jitter.
 *
 * ── EVERYTHING IS POOLED ────────────────────────────────────────────────────────
 * The acceptance criterion is 60 fps at maximum trail length on a phone, and the hot
 * loop must not allocate. Particles live in fixed `Float32Array`s allocated once;
 * spawning writes into a dead slot and never grows the pool. When the pool is full
 * the oldest burst is simply not replaced — dropping a particle is invisible, and a
 * GC pause at length 400 is not.
 *
 * ── NOTHING HERE IS SIMULATION ──────────────────────────────────────────────────
 * It has its own wall-clock and is driven by frame deltas, which is precisely why it
 * may: no rule reads any of it, and `test/grainsnake-audio.test.ts` asserts a run
 * observed by the fx layer is bit-identical to one that is not.
 */

import { COLS } from "@/lib/grainsnake/rules";

/** Hard ceiling. Twelve husks per burst, so this is ~40 concurrent bursts. */
const MAX_PARTICLES = 512;
const HUSKS_PER_EAT = 8;
const HUSKS_PER_GOLDEN = 14;
/** Death throws the whole trail, but bounded — a 500-segment scatter is a slideshow. */
const HUSKS_ON_DEATH = 90;

const PARTICLE_LIFE = 0.5; // seconds
const DEATH_LIFE = 0.9;

/** Husk colours — the same paper/khaki/salmon the board already uses. */
const HUSK = ["#eae3d2", "#c4b370", "#fbf7ee"];
const HUSK_GOLDEN = ["#f4a08a", "#c4b370", "#fbf7ee"];

export interface Fx {
  // Particle pool, parallel arrays. One allocation, reused forever.
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  hue: Uint8Array;
  golden: Uint8Array;
  count: number;

  /** Head pop, 1 → 0 over a short decay. Scales the head's long axis. */
  headPop: number;
  /** New-segment grow-in, 0 → 1. Scales the newest body segment. */
  tailGrow: number;
  /** Screen shake magnitude in CSS px, decaying. */
  shake: number;

  /** Deterministic per-spawn randomness — no `Math.random` in a paint path. */
  seed: number;
}

/** What `paint()` accepts. Defaults are a no-op, so the trail is untouched by default. */
export interface TrailFx {
  headPop: number;
  tailGrow: number;
}

export const NO_TRAIL_FX: TrailFx = { headPop: 0, tailGrow: 1 };

export function createFx(): Fx {
  return {
    x: new Float32Array(MAX_PARTICLES),
    y: new Float32Array(MAX_PARTICLES),
    vx: new Float32Array(MAX_PARTICLES),
    vy: new Float32Array(MAX_PARTICLES),
    life: new Float32Array(MAX_PARTICLES),
    maxLife: new Float32Array(MAX_PARTICLES),
    size: new Float32Array(MAX_PARTICLES),
    hue: new Uint8Array(MAX_PARTICLES),
    golden: new Uint8Array(MAX_PARTICLES),
    count: 0,
    headPop: 0,
    tailGrow: 1,
    shake: 0,
    seed: 0x9e3779b9,
  };
}

export function resetFx(fx: Fx): void {
  fx.count = 0;
  fx.life.fill(0);
  fx.headPop = 0;
  fx.tailGrow = 1;
  fx.shake = 0;
  fx.seed = 0x9e3779b9;
}

function rnd(fx: Fx): number {
  let x = fx.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  fx.seed = x | 0;
  return (x >>> 0) / 4294967296;
}

/** Find a dead slot, or -1 when the pool is saturated. */
function freeSlot(fx: Fx): number {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (fx.life[i] <= 0) return i;
  }
  return -1;
}

function spawn(fx: Fx, cx: number, cy: number, px: number, speed: number, life: number, golden: boolean): void {
  const i = freeSlot(fx);
  if (i < 0) return; // saturated: dropping a husk is invisible, a GC pause is not
  const a = rnd(fx) * Math.PI * 2;
  const v = speed * (0.4 + rnd(fx) * 0.8);
  fx.x[i] = cx;
  fx.y[i] = cy;
  fx.vx[i] = Math.cos(a) * v;
  fx.vy[i] = Math.sin(a) * v;
  fx.life[i] = life;
  fx.maxLife[i] = life;
  fx.size[i] = px * (0.05 + rnd(fx) * 0.06);
  fx.hue[i] = Math.floor(rnd(fx) * 3);
  fx.golden[i] = golden ? 1 : 0;
  if (i >= fx.count) fx.count = i + 1;
}

function cellCentre(cell: number, px: number): [number, number] {
  return [((cell % COLS) + 0.5) * px, (Math.floor(cell / COLS) + 0.5) * px];
}

/**
 * A grain was eaten: burst husks at the cell, pop the head, start the new segment
 * growing in.
 *
 * `reduced` short-circuits every animated part of it. THE CALLER STILL CALLS THIS —
 * the branch is here rather than at the call site so there is exactly one place that
 * decides what reduced motion means, and no path where half of it is skipped.
 */
export function burstEat(fx: Fx, cell: number, px: number, golden: boolean, reduced: boolean): void {
  // The grow-in is reset either way: without it a new segment would pop into
  // existence at full size, which is the thing this replaces rather than decorates.
  fx.tailGrow = reduced ? 1 : 0.35;
  if (reduced) return;
  fx.headPop = 1;
  const [cx, cy] = cellCentre(cell, px);
  const n = golden ? HUSKS_PER_GOLDEN : HUSKS_PER_EAT;
  for (let k = 0; k < n; k++) {
    spawn(fx, cx, cy, px, px * (golden ? 2.6 : 1.9), PARTICLE_LIFE, golden);
  }
}

/** A tier boundary: a short shake and nothing else. */
export function burstTierUp(fx: Fx, px: number, reduced: boolean): void {
  if (reduced) return;
  fx.shake = px * 0.16;
}

/** Death: scatter the trail and shake. */
export function burstDeath(fx: Fx, cells: number[], px: number, reduced: boolean): void {
  if (reduced) return;
  fx.shake = px * 0.42;
  // Bounded, and sampled ALONG the trail rather than truncated to its head — a
  // 500-segment snake that scatters only its first 90 cells looks like it broke.
  const stride = Math.max(1, Math.ceil(cells.length / HUSKS_ON_DEATH));
  for (let i = 0; i < cells.length; i += stride) {
    const [cx, cy] = cellCentre(cells[i], px);
    spawn(fx, cx, cy, px, px * 2.2, DEATH_LIFE, false);
  }
}

/** Advance every effect by a frame. `dt` is seconds of wall-clock, clamped by the host. */
export function stepFx(fx: Fx, dt: number, px: number): void {
  const drag = Math.exp(-dt * 4.5);
  let highest = 0;
  for (let i = 0; i < fx.count; i++) {
    if (fx.life[i] <= 0) continue;
    fx.life[i] -= dt;
    if (fx.life[i] <= 0) continue;
    fx.x[i] += fx.vx[i] * dt;
    fx.y[i] += fx.vy[i] * dt;
    fx.vx[i] *= drag;
    fx.vy[i] *= drag;
    // A little gravity, so husks settle rather than drifting forever.
    fx.vy[i] += px * 3.2 * dt;
    highest = i + 1;
  }
  fx.count = highest;

  fx.headPop = fx.headPop > 0 ? Math.max(0, fx.headPop - dt * 6) : 0;
  fx.tailGrow = fx.tailGrow < 1 ? Math.min(1, fx.tailGrow + dt * 5) : 1;
  fx.shake = fx.shake > 0.01 ? fx.shake * Math.exp(-dt * 9) : 0;
}

/** The scales `paint()` should apply this frame. */
export function trailFx(fx: Fx): TrailFx {
  return { headPop: fx.headPop, tailGrow: fx.tailGrow };
}

/**
 * Paint the husks. Called AFTER `paint()`, over the finished board.
 *
 * Squares rather than ellipses: at a 15px cell a husk is under a pixel across, an
 * arc there costs a path setup to draw one pixel, and `fillRect` is measurably
 * cheaper in the one loop that can run 500 times a frame.
 */
export function drawFx(ctx: CanvasRenderingContext2D, fx: Fx): void {
  for (let i = 0; i < fx.count; i++) {
    const l = fx.life[i];
    if (l <= 0) continue;
    const t = l / fx.maxLife[i];
    ctx.globalAlpha = t * t;
    ctx.fillStyle = (fx.golden[i] ? HUSK_GOLDEN : HUSK)[fx.hue[i]];
    const s = fx.size[i];
    ctx.fillRect(fx.x[i] - s * 0.5, fx.y[i] - s * 0.5, s, s);
  }
  ctx.globalAlpha = 1;
}

/** Current shake offset, in CSS px. Deterministic given the fx state. */
export function shakeOffset(fx: Fx): [number, number] {
  if (fx.shake <= 0) return [0, 0];
  return [(rnd(fx) - 0.5) * 2 * fx.shake, (rnd(fx) - 0.5) * 2 * fx.shake];
}
