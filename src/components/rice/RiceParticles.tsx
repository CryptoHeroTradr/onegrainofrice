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
import { usePathname } from "next/navigation";
import { isPlaySurface } from "@/lib/playSurfaces";

/**
 * Site-wide rice particle system: ONE fixed, pointer-events-none canvas plus an
 * imperative API exposed via context. Performance-capped (MAX_PARTICLES), fixed
 * timestep, self-halting when idle, paused when the tab is hidden, and fully
 * inert under prefers-reduced-motion (renders nothing, no trail).
 */

export type RiceApi = {
  /** Cascade `count` grains from a point (viewport coords), falling with gravity. */
  pour: (opts: { x: number; y: number; count?: number }) => void;
  /**
   * Fire a HOSE of grains from a point: a tight arcing jet, sprayed sideways in
   * `dir` (1 = right, -1 = left), that grows as it flies and sails clear off the
   * screen. Unlike `pour` (which only rains downward), these launch up and out.
   *
   * `rx`/`ry` are the grain's STARTING ellipse radii — callers pass the size of
   * the grains they already render (the game passes its bowl-grain size) and the
   * jet swells from there.
   */
  hose: (opts: {
    x: number;
    y: number;
    count?: number;
    dir?: 1 | -1;
    rx?: number;
    ry?: number;
  }) => void;
  /** Drive an element's .bowl-fill level (0–100) and drip grains into it. */
  fillBowl: (el: HTMLElement, pct: number) => void;
  /** Drop a single faint grain at the pointer (cursor trail). */
  trail: (x: number, y: number) => void;
};

