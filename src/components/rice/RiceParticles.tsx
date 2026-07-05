"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/**
 * Site-wide rice particle system: ONE fixed, pointer-events-none canvas plus an
 * imperative API exposed via context. Performance-capped (MAX_PARTICLES), fixed
 * timestep, self-halting when idle, paused when the tab is hidden, and fully
 * inert under prefers-reduced-motion (renders nothing, no trail).
 */

export type RiceApi = {
  /** Cascade `count` grains from a point (viewport coords), falling with gravity. */
  pour: (opts: { x: number; y: number; count?: number }) => void;
  /** Drive an element's .bowl-fill level (0–100) and drip grains into it. */
  fillBowl: (el: HTMLElement, pct: number) => void;
  /** Drop a single faint grain at the pointer (cursor trail). */
  trail: (x: number, y: number) => void;
};

const NOOP: RiceApi = { pour: () => {}, fillBowl: () => {}, trail: () => {} };
const RiceContext = createContext<RiceApi>(NOOP);

/** Consume the rice API. Returns no-ops if used outside a provider. */
export function useRice(): RiceApi {
  return useContext(RiceContext);
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rx: number; // ellipse radius x (CSS px)
  ry: number;
  rot: number;
  vr: number;
  life: number; // seconds remaining
  maxLife: number;
  color: 0 | 1; // index into tints
};

const MAX_PARTICLES = 600;
const GRAVITY = 1500; // px/s^2
const DRAG = 0.6; // horizontal damping per second
const STEP = 1 / 60; // fixed physics timestep
const MAX_FRAME = 0.1; // clamp long frames (tab refocus) to avoid spiral
const TRAIL_THROTTLE = 30; // ms
const BOWL_EMIT_STEP = 6; // emit a drip each +6% fill

