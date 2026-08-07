"use client";

/**
 * GRAINSNAKE — the swipe-latency instrument.
 *
 * HOST CODE, and it measures the host. It records the tick a touch began against the
 * tick `steer()` was actually called, which is the only number that decides whether
 * swipe can be the default control or has to be the fallback.
 *
 * ── WHY THIS SHIPS RATHER THAN LIVING IN A TEST ─────────────────────────────────
 * `test/grainsnake-swipe.test.ts` computes latency as `MIN_TRAVEL_PX / velocity`,
 * rounded up to a touch sample, and that half is arithmetic. **Finger velocity is
 * not.** It belongs to a real thumb on a real phone, and no node process can supply
 * it — so the suite reports a MODEL and this reports the measurement.
 *
 * Latency is expressed in CELLS, not milliseconds, because a cell is what the player
 * experiences: at tier 1 a cell is 167 ms and at tier 7 it is 67 ms, so the same
 * 33 ms of recognition is a fifth of a cell at the bottom of the curve and half a cell
 * at the top. Milliseconds would hide the entire problem.
 *
 * It costs the simulation nothing: `record()` is two integers pushed onto an array,
 * called at most once per touch, and nothing here is read by a rule.
 */

import { TIERS, ticksPerStepFor } from "@/lib/grainsnake/rules";

export interface LatencySample {
  /** Ticks between the touch starting and `steer()` being called. */
  ticks: number;
  /** Ticks per step at the moment of the turn — i.e. which tier the player was in. */
  ticksPerStep: number;
}

const samples: LatencySample[] = [];
/** A cap, so a long session cannot grow this without bound. */
const MAX_SAMPLES = 2000;

export function recordLatency(startTick: number, firedTick: number, foodEaten: number): void {
  if (samples.length >= MAX_SAMPLES) return;
  const ticks = firedTick - startTick;
  if (ticks < 0) return; // a touch that spanned a restart; not a reading
  samples.push({ ticks, ticksPerStep: ticksPerStepFor(foodEaten) });
}

export function resetLatency(): void {
  samples.length = 0;
}

export interface LatencyBucket {
  ticksPerStep: number;
  n: number;
  medianCells: number;
  p90Cells: number;
  worstCells: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[i];
}

/** Latency grouped by tier, in cells of travel. */
export function latencyByTier(): LatencyBucket[] {
  const byStep = new Map<number, number[]>();
  for (const s of samples) {
    const cells = s.ticks / s.ticksPerStep;
    const list = byStep.get(s.ticksPerStep) ?? [];
    list.push(cells);
    byStep.set(s.ticksPerStep, list);
  }
  return [...byStep.entries()]
    .sort((a, b) => b[0] - a[0]) // slowest tier (most ticks/step) first
    .map(([ticksPerStep, cells]) => {
      const sorted = cells.slice().sort((a, b) => a - b);
      return {
        ticksPerStep,
        n: sorted.length,
        medianCells: quantile(sorted, 0.5),
        p90Cells: quantile(sorted, 0.9),
        worstCells: sorted[sorted.length - 1] ?? 0,
      };
    });
}

/**
 * Print the distribution. Called at game over, so a playtest produces the number
 * without anyone having to remember to ask for it.
 *
 * **THE SHIPPABILITY LINE IS ONE CELL AT TIER 7.** Above it, a turn lands past the
 * junction the player aimed at, and they read that as the game dropping inputs rather
 * than as their own timing. If that shows up here, swipe is the fallback and the
 * d-pad is the default — not a threshold to tune by feel.
 */
export function reportLatency(): void {
  const buckets = latencyByTier();
  if (buckets.length === 0) return;
  const fastest = TIERS[TIERS.length - 1].ticksPerStep;

  const rows = buckets.map((b) => ({
    tier: `${b.ticksPerStep} ticks/step`,
    turns: b.n,
    "median cells": b.medianCells.toFixed(2),
    "p90 cells": b.p90Cells.toFixed(2),
    "worst cells": b.worstCells.toFixed(2),
  }));
  console.log("[grainsnake] swipe latency, in cells of travel (MEASURED, this device):");
  console.table(rows);

  const top = buckets.find((b) => b.ticksPerStep === fastest);
  if (top && top.n >= 5 && top.medianCells > 1) {
    console.warn(
      `[grainsnake] SWIPE IS NOT SHIPPABLE AS THE DEFAULT ON THIS DEVICE: median ` +
        `${top.medianCells.toFixed(2)} cells at ${fastest} ticks/step, over ${top.n} turns. ` +
        `A turn landing more than a cell late reads as a dropped input. Make the d-pad the default.`,
    );
  }
}
