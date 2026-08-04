"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { ChompCanvas, type ChompCanvasHandle, type ChompStats } from "./ChompCanvas";
import { GAMEOVER } from "./engine/game";
import type { Dir } from "./engine/types";
import { BonusIcons } from "./BonusIcons";
import { ChompAttract } from "./ChompAttract";
import { ChompGameOver } from "./ChompGameOver";
import { ChompPause } from "./ChompPause";
import { ChompSettings } from "./ChompSettings";
import { LivesRow } from "./LivesRow";
import { TouchControls } from "./TouchControls";
import { useContrast, useDpad } from "./prefs";
import { bestScore, recordScore } from "./scores";

/**
 * RICE CHOMP — the screen. HUD, framing, menus and controls; the game itself is
 * <ChompCanvas />.
 *
 * PHASE 5: audio, the attract screen, a pause screen and a game-over screen, touch
 * controls, reduced motion and the high-contrast toggle. Still no leaderboard.
 *
 * NONE OF IT REACHES THE SIMULATION. The menus run while the engine is not being
 * ticked at all, the toggles change what is painted and what is heard, and the
 * d-pad and the swipe surface both end at setWanted() — the same call the arrow
 * keys make and already part of the input trace. That is the same argument the
 * cutscenes rest on, and it is written out in full in engine/cues.ts.
 *
 * The level indicator is a row of bonus-item icons rather than a number, which is
 * the spec's ask and also the cheapest place to catch a legibility problem — six
 * silhouettes side by side at 22px is a harder read than any of them gets on the
 * board.
 *
 * The HUD is marked translate="no": TranslateProvider mounts Google Translate
 * site-wide and it will happily rewrite live score digits mid-run.
 */