export function RiceProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const reducedRef = useRef(false);
  const hiddenRef = useRef(false);
  const tints = useRef<[string, string]>(["#FBF7EE", "#C4B370"]);
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0 });
  const lastTrail = useRef(0);
  const bowlLevels = useRef<WeakMap<HTMLElement, number>>(new WeakMap());

  // --- drawing ---------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    ctx.clearRect(0, 0, w, h);
    const list = particles.current;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const alpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.5)));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = tints.current[p.color];
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, p.rot, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, []);

  // --- fixed-timestep physics ------------------------------------------------
  const step = useCallback((dt: number) => {
    const list = particles.current;
    const floor = sizeRef.current.h + 40;
    const dragK = 1 - DRAG * dt;
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.vy += GRAVITY * dt;
      p.vx *= dragK;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.life -= dt;
      if (p.life > 0 && p.y < floor) {
        list[write++] = p;
      }
    }
    list.length = write;
  }, []);

  const accRef = useRef(0);
  const lastRef = useRef(0);
  // The frame lives in a ref so it can re-schedule itself without being its own
  // dependency (keeps the RAF loop stable and lint-clean).
  const frameRef = useRef<(now: number) => void>(() => {});

  useEffect(() => {
    frameRef.current = (now: number) => {
      if (!runningRef.current) return;
      if (lastRef.current === 0) lastRef.current = now;
      let dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (dt > MAX_FRAME) dt = MAX_FRAME;
      accRef.current += dt;
      let guard = 0;
      while (accRef.current >= STEP && guard++ < 8) {
        step(STEP);
        accRef.current -= STEP;
      }
      draw();
      if (particles.current.length === 0) {
        runningRef.current = false;
        rafRef.current = null;
        lastRef.current = 0;
        accRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(frameRef.current);
    };
  }, [step, draw]);

  const ensureRunning = useCallback(() => {
    if (reducedRef.current || hiddenRef.current) return;
    if (runningRef.current) return;
    runningRef.current = true;
    lastRef.current = 0;
    accRef.current = 0;
    rafRef.current = requestAnimationFrame(frameRef.current);
  }, []);

  const spawn = useCallback((p: Particle) => {
    const list = particles.current;
    if (list.length >= MAX_PARTICLES) list.shift(); // drop oldest
    list.push(p);
  }, []);

  // --- public API ------------------------------------------------------------
  const pour = useCallback<RiceApi["pour"]>(
    ({ x, y, count = 22 }) => {
      if (reducedRef.current) return;
      const n = Math.min(count, MAX_PARTICLES);
      for (let i = 0; i < n; i++) {
        const size = 1.4 + Math.random() * 2;
        spawn({
          x: x + (Math.random() - 0.5) * 14,
          y: y + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * 220,
          vy: 40 + Math.random() * 180,
          rx: size,
          ry: size * (0.4 + Math.random() * 0.15),
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 8,
          life: 1.1 + Math.random() * 1.1,
          maxLife: 2.2,
          color: Math.random() < 0.5 ? 0 : 1,
        });
      }
      ensureRunning();
    },
    [spawn, ensureRunning],
  );

  const trail = useCallback<RiceApi["trail"]>(
    (x, y) => {
      if (reducedRef.current) return;
      const size = 1.2 + Math.random() * 1.2;
      spawn({
        x,
        y,
        vx: (Math.random() - 0.5) * 30,
        vy: 20 + Math.random() * 40,
        rx: size,
        ry: size * 0.45,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 4,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7,
        color: Math.random() < 0.5 ? 0 : 1,
      });
      ensureRunning();
    },
    [spawn, ensureRunning],
  );

  const fillBowl = useCallback<RiceApi["fillBowl"]>(
    (el, pct) => {
      const clamped = Math.max(0, Math.min(100, pct));
      // The fill level itself is a static reflection of scroll — safe under
      // reduced motion. Only the grain drips (canvas) are motion-gated.
      el.style.setProperty("--bowl-level", `${clamped.toFixed(1)}%`);
      if (reducedRef.current) return;
      const last = bowlLevels.current.get(el) ?? 0;
      if (clamped - last >= BOWL_EMIT_STEP) {
        bowlLevels.current.set(el, clamped);
        const rect = el.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < sizeRef.current.h) {
          for (let i = 0; i < 5; i++) {
            const size = 1.4 + Math.random() * 1.6;
            spawn({
              x: rect.left + Math.random() * rect.width,
              y: Math.max(0, rect.top) + 4,
              vx: (Math.random() - 0.5) * 40,
              vy: 30 + Math.random() * 60,
              rx: size,
              ry: size * 0.45,
              rot: Math.random() * Math.PI,
              vr: (Math.random() - 0.5) * 5,
              life: 0.8 + Math.random() * 0.8,
              maxLife: 1.6,
              color: Math.random() < 0.5 ? 0 : 1,
            });
          }
          ensureRunning();
        }
      } else if (clamped < last) {
        bowlLevels.current.set(el, clamped);
      }
    },
    [spawn, ensureRunning],
  );

  // --- setup: canvas sizing, reduced-motion, visibility, cursor trail --------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Cache tints from CSS vars (fallback to defaults).
    const cs = getComputedStyle(document.documentElement);
    const steamed = cs.getPropertyValue("--color-steamed").trim();
    const khaki = cs.getPropertyValue("--color-khaki").trim();
    tints.current = [steamed || "#FBF7EE", khaki || "#C4B370"];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      dprRef.current = dpr;
      const w = window.innerWidth;
      const h = window.innerHeight;
      sizeRef.current = { w, h };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Reduced motion.
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyReduced = () => {
      reducedRef.current = mql.matches;
      if (mql.matches) {
        particles.current.length = 0;
        runningRef.current = false;
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h);
      }
    };
    applyReduced();
    mql.addEventListener("change", applyReduced);

    // Pause when tab hidden.
    const onVisibility = () => {
      hiddenRef.current = document.hidden;
      if (document.hidden) {
        runningRef.current = false;
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (particles.current.length > 0) {
        ensureRunning();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Cursor trail — mouse only, throttled, off under reduced motion.
    const onPointerMove = (e: PointerEvent) => {
      if (reducedRef.current || e.pointerType === "touch") return;
      const now = e.timeStamp;
      if (now - lastTrail.current < TRAIL_THROTTLE) return;
      lastTrail.current = now;
      trail(e.clientX, e.clientY);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      window.removeEventListener("resize", resize);
      mql.removeEventListener("change", applyReduced);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      runningRef.current = false;
    };
  }, [ensureRunning, trail]);

  const api = useMemo<RiceApi>(() => ({ pour, fillBowl, trail }), [pour, fillBowl, trail]);

  return (
    <RiceContext.Provider value={api}>
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-rice-canvas=""
        className="pointer-events-none fixed inset-0 z-40"
      />
    </RiceContext.Provider>
  );
}
