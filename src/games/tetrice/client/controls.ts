/**
 * TETRICE — the control layer. DOM-FREE AND FRAME-DRIVEN.
 *
 * This is the Phase 4 input layer the engine and the input log were both written around:
 * `docs/tetrice-spec.md` (*Hard constraints*, *Controls*) puts DAS and ARR **here**, never
 * in `engine/`. The engine sees a set of discrete actions on a numbered tick and knows
 * nothing about a key being held; this file is the only thing that knows.
 *
 * ── EVERY CONTROL CONSTANT IS IN `CONTROLS`, AND THAT IS THE POINT ──────────────────
 * One object, one place to tune, one place for the spec's *Feel* table to correspond to.
 * A constant that lives beside its use site is a constant nobody finds when the feel is
 * wrong — and these are the numbers most likely to be argued about after a playtest.
 *
 * **None of them is an `ENGINE_VERSION` bump.** They are client-side only: they decide
 * WHICH ticks carry a `MoveLeft`, never what a `MoveLeft` does. A trace recorded under one
 * DAS replays identically under another, because the trace stores the emitted actions and
 * not the key state that produced them. That is the whole reason auto-repeat lives out
 * here — see the reachability note on `DAS_FRAMES`, which is the one place a change here
 * has a consequence worth checking.
 *
 * ── THE OS's KEY REPEAT IS NOT A SOURCE OF INPUT ────────────────────────────────────
 * A held key produces a stream of `keydown` events at the operating system's typematic
 * rate — typically ~500 ms to the first repeat and ~30 ms between them, both user-
 * configurable and neither one ours. Driving DAS from those events would hand the game's
 * feel to a control panel setting, and would give two players on the same build different
 * games. **`event.repeat` is dropped at the door** (`TetriceScreen`), the key's DOWN and UP
 * edges are the only things recorded, and every repeat in this game is counted here, in
 * simulation frames.
 */

import type { Action } from "../engine/step";

/** A control that has a held state. Everything else is an edge. */
export type HeldButton = "Left" | "Right" | "SoftDrop";

/** An action that fires once per press and never repeats. */
export type PulseAction = Extract<Action, "RotateCW" | "RotateCCW" | "HardDrop" | "Hold">;

