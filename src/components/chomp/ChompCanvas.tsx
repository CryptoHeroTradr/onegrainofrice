"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { COLS, ROWS } from "./engine/maze";
import {
  createGame,
  setWanted,
  tick as stepGame,
  type GameState,
} from "./engine/game";
import { DOWN, LEFT, RIGHT, TICK_HZ, UP, type Dir } from "./engine/types";
import { bakeGrains, bakeWalls, drawPlayer, drawPower, syncGrainLayer } from "./engine/render";

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

export interface ChompStats {
  grainsEaten: number;
  powerEaten: number;
  grainsRemaining: number;
  tick: number;
  paused: boolean;
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
  const grainsRef = useRef<HTMLCanvasElement | null>(null);
  const bakedRef = useRef<Uint8Array | null>(null);
  const tileRef = useRef(0);
  const dprRef = useRef(1);

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
    grainsRef.current = bakeGrains(state.grid, tilePx, dpr);
    bakedRef.current = Uint8Array.from(state.grid);
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);

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
    drawPlayer(ctx, state.player, tilePx, !state.player.blocked);
  };

  const publishStats = (now: number, force = false) => {
    const state = stateRef.current;
    if (!state) return;
    if (!force && now - statsAtRef.current < STATS_MS) return;
    statsAtRef.current = now;
    onStatsRef.current?.({
      grainsEaten: state.grainsEaten,
      powerEaten: state.powerEaten,
      grainsRemaining: state.grainsRemaining,
      tick: state.tick,
      paused: pausedRef.current,
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
      if (state) setWanted(state, dir);
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
    const resize = () => {
      const box = wrap.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const tilePx = Math.max(4, Math.floor(Math.min(box.width / COLS, box.height / ROWS)));
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
    <div ref={wrapRef} className={className}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="RICE CHOMP maze. Steer the grain of rice with the arrow keys to clear every grain."
        style={{ display: "block", margin: "0 auto", touchAction: "none" }}
      />
    </div>
  );
});
