/**
 * TETRICE — touch recognition. Pure, DOM-free, and deliberately not a gesture library.
 *
 * It converts pointer samples into the same edges the keyboard produces — `press`,
 * `release`, `nudge`, `pulse` — and hands them to the one `InputState` in
 * `controls.ts`. **There is no second path into the engine**: the thumb and the hands
 * charge the same DAS, are capped by the same ARR, and produce the same trace. A touch
 * layer with its own repeat logic would be a second implementation of the feel, and the
 * server-side replayer would have no way to tell which one recorded a run.
 *
 * ── THE FIVE GESTURES ───────────────────────────────────────────────────────────────
 * | gesture | result |
 * |---|---|
 * | horizontal drag past 10 px | move one cell, then the held-key schedule: DAS, then ARR |
 * | tap (no direction, < 300 ms) | rotate clockwise |
 * | two-finger tap | rotate counter-clockwise |
 * | drag down | soft drop while held |
 * | flick down (≥ 1.2 px/ms over ≥ 24 px) | hard drop |
 * | drag up past 10 px | hold |
 *
 * ── WHY A HORIZONTAL DRAG CHARGES DAS AT ALL ────────────────────────────────────────
 * The rule this implements is "one cell per swipe, and a held drag repeats at ARR", and
 * **those two clauses are only both true if something separates them.** Without a charge,
 * a swipe that lingers 150 ms past the threshold — an ordinary swipe — emits five cells,
 * and the first clause is false. DAS is what makes a swipe a swipe and a hold a hold, and
 * using the keyboard's own charge for it means there is one number to tune, not two.
 *
 * A drag that keeps travelling does not have to wait out that charge: every further 10 px
 * `nudge()`s the piece along, bounded by ARR (*controls.ts*). So the surface reads as
 * dragging the piece, and the ceiling on how fast it can move is the same one the
 * keyboard has.
 *
 * ── THE DOWNWARD STROKE IS NOT CLASSIFIED WHEN IT COMMITS ───────────────────────────
 * A soft drop and a hard drop are the same stroke; only speed separates them, and speed
 * is not knowable at the 10 px crossing — 10 px inside one touch sample already reads as
 * 0.6 px/ms whatever the thumb meant. So a downward commit opens a PENDING state that
 * settles one way exactly once, on the first of:
 *
 *   - **24 px travelled** — enough distance for velocity to mean something. Fast → hard
 *     drop; slow → soft drop.
 *   - **80 ms elapsed** — nothing still short of 24 px at 80 ms is a flick. Soft drop.
 *
 * The stroke is then locked to what it settled on for its whole life. A thumb that speeds
 * up mid-soft-drop does NOT become a hard drop: an irreversible action must be something
 * the player did, not something the recogniser inferred from a thumb that was already
 * moving.
 */

import { CONTROLS } from "./controls";
import type { HeldButton, PulseAction } from "./controls";

export type TouchEdge =
  | { readonly kind: "press"; readonly button: HeldButton }
  | { readonly kind: "release"; readonly button: HeldButton }
  | { readonly kind: "nudge"; readonly button: "Left" | "Right" }
  | { readonly kind: "pulse"; readonly action: PulseAction };

/** What a stroke has committed to. `null` while it is still only a touch. */
type Mode = null | "horizontal" | "pendingDown" | "softDrop" | "spent";

export interface TouchTracker {
  /** Where and when the stroke started. Velocity is measured from here, not per sample:
   *  a per-sample velocity is mostly digitiser noise at these distances. */
  readonly x0: number;
  readonly y0: number;
  readonly t0: number;
  /** Anchor for the next threshold crossing. Moves on every commit. */
  ax: number;
  ay: number;
  mode: Mode;
  dir: "Left" | "Right" | null;
  /** When the downward commit happened, for the 80 ms settle. */
  downAt: number;
  /** Most pointers seen down at once during this stroke. 2+ makes a tap counter-clockwise. */
  maxPointers: number;
  /** Pointers currently down. The stroke ends when this reaches zero. */
  pointers: number;
}

export function beginTouch(x: number, y: number, t: number): TouchTracker {
  return {
    x0: x,
    y0: y,
    t0: t,
    ax: x,
    ay: y,
    mode: null,
    dir: null,
    downAt: 0,
    maxPointers: 1,
    pointers: 1,
  };
}

/** A second finger arrived. Only the count matters — the extra pointer is not tracked. */
export function addPointer(s: TouchTracker): void {
  s.pointers += 1;
  if (s.pointers > s.maxPointers) s.maxPointers = s.pointers;
}

const NONE: readonly TouchEdge[] = [];

/**
 * Feed a move sample. Returns the edges it produced, in order.
 *
 * Recognition fires MID-GESTURE, at the threshold, never on lift — the same standard
 * GRAINSNAKE's recogniser is held to, and for the same reason: a control recognised on
 * release is a control that reports what the player wanted after the moment for it passed.
 */
