/**
 * Swipe recognition, and the latency number that decides whether swipe can be the
 * DEFAULT control or only the fallback.
 *
 * ── WHAT THIS MEASURES, AND WHAT IT CANNOT ──────────────────────────────────────
 * Recognition latency is `MIN_TRAVEL_PX / finger velocity`, rounded up to the next
 * touch sample. Both terms are knowable: the threshold is ours, and the sample rate
 * is the device's. **Finger velocity is not** — it belongs to a real thumb on a real
 * phone, and nothing in a node process can supply it.
 *
 * So this suite measures the half that is arithmetic: latency AS A FUNCTION of finger
 * speed, in cells of travel, at tier 1 and tier 7. It reports a break-even velocity —
 * the speed below which a turn lands more than a cell late — and the shipped client
 * carries the instrumentation that produces the real distribution from a real
 * playtest.
 *
 * A simulated median presented as a measured one would be exactly the instrument
 * error this project keeps writing down. The number below is a model. It is labelled
 * as a model.
 */
import { describe, it, expect } from "vitest";
import { TICK_HZ, TIERS, ticksPerStepFor } from "@/lib/grainsnake/rules";
import { DOWN, LEFT, RIGHT, UP } from "@/lib/grainsnake/types";
import {
  AMBIGUITY_RATIO,
  MIN_TRAVEL_PX,
  beginSwipe,
  endSwipe,
  feedSwipe,
  wasTap,
} from "@/components/grainsnake/swipe";

const TICK_MS = 1000 / TICK_HZ;
/** Ticks per step at each end of the curve. */
const TIER1_TICKS = TIERS[0].ticksPerStep;
const TIER7_TICKS = TIERS[TIERS.length - 1].ticksPerStep;
const CELL_MS_TIER1 = TIER1_TICKS * TICK_MS;
const CELL_MS_TIER7 = TIER7_TICKS * TICK_MS;

/** Touch sample intervals seen in the wild: 60 Hz and 120 Hz digitisers. */
const SAMPLE_MS = [1000 / 60, 1000 / 120];

/**
 * Drive a straight drag at a constant velocity and return the recognition latency.
 * Samples are quantised, which is the point — a device cannot report a crossing
 * between samples, so real latency is always rounded up to one.
 */
function latencyFor(velocityPxPerMs: number, sampleMs: number): number | null {
  const s = beginSwipe(0, 0, 0);
  for (let t = sampleMs; t <= 2000; t += sampleMs) {
    const r = feedSwipe(s, velocityPxPerMs * t, 0, t);
    if (r.dir !== null) return r.latencyMs;
  }
  return null;
}

