"use client";

/**
 * GRAINSNAKE — swipe recognition. Pure, DOM-free, and deliberately not a gesture
 * recogniser.
 *
 * HOST CODE, and it produces exactly one thing: a `Dir` to hand to the engine's
 * `steer()`. It contains no rule — no reversal check, no buffering, no started flag.
 * Those are the engine's and touch does not get its own copy of them, for the same
 * reason the keyboard does not.
 *
 * ── THE PROBLEM THIS EXISTS TO SOLVE ────────────────────────────────────────────
 * At tier 7 a step is 4 ticks — **67 ms per cell**. A recogniser that waits for a
 * completed gesture, or for a large distance to accumulate, does not report the turn
 * until the snake has already passed the junction the player aimed at. The player
 * does not experience that as their own timing; they experience it as the game
 * dropping inputs, and they are not wrong to — the input WAS late, the game just
 * wasn't the one that made it late.
 *
 * So recognition fires on **direction of travel as soon as it is unambiguous**, at a
 * small distance, mid-gesture. Not on lift, not on a velocity threshold, not on a
 * completed stroke.
 *
 * ── THE TWO NUMBERS, AND WHY THEY ARE NOT FEEL ──────────────────────────────────
 * `MIN_TRAVEL_PX` is the entire latency budget: recognition cannot happen before the
 * finger has moved that far, so latency is `MIN_TRAVEL_PX / finger velocity`, rounded
 * up to the next touch sample. That makes it arithmetic rather than taste, and
 * `test/grainsnake-swipe.test.ts` computes the resulting latency in CELLS at tier 7
 * across a range of finger speeds.
 *
 * RICE CHOMP uses 22px, and 22px is measurably wrong here: a deliberate, slow drag at
 * 0.3 px/ms takes 73 ms to cover it, which at tier 7 is **1.1 cells of travel** — the
 * turn lands past the junction. 10px costs a slow finger 33 ms, which is half a cell,
 * and the floor is one touch sample (~17 ms at 60 Hz) however fast the finger is.
 * Chomp can afford 22px because its player moves at 8 tiles/sec, not 15, and because
 * a maze junction is forgiving in a way a snake's own trail is not.
 *
 * `AMBIGUITY_RATIO` is what keeps a small threshold from turning finger jitter into
 * turns: the dominant axis must beat the other one by this factor before the stroke
 * counts as having a direction at all. A diagonal drag reports nothing until it
 * commits, which is correct — a diagonal is not a move this game has.
 */

import { DOWN, LEFT, RIGHT, UP, type Dir } from "@/lib/grainsnake/types";

/**
 * CSS pixels of travel before a stroke has a direction. THE LATENCY BUDGET.
 * See the header: this number is `latency × velocity`, not a preference.
 */
export const MIN_TRAVEL_PX = 10;

/** How far the dominant axis must beat the other before the stroke has committed. */
export const AMBIGUITY_RATIO = 1.4;

export interface SwipeTracker {
  /** Anchor, in CSS pixels. Re-set on every recognised turn. */
  ax: number;
  ay: number;
  /** Timestamp of the current anchor, in ms. Host clock — never the simulation's. */
  at: number;
  /** True between touchstart and touchend. */
  down: boolean;
  /** True once this stroke has produced at least one direction. */
  turned: boolean;
}

export function beginSwipe(x: number, y: number, t: number): SwipeTracker {
  return { ax: x, ay: y, at: t, down: true, turned: false };
}

export interface SwipeResult {
  /** The direction recognised on this sample, or null. */
  dir: Dir | null;
  /** Milliseconds from the current anchor to recognition. 0 when nothing fired. */
  latencyMs: number;
}

const NOTHING: SwipeResult = { dir: null, latencyMs: 0 };

/**
 * Feed a move sample. Returns a direction the instant the stroke is unambiguous.
 *
 * **RE-ANCHORS ON EVERY TURN**, which is what makes one unbroken drag able to trace a
 * whole route — down, right, up — without lifting off. A scheme that needs a separate
 * flick per turn cannot enter a corner early, and entering corners early is the only
 * skill this game's controls have to express.
 */
export function feedSwipe(s: SwipeTracker, x: number, y: number, t: number): SwipeResult {
  if (!s.down) return NOTHING;

  const dx = x - s.ax;
  const dy = y - s.ay;
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;

  const horizontal = adx >= ady;
  const dominant = horizontal ? adx : ady;
  const other = horizontal ? ady : adx;

  if (dominant < MIN_TRAVEL_PX) return NOTHING;
  if (dominant < other * AMBIGUITY_RATIO) return NOTHING;

  const dir: Dir = horizontal ? (dx > 0 ? RIGHT : LEFT) : dy > 0 ? DOWN : UP;
  const latencyMs = t - s.at;

  // Re-anchor HERE, not at the touch origin: the next leg of the drag is measured
  // from where the finger is now.
  s.ax = x;
  s.ay = y;
  s.at = t;
  s.turned = true;

  return { dir, latencyMs };
}

export function endSwipe(s: SwipeTracker): void {
  s.down = false;
}

/**
 * True when a finished stroke never produced a direction — a TAP.
 *
 * The host reads it as "get on with it": start the run, dismiss the game-over card.
 * It is not a rule and never reaches the engine.
 */
export function wasTap(s: SwipeTracker): boolean {
  return !s.turned;
}
