"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { RiceBowl } from "./riceBowlEngine";

export interface RiceBowlHandle {
  /**
   * Spawn one grain. clientX/clientY are viewport coords of the RELEASE point
   * (e.g. the mascot, or the click) so the grain falls from there; both default
   * to the bowl centre / canvas top.
   */
  spawn: (clientX?: number, clientY?: number) => void;
  /** Materialise `n` already-earned grains at once (returning visitor). */
  prefill: (n: number) => void;
}

/**
 * Interactive <canvas> rice bowl occupying the bottom third of the page. Clicks
 * spawn falling grains that pile and overflow. Renders via requestAnimationFrame
 * (idle-stopped when nothing animates), sized to devicePixelRatio, responsive on
 * resize. The heavy lifting lives in ./riceBowlEngine (no physics library).
 */
export const RiceBowlCanvas = forwardRef<
  RiceBowlHandle,
  {
    onGrain?: (clientX: number, clientY: number) => void;
    /** Reports where the mascot's feet should sit (viewport y) as the pile grows. */
    onMascotFeet?: (viewportY: number) => void;
    className?: string;
  }
>(function RiceBowlCanvas({ onGrain, onMascotFeet, className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<RiceBowl | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastRef = useRef(0);
    const canvasTopRef = useRef(0); // viewport y of the canvas' top edge
    const lastFeetRef = useRef(Number.NaN);
    const onFeetRef = useRef(onMascotFeet);
    onFeetRef.current = onMascotFeet;

    // Report the mascot's resting y (viewport), throttled to real changes so the
    // parent only re-positions the DOM mascot when the pile crest actually moves.
    const reportFeet = () => {
      const engine = engineRef.current;
      if (!engine) return;
      const y = canvasTopRef.current + engine.mascotFeetY();
      if (Number.isNaN(lastFeetRef.current) || Math.abs(y - lastFeetRef.current) > 0.5) {
        lastFeetRef.current = y;
        onFeetRef.current?.(y);
      }
    };

    // Keep the render loop alive while grains animate; stop when idle.
    const ensureRunning = () => {
      if (rafRef.current != null) return;
      lastRef.current = performance.now();
      const frame = (t: number) => {
        const engine = engineRef.current;
        const ctx = ctxRef.current;
        if (!engine || !ctx) {
          rafRef.current = null;
          return;
        }
        const dt = Math.min(0.05, Math.max(0, (t - lastRef.current) / 1000));
        lastRef.current = t;
        engine.step(dt);
        engine.render(ctx);
        reportFeet();
        rafRef.current = engine.active ? requestAnimationFrame(frame) : null;
      };
      rafRef.current = requestAnimationFrame(frame);
    };

    useImperativeHandle(ref, () => ({
      spawn: (clientX?: number, clientY?: number) => {
        const canvas = canvasRef.current;
        const engine = engineRef.current;
        if (!canvas || !engine) return;
        const rect = canvas.getBoundingClientRect();
        const x = clientX == null ? rect.width / 2 : clientX - rect.left;
        const y = clientY == null ? undefined : clientY - rect.top;
        engine.spawn(x, y);
        ensureRunning();
      },
      prefill: (n: number) => {
        engineRef.current?.prefill(n);
        ensureRunning();
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const engine = new RiceBowl();
      engineRef.current = engine;
      ctxRef.current = ctx;

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
      const applyReduce = () => (engine.reducedMotion = reduce.matches);
      applyReduce();
      reduce.addEventListener("change", applyReduce);

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0) return;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        engine.resize(w, h, dpr);
        // DOCUMENT-space top, not viewport-space. The mascot is positioned with
        // `style.top` on an absolutely-positioned element, which is resolved
        // against its offsetParent — i.e. document space. Reporting a viewport y
        // here made the two spaces diverge by exactly the scroll offset, so once
        // the page scrolled (which it does on mobile, where the content stack and
        // the play area overflow the screen) the mascot was placed that far too
        // high and hung in the air above the rice. Adding scrollY makes this
        // scroll-invariant, so it only needs recomputing on resize.
        canvasTopRef.current = canvas.getBoundingClientRect().top + window.scrollY;
        ensureRunning(); // render at least one frame (also reports mascot feet)
      };
      resize();

      const ro = new ResizeObserver(resize);
      ro.observe(canvas);

      return () => {
        ro.disconnect();
        reduce.removeEventListener("change", applyReduce);
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        engineRef.current = null;
        ctxRef.current = null;
      };
    }, []);

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const engine = engineRef.current;
      const canvas = canvasRef.current;
      if (!engine || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      engine.spawn(e.clientX - rect.left, e.clientY - rect.top);
      ensureRunning();
      onGrain?.(e.clientX, e.clientY);
    };

    return (
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        aria-label="Rice bowl — click to drop a grain"
        role="img"
        className={className}
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
      />
    );
  },
);