describe("swipe recognition", () => {
  it("fires mid-gesture, not on lift", () => {
    const s = beginSwipe(100, 100, 0);
    const r = feedSwipe(s, 100 + MIN_TRAVEL_PX + 1, 100, 20);
    expect(r.dir).toBe(RIGHT);
    // ...and it did not need a touchend to say so.
    expect(s.down).toBe(true);
  });

  it("reports all four directions", () => {
    const d = MIN_TRAVEL_PX + 2;
    expect(feedSwipe(beginSwipe(0, 0, 0), d, 0, 10).dir).toBe(RIGHT);
    expect(feedSwipe(beginSwipe(0, 0, 0), -d, 0, 10).dir).toBe(LEFT);
    expect(feedSwipe(beginSwipe(0, 0, 0), 0, d, 10).dir).toBe(DOWN);
    expect(feedSwipe(beginSwipe(0, 0, 0), 0, -d, 10).dir).toBe(UP);
  });

  it("says nothing below the travel threshold", () => {
    const s = beginSwipe(0, 0, 0);
    expect(feedSwipe(s, MIN_TRAVEL_PX - 1, 0, 10).dir).toBeNull();
  });

  it("says nothing while the stroke is ambiguous", () => {
    // A 45° drag is not a move this game has, and reporting one would be a guess.
    const s = beginSwipe(0, 0, 0);
    const d = MIN_TRAVEL_PX * 3;
    expect(feedSwipe(s, d, d, 10).dir).toBeNull();
    // Committing to an axis resolves it.
    expect(feedSwipe(s, d * AMBIGUITY_RATIO + MIN_TRAVEL_PX, d, 20).dir).toBe(RIGHT);
  });

  it("RE-ANCHORS, so one unbroken drag traces a whole route", () => {
    // The property that lets a player enter a corner without lifting off.
    const s = beginSwipe(0, 0, 0);
    const d = MIN_TRAVEL_PX + 2;
    expect(feedSwipe(s, d, 0, 10).dir).toBe(RIGHT);
    expect(feedSwipe(s, d, d, 20).dir).toBe(DOWN);
    expect(feedSwipe(s, d - d, d, 30).dir).toBe(LEFT);
  });

  it("a stroke with no direction in it is a TAP", () => {
    const s = beginSwipe(50, 50, 0);
    feedSwipe(s, 52, 51, 10);
    endSwipe(s);
    expect(wasTap(s)).toBe(true);
  });

  it("a stroke that turned is not a tap", () => {
    const s = beginSwipe(50, 50, 0);
    feedSwipe(s, 50 + MIN_TRAVEL_PX + 1, 50, 10);
    endSwipe(s);
    expect(wasTap(s)).toBe(false);
  });

  it("owns no engine rule — a reversal is recognised and handed on regardless", () => {
    // The recogniser reports what the finger did. Whether that input is LEGAL is the
    // engine's to decide, and a second opinion here is a second opinion that drifts.
    const s = beginSwipe(0, 0, 0);
    const d = MIN_TRAVEL_PX + 2;
    expect(feedSwipe(s, d, 0, 10).dir).toBe(RIGHT);
    expect(feedSwipe(s, -d * 2, 0, 20).dir).toBe(LEFT);
  });
});

describe("recognition latency — the number that decides the default control", () => {
  it("is bounded by one touch sample however fast the finger is", () => {
    for (const sample of SAMPLE_MS) {
      const l = latencyFor(50, sample); // absurdly fast flick
      expect(l).not.toBeNull();
      expect(l!).toBeLessThanOrEqual(sample + 1e-9);
    }
  });

  it("stays under one cell at tier 7 for every plausible finger speed", () => {
    // THE SHIPPABILITY TEST. A turn that lands more than a cell late is a turn the
    // player will read as a dropped input.
    //
    // 0.3 px/ms is a deliberate, slow, short drag — the slowest thing a player does
    // on purpose. Anything slower is not a swipe, it is a rest.
    const SLOWEST_DELIBERATE = 0.3;
    for (const sample of SAMPLE_MS) {
      const l = latencyFor(SLOWEST_DELIBERATE, sample)!;
      const cells = l / CELL_MS_TIER7;
      expect(cells, `${l.toFixed(1)}ms is ${cells.toFixed(2)} cells at tier 7`).toBeLessThan(1);
    }
  });

  it("CONTROL: RICE CHOMP's 22px threshold would NOT pass at tier 7", () => {
    // Run it against the failure. The threshold was not picked by feel, and this is
    // the assertion that says so: the inherited value is measurably too slow here,
    // and would put a slow drag's turn a cell and a bit past the junction.
    const CHOMP_TRAVEL = 22;
    const sample = 1000 / 60;
    const velocity = 0.3;
    let t = sample;
    while (velocity * t < CHOMP_TRAVEL) t += sample;
    const cells = t / CELL_MS_TIER7;
    expect(cells, "22px would have been fine, so the smaller threshold is unjustified").toBeGreaterThan(1);
  });

  it("the tier-1 budget is roomy — the problem is entirely at speed", () => {
    const l = latencyFor(0.3, 1000 / 60)!;
    expect(l / CELL_MS_TIER1).toBeLessThan(0.5);
  });

  it("the tier table still has the ticks/step this analysis assumes", () => {
    // If someone retunes the curve, the latency argument above needs redoing. This is
    // the tripwire that says so.
    expect(ticksPerStepFor(0)).toBe(TIER1_TICKS);
    expect(TIER7_TICKS).toBe(4);
    expect(CELL_MS_TIER7).toBeCloseTo(66.67, 1);
  });
});