export const CONTROLS = {
  // ── auto-repeat, in simulation frames at 60 Hz ────────────────────────────────────
  /**
   * DELAYED AUTO SHIFT — frames between the press's own move and the second one.
   * 10 frames = 167 ms.
   *
   * **The one number here with a gameplay consequence, and the spec names the check**
   * (*Gravity and lock*): the floor of the gravity table is 2 frames/row, so a piece
   * crosses the twenty visible rows in 40 frames at level 15+. Walking from the spawn
   * columns to either wall is at most 5 columns: the press moves one immediately, then
   * DAS, then 3 × ARR — `10 + 3 × 2 = 16` frames, and the last column is reached on
   * frame 16 of 40. **Every column stays reachable on one charge, with 24 frames of
   * margin.** Raising DAS past 34 frames would eat that margin and make the fast tiers a
   * different game rather than a harder one; that is the bound, and it is arithmetic
   * rather than taste.
   */
  DAS_FRAMES: 10,
  /**
   * AUTO REPEAT RATE — frames between repeats once DAS has charged. 2 frames = 30
   * cells/second.
   *
   * Not 0 and not 1. **At most one move of a given direction applies per tick** (the
   * engine's `ACTION_ORDER` collapses duplicates), so 1 would mean 60 cells/second — the
   * full width of the well in 167 ms, which overshoots faster than a player can stop.
   * 2 is fast enough that the walk to the wall never feels like waiting and slow enough
   * that a column can be hit by releasing.
   */
  ARR_FRAMES: 2,
  /**
   * Frames between soft-drop repeats. 1 — every tick, one row.
   *
   * **This is forced, not chosen.** Soft drop must be faster than gravity at every level
   * or it stops being a control, and the gravity table bottoms out at 2 frames/row
   * (*Gravity and lock*). Any value ≥ 2 makes soft drop a no-op at level 15+, which is
   * exactly the level where a player needs it. 1 frame/row is the only rate that is
   * strictly faster than gravity everywhere on the table.
   */
  SOFT_DROP_FRAMES: 1,

  // ── touch ─────────────────────────────────────────────────────────────────────────
  /**
   * CSS pixels of travel before a stroke has a direction.
   *
   * **10, not RICE CHOMP's 22.** Chomp can afford 22 px because its player moves at 8
   * tiles/second through a maze whose junctions forgive a late turn; this game's soft
   * drop moves a row every 16.7 ms and its hard drop is irreversible. The threshold is
   * the whole recognition latency — `threshold ÷ finger velocity`, rounded up to the next
   * touch sample — so a deliberate 0.3 px/ms drag costs 33 ms at 10 px and 73 ms at 22 px.
   * GRAINSNAKE measured this and reached 10 px for the same reason
   * (`src/components/grainsnake/swipe.ts`); this is that finding applied, not re-derived.
   */
  SWIPE_THRESHOLD_PX: 10,
  /**
   * How far the dominant axis must beat the other before a stroke has committed. Keeps a
   * small threshold from turning thumb jitter into moves: a diagonal reports nothing
   * until it commits, which is correct, because a diagonal is not an input this game has.
   */
  SWIPE_AMBIGUITY_RATIO: 1.4,
  /**
   * THE FLICK SPLIT: px/ms, measured from the touch origin, that separates a hard drop
   * from a soft drop. **1.2.**
   *
   * The two gestures are the same stroke and differ only in intent, so the split is the
   * gap between the two bands rather than a midpoint:
   *
   * | gesture | what the thumb is doing | typical |
   * |---|---|---|
   * | soft drop | tracking the piece down, watching it | 0.2–0.8 px/ms |
   * | hard drop | ballistic; the thumb is already stopping | 2–5 px/ms |
   *
   * 1.2 sits above the deliberate band with margin and roughly half a band below the
   * ballistic one, because **the two errors are not equal**: a hard drop read as a soft
   * drop costs a moment, and a soft drop read as a hard drop costs the piece. The split
   * therefore leans toward soft drop.
   */
  FLICK_PX_PER_MS: 1.2,
  /**
   * Minimum travel before velocity is allowed to decide anything, in CSS px.
   *
   * Without it the split is quantisation noise: crossing a 10 px threshold inside one
   * 16.7 ms touch sample already reads as 0.6 px/ms whatever the thumb was doing, so a
   * modest drag that happened to fall between samples would slam the piece. 24 px is two
   * samples of a genuine flick and more travel than a thumb produces by accident.
   */
  FLICK_MIN_TRAVEL_PX: 24,
  /**
   * Milliseconds after a downward commit, with the flick distance still unreached, before
   * the stroke is settled as a soft drop.
   *
   * A flick is over in well under this; anything still short of 24 px at 80 ms is a drag.
   * It bounds how long soft drop can be held back waiting for evidence — at most 80 ms,
   * five rows at the soft-drop rate, and only on a stroke slow enough that the player is
   * not counting rows.
   */
  FLICK_DECIDE_MS: 80,
  /** Longest stroke, in ms, that a no-direction touch may still be read as a tap. */
  TAP_MAX_MS: 300,

  // ── the on-screen cluster ─────────────────────────────────────────────────────────
  /** localStorage key for the d-pad preference. */
  DPAD_STORAGE_KEY: "tetrice:dpad",
} as const;

/**
 * The per-tick input state machine.
 *
 * The host reports EDGES — `press`, `release`, `pulse` — at whatever moment the browser
 * delivers them, and the loop calls `drain()` exactly once per simulation tick. Every
 * repeat is counted in `drain()` calls, so the same held key produces the same actions on
 * the same ticks on a 60 Hz laptop, a 120 Hz phone and a backgrounded tab catching up.
 *
 * Nothing here reads a clock. That is deliberate: a control layer that mixed wall time
 * into a tick-indexed trace would be the one place a client and the server-side replayer
 * could disagree without either being wrong (*Hard constraints*).
 */
export class InputState {
  /** Per held button: frames since its press, when its next repeat is due, and when it
   *  last actually emitted — all counted in `drain()` calls, never in milliseconds. */
  private readonly held = new Map<
    HeldButton,
    {
      frame: number;
      /** Frame the next repeat is due on. */
      nextAt: number;
      /** Frame the DAS charge alone would have fired on. A drag can move the piece sooner
       *  without moving this, so letting the drag stop returns the button to the schedule
       *  a held key would have had. */
      dasDue: number;
      lastEmit: number;
      /** The pending emit was requested by a drag rather than by the repeat clock. */
      nudged: boolean;
    }
  >();
  /** Buttons whose press has not yet been given its immediate move. */
  private readonly fresh = new Set<HeldButton>();
  private readonly pulses = new Set<PulseAction>();
  /**
   * Which horizontal direction is currently steering. LAST PRESS WINS: pressing right
   * while left is held moves right, and releasing right hands control back to left.
   */
  private steer: "Left" | "Right" | null = null;

  /** A control went down. Idempotent — a repeat event that slipped through changes nothing. */
  press(b: HeldButton): void {
    if (b === "Left" || b === "Right") this.steer = b;
    if (this.held.has(b)) return;
    this.charge(b);
  }

