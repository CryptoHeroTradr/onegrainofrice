"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { COLS, ROWS, tierIndexFor, ticksPerStepFor } from "@/lib/grainsnake/rules";
import { segmentAt } from "@/lib/grainsnake/engine";
import {
  MAX_TICKS_PER_DRAIN,
  TICK_MS,
  createGame,
  drainTicks,
  stepMut,
} from "@/lib/grainsnake/engine";
import { DOWN, LEFT, RIGHT, UP, type Dir, type GameState, type ReplayLog } from "@/lib/grainsnake/types";
import { paint } from "./render";
import { createRecorder, verifyRun } from "./recorder";
import { createCueWatch, observeCues, playCues, preloadSnake } from "./audio";
import {
  burstDeath,
  burstEat,
  burstTierUp,
  createFx,
  drawFx,
  resetFx,
  shakeOffset,
  stepFx,
  trailFx,
} from "./fx";
import { musicOn } from "./prefs";
import { startMusic, stopMusic } from "./music";
import { beginSwipe, endSwipe, feedSwipe, wasTap, type SwipeTracker } from "./swipe";
import { recordLatency, reportLatency } from "./latency";

/**
 * Canvas host for GRAINSNAKE. Owns the render loop, the canvas sizing and the
 * keyboard, and nothing else — the rules live in `@/lib/grainsnake` and are never
 * re-implemented here.
 *
 * ── THE CLIENT OWNS NO INPUT RULES ──────────────────────────────────────────────
 * There is no reversal check in this file, no turn buffer, no started flag. Every key
 * goes to the engine's `steer()` through `stepMut`, which is the same entry point the
 * replayer drives. A second copy of "you may not turn back on yourself" living in a
 * keydown handler is a second copy that disagrees with the server the day one of them
 * changes.
 *
 * ── THE ONE RULE THIS FILE ENFORCES ─────────────────────────────────────────────
 * Wall-clock time never reaches the simulation. It is converted into a whole number
 * of fixed ticks by `drainTicks()` — ACCUMULATED, never counted per frame — and the
 * simulation only ever advances in whole ticks. A frame-counted loop of this shape
 * runs at double speed on a 120 Hz phone and at 0.75× on a 45 Hz panel: deterministic
 * at every rate and a different game at each.
 */

const MAX_DPR = 2;

/**
 * The gate validated a 15px cell, so 15px is the FLOOR and every larger size is an
 * integer multiple of it.
 *
 * A non-integer scale resamples the grain silhouettes and reintroduces exactly the
 * smudge the size gate was built to rule out — and the whole board-size decision
 * rests on 15px really being 15px. So the ladder is 15, 30, 45 and nothing between.
 *
 * **It never returns less than 15**, even when the viewport cannot hold 345px. A
 * board scaled to 13px to fit a 320px phone would be a board nobody measured, and
 * the honest failure is a board that overflows its container (which scrolls) rather
 * than one that is quietly illegible.
 */
const CELL_FLOOR = 15;
export function boardScale(boxW: number, boxH: number): number {
  const fit = Math.min(boxW / COLS, boxH / ROWS);
  const steps = Math.floor(fit / CELL_FLOOR);
  return steps < 1 ? CELL_FLOOR : steps * CELL_FLOOR;
}

export interface GrainsnakeStats {
  score: number;
  length: number;
  goldens: number;
  /** 1-based tier, so the HUD can show what the speed curve is doing. */
  tier: number;
  tick: number;
  dead: boolean;
  filled: boolean;
  started: boolean;
  paused: boolean;
  /** Seconds left on the resume countdown, or 0 when there is none. */
  countdown: number;
}

export interface GrainsnakeHandle {
  restart(): void;
  pause(): void;
  resume(): void;
  steer(dir: Dir): void;
  /**
   * The recorded log for the finished run, or null while one is in progress.
   *
   * `(seed, inputs, ticks, engineVersion)` and nothing else — the submit path sends
   * exactly this and the server recomputes the score from it. There is no score here
   * to send, deliberately.
   */
  log(): ReplayLog | null;
}

