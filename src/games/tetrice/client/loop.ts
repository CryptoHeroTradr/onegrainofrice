/**
 * TETRICE — the fixed-timestep loop.
 *
 * 60 Hz simulation, accumulator-driven, decoupled from `requestAnimationFrame`. Identical
 * gameplay at any refresh rate, which is load-bearing for the leaderboard: the trace is
 * tick-indexed, so a run that stepped a different number of times is a different run.
 *
 * TWO RULES THIS FILE EXISTS TO ENFORCE:
 *
 *  1. **Never step twice from one frame without accumulating time.** A `while` over the
 *     accumulator, never "step once per rAF" and never "step twice because the frame was
 *     long".
 *  2. **Catch-up is capped at 5 steps.** A backgrounded tab returns holding seconds of
 *     debt; without the cap it would spend that debt in one frame and fast-forward the run
 *     — dropping a piece the player never saw. The debt is DISCARDED, not banked, and the
 *     replayer never sees that it happened, because it advances tick by tick from the log.
 */

export const STEP_MS = 1000 / 60;
export const MAX_CATCHUP_STEPS = 5;

export interface LoopHandle {
  stop(): void;
  /** Fraction of the way to the next tick, 0..1 — for render interpolation. */
  alpha(): number;
}

export interface LoopCallbacks {
  /** One simulation tick. Returns false to stop the loop (run over). */
  step(): boolean;
  /** Draw. `alpha` is the accumulator fraction; render LAGGING, never leading. */
  draw(alpha: number): void;
  /**
   * True while the run is paused. Optional; absent means never paused.
   *
   * **A PAUSED FRAME BANKS NO TIME.** The accumulator is emptied on every paused frame
   * rather than left to grow, because a run paused for a minute would otherwise return
   * holding 3,600 frames of debt — and the catch-up cap would spend five of them and
   * discard the rest, which is a piece the player never saw moving five rows and then a
   * silent discontinuity in a tick-indexed trace. Pausing costs the current partial tick
   * and nothing else.
   */
  paused?(): boolean;
}

export function startLoop(cb: LoopCallbacks): LoopHandle {
  let raf = 0;
  let last = 0;
  let acc = 0;
  let running = true;

  const frame = (now: number) => {
    if (!running) return;
    if (last === 0) last = now;
    acc += now - last;
    last = now;

    if (cb.paused?.()) {
      acc = 0;
      cb.draw(0);
      raf = requestAnimationFrame(frame);
      return;
    }

    let steps = 0;
    while (acc >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
      if (!cb.step()) {
        running = false;
        break;
      }
      acc -= STEP_MS;
      steps += 1;
    }
    // Debt beyond the cap is dropped on the floor rather than banked. Keeping it would
    // fast-forward the next frame too, which is the same bug one frame later.
    if (acc > STEP_MS * MAX_CATCHUP_STEPS) acc = 0;

    cb.draw(Math.min(acc / STEP_MS, 1));
    if (running) raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    alpha() {
      return Math.min(acc / STEP_MS, 1);
    },
  };
}
