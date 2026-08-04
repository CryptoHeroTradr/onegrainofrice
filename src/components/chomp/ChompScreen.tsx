"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { ChompCanvas, type ChompCanvasHandle, type ChompStats } from "./ChompCanvas";
import { GAMEOVER } from "./engine/game";

/**
 * RICE CHOMP — the screen. HUD, framing and controls; the game itself is
 * <ChompCanvas />.
 *
 * PHASE 3: the four pests, the chase, lives and cornering. Still keyboard only; no audio,
 * no bonus items, no leaderboard. The chrome stays out of the way — what is on show is
 * what tells you the chase is working.
 *
 * The HUD is marked translate="no": TranslateProvider mounts Google Translate site-wide
 * and it will happily rewrite live score digits mid-run.
 */

const HUD_LABEL = "font-mono text-[0.6rem] tracking-[0.18em] text-steamed/45 uppercase";
const HUD_VALUE = "font-display-round text-2xl leading-none font-semibold tabular-nums";

function Stat({ label, value, tone = "text-steamed" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={HUD_LABEL}>{label}</span>
      <span className={`${HUD_VALUE} ${tone}`}>{value}</span>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center border border-steamed/25 bg-steamed/5 px-1.5 py-0.5 font-mono text-[0.7rem] text-steamed/80">
      {children}
    </kbd>
  );
}

export function ChompScreen() {
  const reduced = usePrefersReducedMotion();
  const gameRef = useRef<ChompCanvasHandle>(null);
  const [stats, setStats] = useState<ChompStats>({
    score: 0,
    lives: 3,
    level: 1,
    grainsEaten: 0,
    powerEaten: 0,
    grainsRemaining: 0,
    pestsEaten: 0,
    tick: 0,
    paused: false,
    phase: 0,
  });

  // Identity-stable so ChompCanvas never re-runs its boot effect.
  const onStats = useCallback((s: ChompStats) => setStats(s), []);

  const gameOver = stats.phase === GAMEOVER;
  const seconds = (stats.tick / 60).toFixed(1);

  return (
    // A GRID with a definite height, not `min-h-screen` + `flex-1`. `min-height` gives
    // descendants nothing to resolve `height: 100%` against, so the canvas wrapper used
    // to collapse to its own content and lock the maze at the minimum tile size. An
    // explicit `100svh` (small viewport height — no jump when mobile browser chrome
    // hides) makes the 1fr row's height definite, so `h-full` inside it resolves.
    <main className="grid h-[100svh] grid-rows-[auto_auto_1fr_auto] overflow-hidden bg-nori text-steamed">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-4 pt-4 pb-3 sm:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display-round text-2xl font-semibold text-khaki sm:text-3xl">
            RICE CHOMP
          </h1>
          <span className="font-mono text-[0.6rem] tracking-[0.18em] text-steamed/35 uppercase">
            Phase 3 · the pests
          </span>
        </div>
        <Link
          href="/"
          className="font-mono text-xs text-steamed/50 underline-offset-4 transition-colors hover:text-khaki hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
        >
          ← back to the paddy
        </Link>
      </header>

      <div
        translate="no"
        className="notranslate flex flex-wrap items-end gap-x-8 gap-y-3 border-y border-steamed/10 px-4 py-3 sm:px-6"
      >
        <Stat label="Score" value={String(stats.score)} tone="text-khaki" />
        <Stat label="Lives" value={"◆".repeat(stats.lives) || "—"} tone="text-salmon" />
        <Stat label="Level" value={String(stats.level)} />
        <Stat label="Pests" value={String(stats.pestsEaten)} tone="text-tuna" />
        <Stat label="Left" value={String(stats.grainsRemaining)} tone="text-steamed/70" />
        <Stat label="Time" value={`${seconds}s`} tone="text-steamed/70" />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => gameRef.current?.togglePause()}
            className="min-h-9 border border-steamed/25 px-3 font-mono text-[0.65rem] tracking-[0.15em] text-steamed/70 uppercase transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
          >
            {stats.paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={() => gameRef.current?.reset()}
            className="min-h-9 border border-steamed/25 px-3 font-mono text-[0.65rem] tracking-[0.15em] text-steamed/70 uppercase transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
          >
            Restart
          </button>
        </div>
      </div>

      {/* min-h-0 stops the 1fr row being forced taller by its content. */}
      <div className="relative min-h-0 p-2 sm:p-4">
        <ChompCanvas
          ref={gameRef}
          onStats={onStats}
          reducedMotion={reduced}
          className="h-full w-full"
        />

        {(stats.paused || gameOver) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-nori/70">
            <p className="font-display-round text-3xl font-semibold text-khaki">
              {gameOver ? "Game over" : "Paused"}
            </p>
            {gameOver && (
              <p className="font-mono text-xs text-steamed/60">
                {stats.score} points · level {stats.level}
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-2 pb-5 font-mono text-xs text-steamed/45 sm:px-6">
        <span className="flex items-center gap-1.5">
          <Key>←</Key>
          <Key>↑</Key>
          <Key>↓</Key>
          <Key>→</Key>
          <span className="ml-1">or</span>
          <Key>W</Key>
          <Key>A</Key>
          <Key>S</Key>
          <Key>D</Key>
          <span className="ml-1">to steer</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Key>P</Key>
          <span>pause</span>
        </span>
        <span className="text-steamed/30">
          Turn early into a corner and you gain ground — the pests can only turn dead
          centre. Keyboard only for now; touch controls come next.
        </span>
      </footer>
    </main>
  );
}
