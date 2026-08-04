"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { COLS, ROWS } from "./engine/maze";
import {
  CLEARED,
  CUTSCENE,
  DYING,
  READY,
  createGame,
  endCutscene,
  setWanted,
  tick as stepGame,
  type GameState,
} from "./engine/game";
import {
  BONUS_SCORE_TICKS,
  CLEAR_FLASH_TICKS,
  CLEAR_HOLD_TICKS,
  CLEAR_TICKS,
  CUTSCENE_TICKS,
  DEATH_PAUSE_TICKS,
  DEATH_TICKS,
  bonusForLevel,
} from "./engine/levels";
import { DOWN, LEFT, RIGHT, TICK_HZ, UP, type Dir } from "./engine/types";
import {
  bakeGrains,
  bakeWalls,
  drawBonus,
  drawBonusScore,
  drawCutscene,
  drawPests,
  drawPlayer,
  drawPlayerDeath,
  drawPower,
  syncGrainLayer,
} from "./engine/render";

/**
 * Canvas host for RICE CHOMP. Owns the render loop, the canvas sizing and the keyboard,
 * and nothing else — the rules live in ./engine/game.ts and the painting in
 * ./engine/render.ts. Structured like src/components/grains/RiceBowlCanvas.tsx: a
 * forwardRef with an imperative handle, a rAF loop, DPR-aware sizing, ResizeObserver.
 *
 * THE ONE RULE THIS FILE ENFORCES: wall-clock time never reaches the simulation. It is
 * converted into a whole number of fixed ticks here and nowhere else, so the same
 * inputs always produce the same run regardless of frame rate. See engine/types.ts.
 */

const TICK_MS = 1000 / TICK_HZ;
/** Longest frame gap we will honour. Beyond this the backlog is dropped, not simulated. */
const MAX_FRAME_MS = 100;
/** Hard cap on catch-up ticks per frame, so a stall can never spiral. */
const MAX_TICKS_PER_FRAME = 10;
/** Cap the backing store. A 3× phone at full size is a lot of pixels for no gain. */
const MAX_DPR = 2;
/** How often the HUD is told what happened. 60fps setState would thrash React. */
const STATS_MS = 100;
/**
 * The maze-flash colours. Bright bone walls with a khaki keyline — the inverse of the
 * porcelain board, so the strobe reads as the maze lighting up rather than as a glitch.
 */
const FLASH_FILL = "#f4efe2";
const FLASH_EDGE = "#c4b370";

export interface ChompStats {
  score: number;
  lives: number;
  level: number;
  grainsEaten: number;
  powerEaten: number;
  grainsRemaining: number;
  pestsEaten: number;
  tick: number;
  paused: boolean;
  /** One of the engine's Phase constants; the screen only distinguishes game over. */
  phase: number;
}

export interface ChompCanvasHandle {
  /** Throw the run away and start again. */
  reset: () => void;
  /** Toggle pause; returns the new paused state. */
  togglePause: () => boolean;
  /** Queue a direction, for on-screen controls in a later phase. */
  steer: (dir: Dir) => void;
}

