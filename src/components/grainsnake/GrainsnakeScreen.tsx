"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { JourneyNav } from "@/components/journey/JourneyNav";
import { CELL_COUNT, START_LENGTH } from "@/lib/grainsnake/rules";
import type { Dir } from "@/lib/grainsnake/types";
import { TouchControls } from "./TouchControls";
import { toggleDpad, useDpad } from "./prefs";
import {
  GrainsnakeCanvas,
  type GrainsnakeHandle,
  type GrainsnakeStats,
} from "./GrainsnakeCanvas";

/**
 * GRAINSNAKE — the screen. HUD, framing and overlays; the game itself is
 * <GrainsnakeCanvas /> and the rules are in `@/lib/grainsnake`.
 *
 * NONE OF THIS REACHES THE SIMULATION. The overlays render while the engine is not
 * being ticked at all, and no control here is a rule: pause freezes the host loop,
 * restart reseeds, and steering goes straight to the engine. A run played with an
 * overlay open is bit-identical to one played without it.
 *
 * The HUD is marked translate="no". Translation is scoped off this route through
 * `src/lib/playSurfaces.ts` anyway, so this is the belt to that braces — and it costs
 * nothing.
 *
 * ── THE HUD IS THREE NUMBERS, AND THE THIRD ONE IS THE POINT ────────────────────
 * Score, length and GOLDENS. The spec's *Scoring* is explicit about why the third is
 * there: the base score is a strictly increasing function of length, so it is
 * order-isomorphic to it — two players at the same length have the same base score.
 * Goldens are the only quantity a player controls independently of how long they
 * survived, which makes them the only real second axis, and folding them invisibly
 * into one total wastes them.
 */

const LABEL = "font-mono text-[0.6rem] tracking-[0.18em] text-steamed/45 uppercase sm:text-xs";
const VALUE = "font-display-round text-xl leading-none font-semibold tabular-nums sm:text-2xl";

/** Home. The label says paddy, and this points straight at the page rather than a redirect. */
const PADDY_HREF = "/";
const PADDY_LABEL = "← Back to the rice paddy";