export function feedTouch(s: TouchTracker, x: number, y: number, t: number): readonly TouchEdge[] {
  if (s.mode === "spent") return NONE;

  // A settled downward stroke ignores lateral wander: a thumb dragging down the screen
  // does not travel in a straight line, and a soft drop that also walked the piece two
  // columns sideways would be a control nobody could aim.
  if (s.mode === "softDrop") return NONE;
  if (s.mode === "pendingDown") return settleDown(s, x, y, t);

  const dx = x - s.ax;
  const dy = y - s.ay;
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;
  const horizontal = adx >= ady;
  const dominant = horizontal ? adx : ady;
  const other = horizontal ? ady : adx;

  if (dominant < CONTROLS.SWIPE_THRESHOLD_PX) return NONE;
  if (dominant < other * CONTROLS.SWIPE_AMBIGUITY_RATIO) return NONE;

  // Re-anchor at the crossing: the next 10 px is measured from here, which is what lets
  // one unbroken drag walk the piece across the well.
  s.ax = x;
  s.ay = y;

  if (horizontal) {
    const dir = dx > 0 ? "Right" : "Left";
    if (s.mode === "horizontal" && s.dir === dir) return [{ kind: "nudge", button: dir }];
    const out: TouchEdge[] = [];
    // A reversal releases the old direction first, so the repeat schedule restarts rather
    // than arriving mid-charge pointing the other way.
    if (s.dir && s.dir !== dir) out.push({ kind: "release", button: s.dir });
    s.mode = "horizontal";
    s.dir = dir;
    out.push({ kind: "press", button: dir });
    return out;
  }

  // Turning vertical mid-stroke lets go of the direction first: a drag that walked the
  // piece three columns and then went down must not leave `MoveRight` held for ever,
  // because the pointer will never send an `up` for a button the recogniser abandoned.
  const turned = s.mode === "horizontal";
  const letGo: TouchEdge[] = s.dir ? [{ kind: "release", button: s.dir }] : [];
  s.dir = null;

  if (dy < 0) {
    // Up: hold. One-shot, and the stroke is over as far as this file is concerned.
    s.mode = "spent";
    return [...letGo, { kind: "pulse", action: "Hold" }];
  }

  if (turned) {
    // **A HARD DROP IS A SINGLE BALLISTIC FLICK FROM TOUCHDOWN, NEVER THE TAIL OF AN
    // L-SHAPED DRAG.** Velocity here is measured from the stroke's origin, and after a
    // horizontal leg that number describes a journey the player did not make in one
    // direction. Rather than re-base it on a sample whose timestamp is a guess, a stroke
    // that has already moved the piece sideways can only ever soft drop. The player who
    // wants to slam lifts and flicks, which is one deliberate gesture instead of an
    // irreversible one inferred from a corner.
    s.mode = "softDrop";
    return [...letGo, { kind: "press", button: "SoftDrop" }];
  }

  s.mode = "pendingDown";
  s.downAt = t;
  return [...letGo, ...settleDown(s, x, y, t)];
}

/**
 * Decide what a downward stroke is, or wait for more evidence.
 *
 * Called from `feedTouch` and from `pollTouch`, because the deciding sample may never
 * arrive: a thumb that stops moving stops generating events, and a stroke that sat still
 * 10 px down is a soft drop that would otherwise wait for the lift.
 */
function settleDown(s: TouchTracker, x: number, y: number, t: number): readonly TouchEdge[] {
  const dx = x - s.x0;
  const dy = y - s.y0;
  const travel = Math.sqrt(dx * dx + dy * dy);
  const elapsed = t - s.t0;

  if (travel >= CONTROLS.FLICK_MIN_TRAVEL_PX) {
    const velocity = elapsed > 0 ? travel / elapsed : Infinity;
    if (velocity >= CONTROLS.FLICK_PX_PER_MS) {
      s.mode = "spent";
      return [{ kind: "pulse", action: "HardDrop" }];
    }
    s.mode = "softDrop";
    return [{ kind: "press", button: "SoftDrop" }];
  }

  if (t - s.downAt >= CONTROLS.FLICK_DECIDE_MS) {
    s.mode = "softDrop";
    return [{ kind: "press", button: "SoftDrop" }];
  }

  return NONE;
}

/**
 * Advance the stroke with no new sample. Call once per rendered frame while a touch is
 * down: it is what settles a pending downward stroke that stopped moving.
 */
export function pollTouch(s: TouchTracker, t: number): readonly TouchEdge[] {
  if (s.mode !== "pendingDown") return NONE;
  return settleDown(s, s.ax, s.ay, t);
}

/**
 * A finger lifted. Returns the edges for it, and whether the stroke is finished.
 *
 * The stroke ends when the LAST pointer lifts, not the first — a two-finger tap is one
 * gesture, and treating each finger as its own would rotate twice.
 */
export function endTouch(s: TouchTracker, t: number): { events: readonly TouchEdge[]; done: boolean } {
  s.pointers -= 1;
  if (s.pointers > 0) return { events: NONE, done: false };

  const out: TouchEdge[] = [];
  if (s.mode === "horizontal" && s.dir) {
    out.push({ kind: "release", button: s.dir });
  } else if (s.mode === "softDrop") {
    out.push({ kind: "release", button: "SoftDrop" });
  } else if (s.mode === "pendingDown") {
    // Lifted before the stroke settled: a short downward nudge, which is a soft drop of
    // one row rather than nothing. Press and release in the same breath — `InputState`
    // gives every press its own move.
    out.push({ kind: "press", button: "SoftDrop" }, { kind: "release", button: "SoftDrop" });
  } else if (s.mode === null && t - s.t0 <= CONTROLS.TAP_MAX_MS) {
    // A TAP: a stroke that never found a direction. Two fingers make it counter-clockwise.
    out.push({ kind: "pulse", action: s.maxPointers >= 2 ? "RotateCCW" : "RotateCW" });
  }
  s.mode = "spent";
  return { events: out, done: true };
}