  /** Start (or restart) a button's schedule at frame 0, owing an immediate move. */
  private charge(b: HeldButton): void {
    const due = repeatDelay(b);
    this.held.set(b, { frame: 0, nextAt: due, dasDue: due, lastEmit: 0, nudged: false });
    this.fresh.add(b);
  }

  /**
   * A control came up.
   *
   * **The other direction, if still held, is re-pressed rather than resumed.** A player
   * who taps right while holding left and then lets go is asking to keep going left, and
   * a resumed charge would fire the next repeat instantly — a jump of several columns
   * from a key they never released. A fresh charge costs one DAS and is never surprising.
   */
  release(b: HeldButton): void {
    this.held.delete(b);
    this.fresh.delete(b);
    if (b === this.steer) {
      const other = b === "Left" ? "Right" : "Left";
      this.steer = this.held.has(other) ? other : null;
      if (this.steer) this.charge(this.steer);
    }
  }

  /** An edge-triggered action. Fires once, on the next tick, however long the key is held. */
  pulse(a: PulseAction): void {
    this.pulses.add(a);
  }

  /**
   * Request one move in a direction that is ALREADY held, without recharging DAS.
   *
   * This exists for one caller: a touch drag that keeps travelling in the direction it
   * already committed to (*touch.ts*). It moves the piece with the drag instead of making
   * the player wait out a charge, and **it cannot outrun ARR** — which is what keeps the
   * touch surface and the keyboard capped at the same maximum speed rather than giving
   * the thumb a faster game than the hands.
   */
  nudge(b: "Left" | "Right"): void {
    const h = this.held.get(b);
    if (!h || b !== this.steer) return;
    // The move would land on the NEXT drain, so that is the frame ARR is measured to.
    if (h.frame + 1 - h.lastEmit < CONTROLS.ARR_FRAMES) return;
    h.nextAt = h.frame + 1;
    h.nudged = true;
  }

  /** Everything up. For blur, tab-hide, pause and game over — a key held across any of
   *  those is a key the browser will never send an `up` for. */
  releaseAll(): void {
    this.held.clear();
    this.fresh.clear();
    this.pulses.clear();
    this.steer = null;
  }

  /** True while any control is down. */
  get anyHeld(): boolean {
    return this.held.size > 0;
  }

  /**
   * Advance one tick and return the actions for it.
   *
   * **Call exactly once per simulation tick, and only for ticks that are actually
   * stepped.** The repeat schedule is measured in these calls, so calling it on a paused
   * frame would charge DAS while the game is stopped.
   */
  drain(): Action[] {
    const out: Action[] = [];

    for (const b of ["Left", "Right", "SoftDrop"] as const) {
      const h = this.held.get(b);
      if (!h) continue;
      // A held direction that is not steering is dormant: it keeps its held state so that
      // releasing the other one can hand control back, and emits nothing meanwhile.
      if ((b === "Left" || b === "Right") && this.steer !== b) continue;

      if (this.fresh.has(b)) {
        // The press's own move, on the first tick after it — frame 0.
        this.fresh.delete(b);
        h.lastEmit = 0;
        out.push(ACTION_OF[b]);
        continue;
      }
      h.frame += 1;
      if (h.frame >= h.nextAt) {
        out.push(ACTION_OF[b]);
        h.lastEmit = h.frame;
        // A drag's move is additive: it never brings the held-key schedule forward, so a
        // thumb that stops mid-stroke waits out the same charge a key would have.
        h.nextAt = h.nudged
          ? Math.max(h.dasDue, h.frame + repeatInterval(b))
          : h.frame + repeatInterval(b);
        h.nudged = false;
      }
    }

    for (const p of this.pulses) out.push(p);
    this.pulses.clear();
    return out;
  }
}

const ACTION_OF: Record<HeldButton, Action> = {
  Left: "MoveLeft",
  Right: "MoveRight",
  SoftDrop: "SoftDrop",
};

/** Frames from the press's own move to the first repeat. */
function repeatDelay(b: HeldButton): number {
  // Soft drop has no charge: it is a continuous action, and a 167 ms hitch between the
  // first row and the second would read as a dropped input rather than as a delay.
  return b === "SoftDrop" ? CONTROLS.SOFT_DROP_FRAMES : CONTROLS.DAS_FRAMES;
}

/** Frames between repeats once charged. */
function repeatInterval(b: HeldButton): number {
  return b === "SoftDrop" ? CONTROLS.SOFT_DROP_FRAMES : CONTROLS.ARR_FRAMES;
}