const HUD_LABEL = "font-mono text-[0.55rem] tracking-[0.18em] text-steamed/45 uppercase";
const HUD_VALUE =
  "font-display-round text-xl leading-none font-semibold tabular-nums sm:text-2xl";

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
  const contrast = useContrast();
  const dpad = useDpad();
  const gameRef = useRef<ChompCanvasHandle>(null);
  const [stats, setStats] = useState<ChompStats>({
    score: 0,
    lives: 3,
    level: 1,
    startLevel: 1,
    grainsEaten: 0,
    powerEaten: 0,
    grainsRemaining: 0,
    pestsEaten: 0,
    tick: 0,
    paused: false,
    phase: 0,
    attract: true,
    runId: 0,
  });

  // Identity-stable so ChompCanvas never re-runs its boot effect.
  const onStats = useCallback((s: ChompStats) => setStats(s), []);

  const gameOver = stats.phase === GAMEOVER && !stats.attract;
  const seconds = (stats.tick / 60).toFixed(1);
  // ?level=N started this run partway up the curve. Say so on the HUD and on the
  // game-over card: a debug run must never be mistaken for a score, least of all by
  // the person who just played it. Phase 7 gates submission on the same flag — see
  // isScoreSubmittable().
  const debugRun = stats.startLevel !== 1;

  // File the finished run on the local board, exactly once. Keyed on runId rather
  // than on the phase, because the phase stays GAMEOVER for as long as the card is
  // up and an effect that watched it would re-file on every stats publish.
  const [place, setPlace] = useState(0);
  const [best, setBest] = useState(0);
  const filedRef = useRef(0);
  useEffect(() => {
    if (!gameOver || filedRef.current === stats.runId) return;
    filedRef.current = stats.runId;
    // A debug run is not a score. It is kept off the board rather than filed and
    // hidden, so there is nothing to leak into Phase 7's submission path later.
    setPlace(debugRun ? 0 : recordScore(stats.score, stats.level, Date.now()));
    setBest(bestScore());
  }, [gameOver, stats.runId, stats.score, stats.level, debugRun]);

  const steer = useCallback((dir: Dir) => gameRef.current?.steer(dir), []);

  return (
    // A GRID with a definite height, not `min-h-screen` + `flex-1`. `min-height` gives
    // descendants nothing to resolve `height: 100%` against, so the canvas wrapper used
    // to collapse to its own content and lock the maze at the minimum tile size. An
    // explicit `100svh` (small viewport height — no jump when mobile browser chrome
    // hides) makes the 1fr row's height definite, so `h-full` inside it resolves.
    //
    // PORTRAIT IS THE DEFAULT CASE, NOT THE FALLBACK. The maze is 28:31, very nearly
    // square, so it letterboxes into a portrait phone with room to spare — which is
    // why there is no rotate prompt anywhere in this file and must never be one. The
    // rows above and below the board are what get compact on a small screen; the board
    // itself just takes the 1fr row and centres in it.
    <main className="grid h-[100svh] grid-rows-[auto_auto_1fr_auto] overflow-hidden bg-nori text-steamed">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 pt-3 pb-2 sm:px-6 sm:pt-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display-round text-xl font-semibold text-khaki sm:text-3xl">
            RICE CHOMP
          </h1>
          <span className="hidden font-mono text-[0.6rem] tracking-[0.18em] text-steamed/35 uppercase sm:inline">
            Phase 5.5 · the board
          </span>
        </div>
        <Link
          href="/"
          className="font-mono text-[0.7rem] text-steamed/50 underline-offset-4 transition-colors hover:text-khaki hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki sm:text-xs"
        >
          ← back to the paddy
        </Link>
      </header>

      <div
        translate="no"
        className="notranslate flex flex-wrap items-end gap-x-5 gap-y-2 border-y border-steamed/10 px-4 py-2 sm:gap-x-8 sm:px-6 sm:py-3"
      >
        <Stat label="Score" value={stats.score.toLocaleString()} tone="text-khaki" />
        <div className="flex flex-col gap-1">
          <span className={HUD_LABEL}>Lives</span>
          <LivesRow lives={stats.lives} />
        </div>
        <div className="flex flex-col gap-1">
          <span className={HUD_LABEL}>Level {stats.level}</span>
          <BonusIcons level={stats.level} />
        </div>
        {/* Secondary numbers are desktop-only. On a phone the HUD is competing with
            the board for the one thing there is not enough of, and "pests eaten" is
            not worth a row of maze. */}
        <div className="hidden items-end gap-8 sm:flex">
          <Stat label="Pests" value={String(stats.pestsEaten)} tone="text-tuna" />
          <Stat label="Left" value={String(stats.grainsRemaining)} tone="text-steamed/70" />
          <Stat label="Time" value={`${seconds}s`} tone="text-steamed/70" />
        </div>
        {debugRun && (
          <span
            title={`Started on level ${stats.startLevel} — not a submittable run`}
            className="self-center border border-salmon/50 px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.18em] text-salmon uppercase"
          >
            Debug · from {stats.startLevel}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => gameRef.current?.togglePause()}
            disabled={stats.attract || gameOver}
            className="min-h-9 border border-steamed/25 px-3 font-mono text-[0.65rem] tracking-[0.15em] text-steamed/70 uppercase transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki disabled:opacity-30 disabled:hover:border-steamed/25 disabled:hover:text-steamed/70"
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
          contrast={contrast}
          className="h-full w-full"
        />

        {stats.attract && (
          <ChompAttract
            onStart={() => gameRef.current?.start()}
            reducedMotion={reduced}
          />
        )}

        {!stats.attract && stats.paused && !gameOver && (
          <ChompPause
            onResume={() => gameRef.current?.togglePause()}
            onQuit={() => gameRef.current?.toAttract()}
          />
        )}

        {gameOver && (
          <ChompGameOver
            score={stats.score}
            level={stats.level}
            place={place}
            best={best}
            debugFrom={debugRun ? stats.startLevel : 0}
            onPlayAgain={() => gameRef.current?.reset()}
            onQuit={() => gameRef.current?.toAttract()}
          />
        )}
      </div>

      <footer className="flex flex-col items-center gap-3 px-4 pt-2 pb-4 sm:px-6 sm:pb-5">
        {/* The d-pad sits UNDER the board rather than over it, so it never covers a
            corridor the player is trying to read. It is hidden while a menu is up:
            steering into an overlay does nothing, and a live control behind a dialog
            is a trap. */}
        {dpad && !stats.attract && !stats.paused && !gameOver && (
          <TouchControls onSteer={steer} />
        )}

        <div className="flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:justify-start">
          <ChompSettings />
          <span className="hidden items-center gap-1.5 font-mono text-xs text-steamed/45 sm:flex">
            <Key>←</Key>
            <Key>↑</Key>
            <Key>↓</Key>
            <Key>→</Key>
            <span className="ml-1">or</span>
            <Key>W</Key>
            <Key>A</Key>
            <Key>S</Key>
            <Key>D</Key>
          </span>
          <span className="hidden items-center gap-1.5 font-mono text-xs text-steamed/45 sm:flex">
            <Key>P</Key>
            <span>pause</span>
            <Key>M</Key>
            <span>mute</span>
          </span>
          <span className="font-mono text-[0.7rem] text-steamed/30 sm:hidden">
            Swipe the board to steer
          </span>
        </div>
      </footer>
    </main>
  );
}