const KEY_TO_DIR: Record<string, Dir> = {
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

export const ChompCanvas = forwardRef<
  ChompCanvasHandle,
  {
    /** Polled roughly every 100ms with the run's headline numbers. */
    onStats?: (stats: ChompStats) => void;
    /** Strips the golden-grain pulse. Gameplay is unaffected. */
    reducedMotion?: boolean;
    className?: string;
  }
>(function ChompCanvas({ onStats, reducedMotion = false, className }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stateRef = useRef<GameState | null>(null);
  const pausedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const accRef = useRef(0);

  // Baked layers + the size they were baked at.
  const wallsRef = useRef<HTMLCanvasElement | null>(null);
  const flashRef = useRef<HTMLCanvasElement | null>(null);
  const grainsRef = useRef<HTMLCanvasElement | null>(null);
  const bakedRef = useRef<Uint8Array | null>(null);
  const tileRef = useRef(0);
  const dprRef = useRef(1);
  /** The level the baked layers belong to. A new level refills the maze, so it re-bakes. */
  const bakedLevelRef = useRef(0);

  /** Milliseconds into the current interstitial. Host-side; never touches the run. */
  const cutsceneMsRef = useRef(0);

  const statsAtRef = useRef(0);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  /** Re-bake the static layers at the current tile size. */
  const bake = () => {
    const state = stateRef.current;
    const tilePx = tileRef.current;
    const dpr = dprRef.current;
    if (!state || tilePx <= 0) return;
    wallsRef.current = bakeWalls(state.grid, tilePx, dpr);
    flashRef.current = bakeWalls(state.grid, tilePx, dpr, FLASH_FILL, FLASH_EDGE);
    grainsRef.current = bakeGrains(state.grid, tilePx, dpr);
    bakedRef.current = Uint8Array.from(state.grid);
    bakedLevelRef.current = state.level;
  };

  const paint = () => {
    const canvas = canvasRef.current;
    const state = stateRef.current;
    const tilePx = tileRef.current;
    if (!canvas || !state || tilePx <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = dprRef.current;
    const w = COLS * tilePx;
    const h = ROWS * tilePx;

    // A new level puts every grain back, and the eaten-grain layer only ever ERASES.
    // Re-bake rather than trying to patch grains back into it.
    if (bakedLevelRef.current !== state.level) bake();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);

    // The interstitial replaces the board entirely, and runs on the HOST's clock — the
    // simulation is frozen solid underneath it. See the CUTSCENE note in game.ts.
    if (state.phase === CUTSCENE) {
      drawCutscene(
        ctx,
        state.cutscene,
        Math.min(1, cutsceneMsRef.current / (CUTSCENE_TICKS * TICK_MS)),
        w,
        h,
        tilePx,
        !reducedRef.current,
      );
      return;
    }

    const walls = wallsRef.current;
    const grains = grainsRef.current;
    const baked = bakedRef.current;
    if (grains && baked) syncGrainLayer(grains, baked, state.grid, tilePx, dpr);

    // Blit at CSS scale: the layers already carry the device-pixel resolution.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (walls) ctx.drawImage(walls, 0, 0);
    if (grains) ctx.drawImage(grains, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Pulse is time-free: derived from the tick count, so it cannot desync.
    const pulse = reducedRef.current ? 1 : (Math.sin(state.tick / 9) + 1) / 2;
    drawPower(ctx, state.grid, tilePx, pulse);

    if (state.phase === DYING) {
      // The pests leave the board the moment the player is caught, so the last thing on
      // screen is the mistake rather than the crowd that punished it.
      const elapsed = DEATH_PAUSE_TICKS + DEATH_TICKS - state.phaseTicks;
      drawPlayerDeath(ctx, state.player, tilePx, (elapsed - DEATH_PAUSE_TICKS) / DEATH_TICKS);
      return;
    }

    if (state.phase === CLEARED) {
      // Cleared board: nobody on it, and the walls strobe. The strobe is a second BAKED
      // layer blitted on alternate beats rather than a per-frame tint, so the flash costs
      // one drawImage and not a recomposite of the whole maze.
      const into = CLEAR_TICKS - state.phaseTicks - CLEAR_HOLD_TICKS;
      const lit = !reducedRef.current && into >= 0 && Math.floor(into / CLEAR_FLASH_TICKS) % 2 === 0;
      if (lit && flashRef.current) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(flashRef.current, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      drawPlayer(ctx, state.player, tilePx, false);
      return;
    }

    const bonusKind = bonusForLevel(state.level).kind;
    // Bob is on the tick count, so it is the same on every machine and flat when the
    // player has asked for less motion.
    const bob = reducedRef.current ? 0.5 : (Math.sin(state.tick / 11) + 1) / 2;
    drawBonus(ctx, state.bonus, bonusKind, tilePx, bob);
    drawPests(ctx, state.pests, tilePx, state.frightTicks, !reducedRef.current);
    drawPlayer(ctx, state.player, tilePx, !state.player.blocked && state.phase !== READY);
    drawBonusScore(ctx, state.bonus, tilePx, BONUS_SCORE_TICKS);
  };

  const publishStats = (now: number, force = false) => {
    const state = stateRef.current;
    if (!state) return;
    if (!force && now - statsAtRef.current < STATS_MS) return;
    statsAtRef.current = now;
    onStatsRef.current?.({
      score: state.score,
      lives: state.lives,
      level: state.level,
      grainsEaten: state.grainsEaten,
      powerEaten: state.powerEaten,
      grainsRemaining: state.grainsRemaining,
      pestsEaten: state.pestsEaten,
      tick: state.tick,
      paused: pausedRef.current,
      phase: state.phase,
    });
  };

  const ensureRunning = () => {
    if (rafRef.current != null) return;
    lastRef.current = performance.now();
    const frame = (t: number) => {
      const state = stateRef.current;
      if (!state) {
        rafRef.current = null;
        return;
      }

      const raw = t - lastRef.current;
      lastRef.current = t;

      if (state.phase === CUTSCENE) {
        // The simulation does not advance at all here. The cutscene has its own clock,
        // and when it runs out — or the player skips, or reduced motion skips it before
        // the first frame — the run picks up exactly where it stopped.
        if (reducedRef.current) {
          endCutscene(state);
        } else {
          cutsceneMsRef.current += Math.min(Math.max(raw, 0), MAX_FRAME_MS);
          if (cutsceneMsRef.current >= CUTSCENE_TICKS * TICK_MS) endCutscene(state);
        }
        accRef.current = 0;
        paint();
        publishStats(t);
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      cutsceneMsRef.current = 0;

      if (!pausedRef.current) {
        // Clamp before accumulating: a backgrounded tab or a long GC pause must not
        // become hundreds of simulated ticks the moment we come back.
        accRef.current += Math.min(Math.max(raw, 0), MAX_FRAME_MS);
        let n = 0;
        while (accRef.current >= TICK_MS && n < MAX_TICKS_PER_FRAME) {
          stepGame(state);
          accRef.current -= TICK_MS;
          n++;
        }
        if (n >= MAX_TICKS_PER_FRAME) accRef.current = 0; // drop the backlog
      }

      paint();
      publishStats(t);
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  };

  useImperativeHandle(ref, () => ({
    reset: () => {
      stateRef.current = createGame();
      accRef.current = 0;
      cutsceneMsRef.current = 0;
      pausedRef.current = false;
      bake();
      paint();
      publishStats(performance.now(), true);
    },
    togglePause: () => {
      pausedRef.current = !pausedRef.current;
      publishStats(performance.now(), true);
      return pausedRef.current;
    },
    steer: (dir: Dir) => {
      const state = stateRef.current;
      if (!state) return;
      // On-screen controls skip an interstitial too, for the same reason the keyboard
      // does: a tap should mean "get on with it", not nothing.
      if (state.phase === CUTSCENE) {
        endCutscene(state);
        return;
      }
      setWanted(state, dir);
    },
  }));

  // --- boot -----------------------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    stateRef.current = createGame();

    /**
     * Letterbox: pick the largest whole-pixel tile that fits both axes, then size the
     * canvas to exactly COLS×ROWS tiles. The wrapper centres it, so the maze keeps its
     * 28:31 aspect at any viewport without CSS scaling blurring the render.
     */
    let retry = 0;
    const resize = () => {
      const box = wrap.getBoundingClientRect();

      // A degenerate box means layout has not settled yet (or an ancestor has no
      // definite height). Retry on the next frame rather than committing to a size —
      // committing here is what produced the 4px-tile bug: the canvas was sized from a
      // bad measurement, the content-sized wrapper then shrank to the canvas, and the
      // next measurement agreed with itself forever.
      if (box.width < COLS || box.height < ROWS) {
        if (retry < 60) {
          retry++;
          requestAnimationFrame(resize);
        }
        return;
      }
      retry = 0;

      const tilePx = Math.floor(Math.min(box.width / COLS, box.height / ROWS));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (tilePx === tileRef.current && dpr === dprRef.current) return;

      tileRef.current = tilePx;
      dprRef.current = dpr;
      const w = COLS * tilePx;
      const h = ROWS * tilePx;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      bake();
      paint();
    };
    resize();

    // Observe the WRAPPER, not the canvas: this handler resizes the canvas, and
    // observing the thing you resize is how you get a feedback loop.
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    ensureRunning();

    return () => {
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stateRef.current = null;
      wallsRef.current = null;
      grainsRef.current = null;
      flashRef.current = null;
      bakedRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      // Cutscenes are skippable, and by ANY key rather than a documented one — a player
      // who wants the interstitial gone should not have to find out which button does it.
      const showing = stateRef.current;
      if (showing && showing.phase === CUTSCENE) {
        e.preventDefault();
        endCutscene(showing);
        return;
      }

      const dir = KEY_TO_DIR[e.key];
      if (dir !== undefined) {
        // Arrow keys scroll the page by default, which would fight every input.
        e.preventDefault();
        const state = stateRef.current;
        if (state) setWanted(state, dir);
        return;
      }
      if (e.key === "p" || e.key === "P" || e.key === "Escape") {
        e.preventDefault();
        pausedRef.current = !pausedRef.current;
        publishStats(performance.now(), true);
      }
    };
    // Not passive: we preventDefault on the arrow keys.
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // --- pause when the page is not visible -----------------------------------
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        pausedRef.current = true;
        publishStats(performance.now(), true);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  return (
    // The canvas is taken OUT of flow and centred absolutely so it can never
    // contribute to the size of the box being measured. Measuring an ancestor of the
    // thing you resize is a feedback loop waiting to happen; this makes it structurally
    // impossible rather than merely unlikely.
    <div ref={wrapRef} className={className} style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="RICE CHOMP maze. Steer the grain of rice with the arrow keys to clear every grain."
        style={{
          display: "block",
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          touchAction: "none",
        }}
      />
    </div>
  );
});
