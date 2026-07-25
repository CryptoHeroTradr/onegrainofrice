"use client";

import { useEffect, useRef, useState } from "react";
import { asset } from "@/lib/asset";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { getHighScore, recordScore } from "@/lib/highscore";
import { playClack } from "@/lib/sound";

/**
 * Grain-catch: grains fall; catch them by pinching (pointer-down) over one with
 * the chopstick cursor. Score + session-only high score. A community board is
 * pulled from /api/leaderboard (RiceDAO town leaderboard, read-only). Under
 * reduced motion the falling animation is disabled and a note is shown instead —
 * it never blocks anything else.
 */

type Grain = { x: number; y: number; vy: number; r: number };
const CATCH_RADIUS = 34;

export function GrainCatch() {
  const reduced = usePrefersReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const grains = useRef<Grain[]>([]);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const scoreRef = useRef(0);

  const [score, setScore] = useState(0);
  const [high, setHigh] = useState<number>(getHighScore); // session-only, lazy read
  const [isHigh, setIsHigh] = useState(false);
  const [board, setBoard] = useState<{ name: string; score: number }[]>([]);

  useEffect(() => {
    let alive = true;
    const loadBoard = async () => {
      try {
        const res = await fetch(asset("/api/leaderboard"), { cache: "no-store" });
        const d: unknown = res.ok ? await res.json() : [];
        if (alive) setBoard(Array.isArray(d) ? d : []);
      } catch {
        /* leave board empty */
      }
    };
    loadBoard();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      sizeRef.current = { w, h };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let last = 0;
    let acc = 0;
    const frame = (now: number) => {
      if (last === 0) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      const { w, h } = sizeRef.current;

      acc += dt;
      const interval = 0.55;
      while (acc >= interval) {
        acc -= interval;
        grains.current.push({
          x: 20 + Math.random() * Math.max(1, w - 40),
          y: -10,
          vy: 90 + Math.random() * 90,
          r: 8 + Math.random() * 4,
        });
      }

      ctx.clearRect(0, 0, w, h);
      const list = grains.current;
      let wr = 0;
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        g.y += g.vy * dt;
        if (g.y < h + 20) {
          list[wr++] = g;
          ctx.save();
          ctx.translate(g.x, g.y);
          ctx.rotate(0.5);
          ctx.fillStyle = "#c4b370";
          ctx.beginPath();
          ctx.ellipse(0, 0, g.r, g.r * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      list.length = wr;
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      grains.current = [];
    };
  }, [reduced]);

  const onCatch = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const list = grains.current;
    let hit = -1;
    let bestD = CATCH_RADIUS * CATCH_RADIUS;
    for (let i = 0; i < list.length; i++) {
      const dx = list[i].x - px;
      const dy = list[i].y - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        hit = i;
      }
    }
    if (hit >= 0) {
      list.splice(hit, 1);
      scoreRef.current += 1;
      setScore(scoreRef.current);
      playClack();
      if (recordScore(scoreRef.current)) {
        setHigh(scoreRef.current);
        setIsHigh(true);
      }
    }
  };

  const reset = () => {
    grains.current = [];
    scoreRef.current = 0;
    setScore(0);
    setIsHigh(false);
  };

  return (
    <section className="mx-auto max-w-3xl px-6 py-12 text-nori">
      <h1 className="text-center font-display-round text-4xl font-bold text-bamboo">grain catch</h1>
      <p className="mt-2 text-center font-mono text-sm text-nori/70">
        Pinch the falling grains with your chopsticks. One point each.
      </p>

      <div className="mt-6 flex items-center justify-center gap-8 font-mono text-sm font-bold">
        <span>
          score <span className="text-2xl text-tuna">{score}</span>
        </span>
        <span>
          best{" "}
          <span className="text-2xl text-bamboo">{high}</span>
          {isHigh && <span className="ml-2 text-xs text-tuna">new high!</span>}
        </span>
        <button
          type="button"
          onClick={reset}
          className="min-h-9 border-2 border-porcelain px-3 text-xs tracking-widest text-porcelain hover:bg-porcelain hover:text-steamed"
        >
          reset
        </button>
      </div>

      {reduced ? (
        <div className="mt-6 border-2 border-porcelain bg-bone p-8 text-center font-mono text-sm text-nori/70">
          Grain-catch needs motion to play. It’s disabled while “reduce motion” is on — the
          rest of the site works as normal.
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          onPointerDown={onCatch}
          className="mt-6 h-[60vh] w-full touch-none border-2 border-porcelain bg-[#eef2f8]"
          aria-label="Grain catch play area — pinch falling grains to score"
          role="img"
        />
      )}

      {board.length > 0 && (
        <div className="mt-8">
          <p className="font-mono text-xs font-bold tracking-widest text-nori/60 uppercase">
            village leaderboard
          </p>
          <ol className="mt-2 space-y-1 font-mono text-sm">
            {board.map((e, i) => (
              <li key={`${e.name}-${i}`} className="flex justify-between">
                <span>
                  {i + 1}. {e.name}
                </span>
                <span className="text-bamboo">{e.score.toLocaleString("en-US")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="mt-8 text-center font-mono text-xs text-nori/50">
        High score is session-only.
      </p>
    </section>
  );
}