const NOOP: RiceApi = {
  pour: () => {},
  hose: () => {},
  fillBowl: () => {},
  trail: () => {},
};
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
  /** Fractional growth per second (0.8 ⇒ +80%/s). Omitted ⇒ fixed size. */
  grow?: number;
  /** Per-particle overrides. The firehose needs a gentler arc and no horizontal
   *  damping so its grains actually reach the edge of the screen. */
  gravity?: number;
  drag?: number;
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
  const maxParticles = useRef(MAX_PARTICLES); // capped harder on mobile (set in setup)
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const reducedRef = useRef(false);
  const hiddenRef = useRef(false);
  const tints = useRef<[string, string]>(["#FBF7EE", "#C4B370"]);
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0 });
  const lastTrail = useRef(0);
  const bowlLevels = useRef<WeakMap<HTMLElement, number>>(new WeakMap());

  // The provider stays mounted everywhere so `useRice()` never changes identity, but on a
  // play surface it renders nothing and traces nothing. A ref rather than a dependency:
  // the pointer listener should not be torn down and rebuilt on every navigation.
  const onPlaySurface = isPlaySurface(usePathname());
  const playSurfaceRef = useRef(onPlaySurface);
  // Mirrored in an effect rather than assigned during render: writing a ref while
  // rendering is not safe under concurrent rendering, and the listener only reads it
  // on a real pointer event, which is always after commit.
  useEffect(() => {
    playSurfaceRef.current = onPlaySurface;
  }, [onPlaySurface]);

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
    // Grains that fly clear of the viewport are retired, so the firehose (whose
    // grains are deliberately fast enough to exit) can't accumulate off-screen.
    const leftEdge = -240;
    const rightEdge = sizeRef.current.w + 240;
    const dragK = 1 - DRAG * dt;
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.vy += (p.gravity ?? GRAVITY) * dt;
      p.vx *= p.drag != null ? 1 - p.drag * dt : dragK;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.grow) {
        const s = 1 + p.grow * dt;
        p.rx *= s;
        p.ry *= s;
      }
      p.life -= dt;
      if (p.life > 0 && p.y < floor && p.x > leftEdge && p.x < rightEdge) {
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
    // Only the hidden-tab check gates the loop now. It also bailed on reduced
    // motion, which meant that even once `hose` spawned grains the RAF loop never
    // started and nothing was ever drawn. The ambient emitters (pour/trail) still
    // decline to spawn under reduced motion, so the loop simply stays idle unless
    // an explicit, user-earned effect puts grains in it — and it self-halts the
    // moment the list empties.
    if (hiddenRef.current) return;
    if (runningRef.current) return;
    runningRef.current = true;
    lastRef.current = 0;
    accRef.current = 0;
    rafRef.current = requestAnimationFrame(frameRef.current);
  }, []);

  const spawn = useCallback((p: Particle) => {
    const list = particles.current;
    if (list.length >= maxParticles.current) list.shift(); // drop oldest
    list.push(p);
  }, []);

  // --- public API ------------------------------------------------------------
  const pour = useCallback<RiceApi["pour"]>(
    ({ x, y, count = 22 }) => {
      // Nothing is painted on a play surface (the canvas is display:none there), so
      // spawning here would start a rAF loop drawing into a hidden element while the
      // game beside it is trying to hold 60fps. Added Phase 5.6, when the site nav —
      // whose Buy button pours — was mounted on /chomp.
      if (playSurfaceRef.current || reducedRef.current) return;
      const n = Math.min(count, maxParticles.current);
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

  // Firehose: grains erupt UPWARD and out to the sides, like a firework. `dir`
  // leans the fan left or right (alternating per trigger), the wide cone throws
  // the edges out sideways, and gravity arcs everything back down on its own.
  // Each grain also swells as it flies, which reads as rushing toward the viewer.
  // `drag: 0` plus a light gravity let the spray carry clear off screen rather
  // than stalling mid-air.
  const hose = useCallback<RiceApi["hose"]>(
    ({ x, y, count = 50, dir = 1, rx, ry }) => {
      // NOT gated on reduced motion, unlike the ambient `pour`/`trail` decoration.
      // This is the payoff the player deliberately earned by mashing, the rice
      // bowl it erupts from animates under reduced motion anyway, and silently
      // dropping it left reduced-motion users convinced the feature was broken.
      // Under reduced motion it's toned down: fewer grains, gentler throw.
      const calm = reducedRef.current;
      const n = Math.min(calm ? Math.ceil(count / 2) : count, maxParticles.current);
      // Screen angles: 0° = right, +90° = DOWN, -90° = UP. Fire UPWARD and out to
      // the side — a firework, not a dump. `dir` leans the cone left or right, and
      // the wide spread carries the edges of the fan out sideways. Gravity still
      // arcs them back down on their own, which is what makes it read as a burst.
      const center = -90 + dir * 30;
      const cone = 96; // wide fan: up through the diagonals and out to the sides

      for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n - 1) - 0.5;
        const deg = center + t * cone + (Math.random() - 0.5) * 10;
        const a = (deg * Math.PI) / 180;
        const speed = (560 + Math.random() * 440) * (calm ? 0.6 : 1);

        const fallback = 2 + Math.random() * 2.2;
        const grainRx = rx ?? fallback;
        const grainRy = ry ?? fallback * (0.4 + Math.random() * 0.2);

        spawn({
          x: x + (Math.random() - 0.5) * 18,
          y: y + (Math.random() - 0.5) * 18,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          rx: grainRx,
          ry: grainRy,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 12,
          life: 1.8 + Math.random() * 0.9,
          maxLife: 2.7,
          color: Math.random() < 0.5 ? 0 : 1,
          grow: 1.35, // +135%/s — the "rushing at the camera" cue
          gravity: 340,
          drag: 0,
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

    // Cap particles harder on mobile / touch to protect the frame budget.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    maxParticles.current = coarse || window.innerWidth < 640 ? 250 : MAX_PARTICLES;

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

    // Cursor trail — mouse only, throttled, off under reduced motion, and off entirely
    // on a play surface: trailing grains across a maze full of grains is noise on exactly
    // the pixels the player is reading.
    const onPointerMove = (e: PointerEvent) => {
      if (playSurfaceRef.current) return;
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

  const api = useMemo<RiceApi>(
    () => ({ pour, hose, fillBowl, trail }),
    [pour, hose, fillBowl, trail],
  );

  return (
    <RiceContext.Provider value={api}>
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-rice-canvas=""
        className="pointer-events-none fixed inset-0 z-40"
        // Belt and braces with the trail guard above: even if something else calls pour()
        // or hose() while a game is on screen, nothing lands on top of the board.
        style={onPlaySurface ? { display: "none" } : undefined}
      />
    </RiceContext.Provider>
  );
}