function Stat({ label, value, tone = "text-steamed" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <span className={`${VALUE} ${tone}`}>{value}</span>
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

export function GrainsnakeScreen() {
  const reduced = usePrefersReducedMotion();
  const dpad = useDpad();
  const gameRef = useRef<GrainsnakeHandle>(null);
  const [stats, setStats] = useState<GrainsnakeStats>({
    score: 0,
    length: START_LENGTH,
    goldens: 0,
    tick: 0,
    dead: false,
    filled: false,
    started: false,
    paused: false,
    countdown: 0,
  });

  // Identity-stable so the canvas never re-runs its boot effect.
  const onStats = useCallback((s: GrainsnakeStats) => setStats(s), []);

  const over = stats.dead || stats.filled;

  // P / Esc pause. Deliberately NOT in the canvas's key handler: pausing is a host
  // concern and the canvas's handler is for steering, which is the engine's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "p" && e.key !== "P" && e.key !== "Escape") return;
      const g = gameRef.current;
      if (!g) return;
      if (stats.paused) g.resume();
      else g.pause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stats.paused]);

  return (
    <div className="flex min-h-screen flex-col bg-nori text-steamed">
      <JourneyNav />

      {/*
        PORTRAIT: HUD above, board centred, controls under the thumb.
        LANDSCAPE: the same three things side by side, because a 400px-tall window has
        no vertical budget to spend on a HUD row and a control cluster.
        The board keeps exactly one 1fr slot in both, and is sized from it.
      */}
      <main className="flex min-h-0 flex-1 flex-col px-3 pb-3 landscape:flex-row landscape:items-center landscape:gap-4 lg:landscape:gap-8">
        {/* HUD */}
        <div
          translate="no"
          className="mx-auto flex w-full max-w-[720px] items-end justify-between gap-4 py-2 landscape:mx-0 landscape:w-auto landscape:max-w-none landscape:flex-col landscape:items-start landscape:gap-5 landscape:py-0"
        >
          <Stat label="Score" value={stats.score.toLocaleString()} />
          <Stat label="Length" value={String(stats.length)} />
          <Stat label="Goldens" value={String(stats.goldens)} tone="text-salmon" />
        </div>

        {/* The board gets exactly one 1fr slot and is sized from it. */}
        <div className="relative mx-auto flex w-full max-w-[720px] min-h-0 flex-1 items-center justify-center overflow-auto landscape:mx-0">
          <GrainsnakeCanvas ref={gameRef} reduced={reduced} onStats={onStats} />

          {!stats.started && !over && (
            <Overlay passThrough>
              <h1 className="font-display-round text-3xl font-bold sm:text-4xl">GRAINSNAKE</h1>
              <p className="max-w-xs font-mono text-sm text-steamed/70">
                One grain becomes many. Swipe the board — or press an arrow key — to begin.
              </p>
              <p className="hidden font-mono text-xs text-steamed/50 sm:block">
                <Key>←</Key> <Key>↑</Key> <Key>↓</Key> <Key>→</Key> or <Key>W</Key>
                <Key>A</Key>
                <Key>S</Key>
                <Key>D</Key> to steer · <Key>P</Key> to pause
              </p>
            </Overlay>
          )}

          {stats.countdown > 0 && (
            <Overlay passThrough>
              <p className={LABEL}>Resuming</p>
              <p className="font-display-round text-6xl font-bold tabular-nums">{stats.countdown}</p>
            </Overlay>
          )}

          {stats.paused && stats.countdown === 0 && !over && (
            <Overlay>
              <p className="font-display-round text-3xl font-bold">Paused</p>
              <button
                type="button"
                onClick={() => gameRef.current?.resume()}
                className="border border-steamed/30 px-4 py-2 font-mono text-sm text-steamed/80 hover:bg-steamed/10"
              >
                Resume
              </button>
            </Overlay>
          )}

          {over && (
            <Overlay>
              <p className="font-display-round text-3xl font-bold">
                {stats.filled ? "Board cleared" : "Run over"}
              </p>
              {stats.filled && (
                <p className="max-w-xs font-mono text-sm text-salmon">
                  Every cell is grain. Nobody has done this.
                </p>
              )}
              <div className="flex gap-6">
                <Stat label="Score" value={stats.score.toLocaleString()} />
                <Stat label="Length" value={`${stats.length}/${CELL_COUNT}`} />
                <Stat label="Goldens" value={String(stats.goldens)} tone="text-salmon" />
              </div>
              <button
                type="button"
                onClick={() => gameRef.current?.restart()}
                className="border border-steamed/30 px-4 py-2 font-mono text-sm text-steamed/80 hover:bg-steamed/10"
              >
                Play again
              </button>
            </Overlay>
          )}
        </div>

        {/*
          Controls, in thumb reach. In portrait this is the bottom of the screen; in
          landscape it is the side opposite the HUD, which is where a thumb already is
          when the phone is held in two hands.
        */}
        <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-2 pt-2 landscape:mx-0 landscape:w-auto landscape:max-w-none landscape:pt-0">
          {dpad && (
            <TouchControls
              onSteer={(d: Dir) => gameRef.current?.steer(d)}
              className="h-[168px] w-[168px] sm:h-[192px] sm:w-[192px]"
            />
          )}
          <div className="flex w-full items-center justify-between gap-4 landscape:flex-col landscape:items-stretch landscape:gap-2">
            <p className="font-mono text-[0.65rem] text-steamed/40 landscape:hidden">
              Swipe the board to steer
            </p>
            <button
              type="button"
              onClick={toggleDpad}
              aria-pressed={dpad}
              className="border border-steamed/20 px-2.5 py-1 font-mono text-[0.65rem] text-steamed/60 hover:bg-steamed/10"
            >
              D-pad {dpad ? "on" : "off"}
            </button>
          </div>
          <Link
            href={PADDY_HREF}
            className="font-mono text-[0.65rem] text-steamed/40 hover:text-steamed landscape:hidden"
          >
            {PADDY_LABEL}
          </Link>
        </div>
      </main>
    </div>
  );
}

/**
 * A centred panel over the board.
 *
 * `passThrough` is not cosmetic. An overlay is `absolute inset-0`, so it sits ON the
 * canvas and swallows the touch events the canvas is listening for — which on the
 * ATTRACT screen means the swipe that is supposed to start the run never reaches the
 * board, and the game looks broken on a phone while working on a desktop. Panels with
 * nothing to press pass touches through; panels with a button do not.
 */
function Overlay({
  children,
  passThrough = false,
}: {
  children: React.ReactNode;
  passThrough?: boolean;
}) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-4 bg-nori/85 text-center ${
        passThrough ? "pointer-events-none" : ""
      }`}
    >
      {children}
    </div>
  );
}