const KEYS: Record<string, Dir> = {
  ArrowUp: UP,
  ArrowDown: DOWN,
  ArrowLeft: LEFT,
  ArrowRight: RIGHT,
  w: UP,
  a: LEFT,
  s: DOWN,
  d: RIGHT,
  W: UP,
  A: LEFT,
  S: DOWN,
  D: RIGHT,
};

/** Seconds of countdown after a pause that the player did not ask for. */
const RESUME_COUNTDOWN_MS = 3000;

/**
 * A run's seed, picked on the CLIENT at mount.
 *
 * Never during render: this component is server-rendered too, and a seed drawn while
 * rendering would differ between the two passes and trip hydration. `Date.now()` is a
 * host concern and stays a host concern — it seeds the PRNG and is then never
 * consulted again, because the simulation has no clock and the replayer reads the
 * seed off the log rather than re-deriving it.
 */
function pickSeed(): number {
  return (Date.now() & 0x7fffffff) || 1;
}

export const GrainsnakeCanvas = forwardRef<
  GrainsnakeHandle,
  {
    /** Fixed seed, for a reproducible run. Omitted in play: the client picks one. */
    seed?: number;
    reduced: boolean;
    onStats: (s: GrainsnakeStats) => void;
  }
>(function GrainsnakeCanvas({ seed, reduced, onStats }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stateRef = useRef<GameState | null>(null);
  const recorderRef = useRef(createRecorder(0));
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const accRef = useRef(0);
  const pxRef = useRef(0);
  const dprRef = useRef(1);
  const pausedRef = useRef(false);
  const countdownRef = useRef(0);
  const reducedRef = useRef(reduced);
  const verifiedRef = useRef(false);
  const pendingRef = useRef<Dir | null>(null);
  const swipeRef = useRef<SwipeTracker | null>(null);
  /**
   * `restart` and `thaw` reached through refs, not closed over. The touch effect
   * mounts once, so a closure captured there would hold the FIRST render's copies
   * forever — which is fine today because both touch only refs, and is a trap the
   * moment either starts reading state.
   */
  const restartRef = useRef<() => void>(() => {});
  const thawRef = useRef<(withCountdown: boolean) => void>(() => {});
  /** Tick at which the current touch began, for the latency instrument. */
  const touchTickRef = useRef(0);
  const fxRef = useRef(createFx());
  const cueRef = useRef<ReturnType<typeof createCueWatch> | null>(null);

  /**
   * The interpolation fraction, HELD across a freeze.
   *
   * TWO FREEZES, and both are needed (spec, *Hard constraints*). The accumulator stops
   * taking wall-clock, so resuming does not fire a burst of steps; and this value is
   * held, so the trail does not keep sliding smoothly between cells after the
   * simulation has stopped. Freezing only the accumulator leaves a paused snake
   * visibly still moving and a dead one still gliding into the wall that killed it.
   */
  const frozenFRef = useRef(0);

  reducedRef.current = reduced;

  const publish = () => {
    const s = stateRef.current;
    if (!s) return;
    onStats({
      score: s.score,
      length: s.length,
      goldens: s.goldensTaken,
      tier: tierIndexFor(s.foodEaten) + 1,
      tick: s.tick,
      dead: s.dead,
      filled: s.filled,
      started: s.started,
      paused: pausedRef.current,
      countdown: Math.ceil(countdownRef.current / 1000),
    });
  };

  /**
   * Run the recorded log back through the step function and compare.
   *
   * Fires once per finished run. A mismatch is an engine or plumbing bug and is
   * logged loudly — the player's run is untouched either way.
   */
  const verify = (s: GameState) => {
    if (verifiedRef.current) return;
    verifiedRef.current = true;
    const log = recorderRef.current.seal(s);
    const result = verifyRun(log, s);
    if (!result.ok) {
      console.error(
        `[grainsnake] REPLAY MISMATCH — played ${result.playedScore}, replayed ${result.replayedScore} (${result.reason}). ` +
          `The recorded log does not reproduce the run it came from; the Phase 7 verifier would refuse this score.`,
        log,
      );
    }
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const s = stateRef.current;
    if (!canvas || !s) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);

    const frozen = pausedRef.current || s.dead || s.filled || !s.started;
    // Reduced motion snaps to cell positions — no interpolation, and NOT ONE RULE
    // CHANGES. The simulation is identical; only the picture between two cells is.
    const f = reducedRef.current ? 1 : frozen ? frozenFRef.current : liveFraction(s);

    const fx = fxRef.current;
    // SCREEN SHAKE is a transform on the whole board, applied here rather than inside
    // paint() — the renderer draws a board, it does not know the board is being shaken.
    const [sx, sy] = reducedRef.current ? [0, 0] : shakeOffset(fx);
    if (sx !== 0 || sy !== 0) ctx.translate(sx, sy);

    paint(ctx, s, pxRef.current, f, trailFx(fx));
    // Husks are painted OVER the finished board, never into the trail. The four
    // things that made the trail pass its gate live in render.ts and are untouched.
    drawFx(ctx, fx);
  };

  /** How far through the current step we are, in [0, 1]. */
  const liveFraction = (s: GameState): number => {
    const per = ticksPerStepFor(s.foodEaten);
    const elapsed = per - s.ticksToNextStep;
    const within = accRef.current / TICK_MS;
    const f = (elapsed + within) / per;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  };

  const loop = (t: number) => {
    const s = stateRef.current;
    if (!s) return;
    const raw = t - lastRef.current;
    lastRef.current = t;

    if (countdownRef.current > 0) {
      // The countdown runs on the HOST's clock. It advances no tick and touches no
      // state — the run is frozen solid underneath it.
      countdownRef.current -= Math.min(Math.max(raw, 0), 250);
      if (countdownRef.current <= 0) {
        countdownRef.current = 0;
        pausedRef.current = false;
        accRef.current = 0;
      }
      draw();
      publish();
      rafRef.current = requestAnimationFrame(loop);
      return;
    }

    if (!pausedRef.current && !s.dead && !s.filled) {
      /**
       * ACCUMULATED, NOT COUNTED. `drainTicks` adds the elapsed wall-clock to the
       * accumulator and hands back whole ticks; the clamp inside it bounds a
       * returning backgrounded tab.
       *
       * THE CLAMP CHANGES PACING ONLY. It discards TIME, never ticks: the sequence is
       * still 0, 1, 2, … and an input is still stamped with the tick it was applied
       * on, so a clamped run replays exactly as an unclamped one does.
       */
      const d = drainTicks(accRef.current, raw);
      accRef.current = d.accumulator;
      for (let i = 0; i < d.ticks; i++) {
        if (s.dead || s.filled) break;
        // At most one input per tick, which is what the log's strictly-ascending
        // invariant means. The engine decides whether it is legal; this file does not.
        const input = pendingRef.current;
        pendingRef.current = null;
        const tickBefore = s.tick;
        const startedBefore = s.started;
        stepMut(s, input);
        if (input !== null) {
          // Stamp with the tick the engine actually applied it on. Before the run
          // starts nothing elapses, so the first input is tick 0 — which is exactly
          // what makes tick 0 of a trace meaningful.
          recorderRef.current.record(startedBefore ? tickBefore : 0, input);
        }
      }
      if (d.ticks >= MAX_TICKS_PER_DRAIN) accRef.current = 0;

      /**
       * CUES ARE DERIVED, ONCE, AFTER THE TICKS ARE DRAINED.
       *
       * Not inside the tick loop: several ticks can land in one frame, and firing an
       * eat blip per tick would stack four copies of a 50 ms clip on one frame. The
       * watcher is read-only over state — a run observed is bit-identical to one that
       * is not, which `test/grainsnake-audio.test.ts` asserts.
       */
      if (cueRef.current) {
        const cues = observeCues(cueRef.current, s);
        if (cues.ate || cues.golden || cues.tierUp || cues.died) {
          playCues(cues, s);
          const fx = fxRef.current;
          const reduced = reducedRef.current;
          if (cues.ate || cues.golden) {
            burstEat(fx, segmentAt(s, 0), pxRef.current, cues.golden, reduced);
          }
          if (cues.tierUp) burstTierUp(fx, pxRef.current, reduced);
          if (cues.died) {
            const cells: number[] = [];
            for (let i = 0; i < s.length; i++) cells.push(segmentAt(s, i));
            burstDeath(fx, cells, pxRef.current, reduced);
          }
        }
      }

      if (s.dead || s.filled) {
        frozenFRef.current = 1;
        verify(s);
        // The measured half of the latency question. `test/grainsnake-swipe.test.ts`
        // models it; only a real thumb can produce this.
        reportLatency();
      }
    }

    // The fx layer runs on WALL-CLOCK and is clamped, deliberately: it is not the
    // simulation and must not be. A stalled frame makes husks jump, never the snake.
    stepFx(fxRef.current, Math.min(Math.max(raw, 0), 100) / 1000, pxRef.current);

    draw();
    publish();
    rafRef.current = requestAnimationFrame(loop);
  };

  const freeze = () => {
    const s = stateRef.current;
    if (!s || pausedRef.current) return;
    // Freeze #2: hold the fraction where it is, so nothing keeps sliding.
    frozenFRef.current = s.started ? liveFraction(s) : 0;
    pausedRef.current = true;
    countdownRef.current = 0;
    publish();
  };

  const thaw = (withCountdown: boolean) => {
    const s = stateRef.current;
    if (!s || s.dead || s.filled) return;
    if (!pausedRef.current) return;
    if (withCountdown && s.started) {
      countdownRef.current = RESUME_COUNTDOWN_MS;
    } else {
      pausedRef.current = false;
      accRef.current = 0;
    }
    publish();
  };

  const boot = (nextSeed: number) => {
    const s = createGame(nextSeed);
    stateRef.current = s;
    recorderRef.current.reset(nextSeed);
    verifiedRef.current = false;
    pendingRef.current = null;
    accRef.current = 0;
    frozenFRef.current = 0;
    pausedRef.current = false;
    countdownRef.current = 0;
    resetFx(fxRef.current);
    cueRef.current = createCueWatch(s);
  };

  const restart = () => {
    boot(pickSeed());
    publish();
  };
  restartRef.current = restart;
  thawRef.current = thaw;

  useImperativeHandle(ref, () => ({
    restart() {
      restart();
    },
    pause() {
      freeze();
    },
    resume() {
      thaw(false);
    },
    steer(dir: Dir) {
      pendingRef.current = dir;
    },
    log() {
      const s = stateRef.current;
      if (!s || (!s.dead && !s.filled)) return null;
      return recorderRef.current.seal(s);
    },
  }));

  // --- boot, sizing, loop ----------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    boot(seed ?? pickSeed());

    let retry = 0;
    const resize = () => {
      const box = wrap.getBoundingClientRect();
      // A degenerate box means layout has not settled. Retry rather than committing to
      // a bad measurement — committing here is how a canvas ends up sized from its own
      // previous mistake and agrees with itself forever.
      if (box.width < COLS || box.height < ROWS) {
        if (retry < 60) {
          retry++;
          requestAnimationFrame(resize);
        }
        return;
      }
      retry = 0;
      const px = boardScale(box.width, box.height);
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (px === pxRef.current && dpr === dprRef.current) return;
      pxRef.current = px;
      dprRef.current = dpr;
      const w = COLS * px;
      const h = ROWS * px;
      // CSS size in true pixels; only the backing store is scaled by DPR.
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw();
    };
    resize();

    // Observe the WRAPPER, not the canvas: this handler resizes the canvas, and
    // observing the thing you resize is how you get a feedback loop.
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Decode the clips on mount. The first eat lands on one specific tick and gets no
    // second chance; an undecoded clip arrives late or is dropped outright on iOS.
    preloadSnake();
    if (musicOn()) startMusic();

    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stateRef.current = null;
      stopMusic();
    };
    // Boot once. The seed is read at mount; `restart()` reseeds explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- keyboard --------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (dir === undefined) return;
      /**
       * A CONTROL WITH FOCUS OWNS `Space` AND `Enter`. IT NEVER OWNS THE STEERING KEYS.
       * The arrows scroll and WASD triggers browser quick-find, so their default is
       * cancelled whatever has focus — a link with focus can never stop the player
       * steering. `Space`/`Enter` are not claimed here at all, which is what keeps
       * every anchor on the page reachable from a keyboard.
       */
      e.preventDefault();
      // Straight to the engine. No reversal check, no buffering, no started flag —
      // all three are rules and all three live in `steer()`.
      pendingRef.current = dir;
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  // --- touch: swipe over the play area ---------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    /**
     * `preventDefault` on the PLAY AREA ONLY. Never on the document.
     *
     * A swipe over the board must not scroll the page or fire pull-to-refresh, and a
     * double tap on it must not zoom. All three are prevented here, on this element,
     * because the same prevention applied site-wide would break scrolling on every
     * other page the app renders. `touch-action: none` in the style does the
     * declarative half; these handlers do the half `touch-action` cannot.
     */
    const onStart = (e: TouchEvent) => {
      const s = stateRef.current;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      e.preventDefault();
      swipeRef.current = beginSwipe(t.clientX, t.clientY, e.timeStamp);
      touchTickRef.current = s.tick;
    };

    const onMove = (e: TouchEvent) => {
      const s = stateRef.current;
      const tracker = swipeRef.current;
      const t = e.changedTouches[0];
      if (!s || !tracker || !t) return;
      e.preventDefault();
      const r = feedSwipe(tracker, t.clientX, t.clientY, e.timeStamp);
      if (r.dir === null) return;
      // Straight to the engine, exactly as a key does. No reversal check, no
      // buffering, no started flag — touch gets no rules of its own.
      pendingRef.current = r.dir;
      recordLatency(touchTickRef.current, s.tick, s.foodEaten);
      // Re-anchor the latency clock too: the next leg of the drag is its own turn.
      touchTickRef.current = s.tick;
    };

    const onEnd = (e: TouchEvent) => {
      const tracker = swipeRef.current;
      const st = stateRef.current;
      if (!tracker) return;
      e.preventDefault();
      endSwipe(tracker);
      /**
       * A lift with no turn in it is a TAP, which means "get on with it".
       *
       * It is not a rule and never reaches the engine — it drives the same host
       * affordances the on-screen buttons do. It matters on a phone because those
       * buttons are small and the board is the biggest target on the screen.
       * A tap can never START a run: the engine begins on the first legal DIRECTION,
       * and a tap has none.
       */
      if (wasTap(tracker) && st) {
        if (st.dead || st.filled) restartRef.current();
        else if (pausedRef.current && countdownRef.current === 0) thawRef.current(false);
      }
      swipeRef.current = null;
    };

    canvas.addEventListener("touchstart", onStart, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onEnd, { passive: false });
    canvas.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", onStart);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("touchend", onEnd);
      canvas.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // --- pause on blur and on visibilitychange ---------------------------------
  useEffect(() => {
    /**
     * BOTH DIRECTIONS OF `visibilitychange`, not only `hidden`.
     *
     * An app switch, a notification shade or an incoming call hides the tab; coming
     * back fires `visibilitychange` → visible. `window.focus` is NOT reliable there
     * on mobile — it may not fire at all when a tab is restored rather than
     * re-focused — so resuming only on focus leaves the game stuck on the pause
     * screen after the single most common real-world interruption.
     */
    const onHide = () => {
      if (document.visibilityState === "hidden") freeze();
      else thaw(true);
    };
    const onBlur = () => freeze();
    const onFocus = () => thaw(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
    // `freeze` and `thaw` touch refs only and read no props or state, so a fresh
    // closure each render is identical to the last. Re-subscribing the listeners on
    // every render to satisfy the linter would be strictly more work for the same
    // behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className="flex h-full w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        className="block"
        aria-label="Grainsnake board"
        // Declarative half of "a swipe here is not a scroll": no panning, no
        // pinch-zoom, no double-tap zoom — scoped to the board, never the document.
        style={{ touchAction: "none" }}
      />
    </div>
  );
});
