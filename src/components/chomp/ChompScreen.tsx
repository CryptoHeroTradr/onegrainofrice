"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { JourneyNav } from "@/components/journey/JourneyNav";
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
 * PHASE 5.6 — the chrome, and all three parts of it are host-side only. The site nav
 * sits above the board in its play-surface form; the page's text is on a fluid ramp
 * (`text-chomp-*` in globals.css) so it grows on a large monitor instead of staying
 * phone-sized; and "back to the rice paddy" is a board-edge button on a wide
 * landscape viewport and the header link everywhere else. NONE of it touches the
 * canvas's tile or letterbox maths — the board is still sized from the play row it
 * is given, and it is still given exactly one 1fr row.
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

const HUD_LABEL = "font-mono text-chomp-label tracking-[0.18em] text-steamed/45 uppercase";
const HUD_VALUE =
  "font-display-round text-xl leading-none font-semibold tabular-nums sm:text-chomp-num";

/**
 * "Back to the rice paddy". One affordance, two places — never both at once.
 *
 * On a wide landscape viewport it is the board-edge button, in the gutter the
 * letterbox leaves anyway. Anywhere else — portrait, and any window narrow enough
 * that the board would have to give up width to make room — it collapses into the
 * header, which is where the link already lived. The breakpoints below are exact
 * complements (`lg:landscape:hidden` against `hidden lg:landscape:block`), so there
 * is exactly one of it at every size and never two links saying the same thing.
 */
const PADDY_HREF = "/home";
const PADDY_LABEL = "← Back to the rice paddy";

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
    <kbd className="inline-flex min-w-7 items-center justify-center border border-steamed/25 bg-steamed/5 px-1.5 py-0.5 font-mono text-chomp-note text-steamed/80">
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
    // THE OUTER GRID EXISTS TO CARRY THE NAV, and it is a separate grid on purpose.
    //
    // The board's sizing rests on `main` having exactly ONE 1fr row — the play row —
    // inside a box with a DEFINITE height. Adding the nav as a fifth row of `main`
    // would have worked and would also have put a fifth thing in the one place where
    // a mistake silently re-sizes the maze. Instead the nav takes the auto row of an
    // outer 100svh grid and `main` takes its 1fr, so `main`'s own row list is
    // untouched, its height is still definite, and `h-full` inside the play row still
    // resolves. `min-h-0` on `main` is what stops its content pushing it past the 1fr.
    //
    // (`100svh` = small viewport height, so there is no jump when mobile browser
    // chrome hides. `min-height` would give descendants nothing to resolve `height:
    // 100%` against, which is the bug that once locked the maze at the minimum tile.)
    //
    // A <header> is a banner and belongs OUTSIDE <main>, which is the other reason
    // this is not a row of it.
    <div className="grid h-[100svh] grid-rows-[auto_1fr] overflow-hidden bg-nori text-steamed">
      {/* The site's nav, in its play-surface form: in flow, solid, shorter, and with
          no language control (translation is scoped off this route). See JourneyNav. */}
      <JourneyNav />

      {/* PORTRAIT IS THE DEFAULT CASE, NOT THE FALLBACK. The maze is 28:31, very
          nearly square, so it letterboxes into a portrait phone with room to spare —
          which is why there is no rotate prompt anywhere in this file and must never
          be one. The rows above and below the board are what get compact on a small
          screen; the board itself just takes the 1fr row and centres in it. */}
      {/*
        `row-start-2` IS LOAD-BEARING, and it was measured rather than reasoned.

        A `display:none` element is not a grid item. The nav hides itself below 520px
        of viewport height (a landscape phone), and the moment it did, `main`
        auto-placed into row ONE — the `auto` row — and sized itself to its own
        content instead of to the viewport. The play row's 1fr then had nothing to be
        a fraction of and collapsed to zero, the canvas measured a degenerate box, and
        the retry loop ran out its 60 frames against a box that was never going to
        settle. The board simply did not appear.

        Naming the row makes the placement independent of whether the nav is rendered.
      */}
      <main className="row-start-2 grid min-h-0 grid-rows-[auto_auto_1fr_auto]">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 pt-3 pb-2 sm:px-6 sm:pt-4">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display-round text-xl font-semibold text-khaki sm:text-chomp-head">
              RICE CHOMP
            </h1>
            <span className="hidden font-mono text-chomp-micro tracking-[0.18em] text-steamed/35 uppercase sm:inline">
              Phase 5.6 · the chrome
            </span>
          </div>
          {/* The narrow-viewport half of the back link — see PADDY_LABEL. It is
              hidden at exactly the sizes where the board-edge button appears. */}
          <Link
            href={PADDY_HREF}
            className="font-mono text-chomp-note text-steamed/50 underline-offset-4 transition-colors hover:text-khaki hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki lg:landscape:hidden"
          >
            {PADDY_LABEL}
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
              className="self-center border border-salmon/50 px-2 py-0.5 font-mono text-chomp-micro tracking-[0.18em] text-salmon uppercase"
            >
              Debug · from {stats.startLevel}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => gameRef.current?.togglePause()}
              disabled={stats.attract || gameOver}
              className="min-h-9 border border-steamed/25 px-3 font-mono text-chomp-chip tracking-[0.15em] text-steamed/70 uppercase transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki disabled:opacity-30 disabled:hover:border-steamed/25 disabled:hover:text-steamed/70"
            >
              {stats.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => gameRef.current?.reset()}
              className="min-h-9 border border-steamed/25 px-3 font-mono text-chomp-chip tracking-[0.15em] text-steamed/70 uppercase transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
            >
              Restart
            </button>
          </div>
        </div>

        {/*
          THE PLAY ROW. `min-h-0` stops the 1fr row being forced taller by its content.

          On a wide LANDSCAPE viewport it becomes three columns — gutter, board,
          gutter — so the "back to the rice paddy" button has somewhere to live that
          the canvas cannot reach. That is the whole reason for the columns: overlap
          with the board (and with the tunnel mouths at either end of row 14) is then
          impossible by construction rather than avoided by a measured offset.

          THE GUTTERS ARE FREE ONLY WHILE THE BOARD IS HEIGHT-BOUND, which is why
          `landscape:` is on them. The maze is 28:31, so on any landscape desktop the
          height runs out long before the width and the gutters are cut out of margin
          that was already empty — the tile size does not move. In portrait, and on a
          tall narrow window, width is the binding axis and the same gutters would come
          straight off the maze; there they do not exist, and the header link carries
          the job instead.
        */}
        <div className="relative grid min-h-0 grid-rows-[minmax(0,1fr)] p-2 sm:p-4 lg:landscape:grid-cols-[8rem_minmax(0,1fr)_8rem] xl:landscape:grid-cols-[11rem_minmax(0,1fr)_11rem]">
          <ChompCanvas
            ref={gameRef}
            onStats={onStats}
            reducedMotion={reduced}
            contrast={contrast}
            className="h-full w-full lg:landscape:col-start-2"
          />

          {/* The board-edge half of the back link. The canvas is centred in its own
              column, so this column's vertical middle IS the board's: `bottom-1/2`
              plus a margin puts the button just above the centre row. It is a plain
              link — nothing autofocuses it, and arrows and WASD are steered by the
              window handler in ChompCanvas whether it has focus or not. */}
          <div className="relative hidden lg:landscape:col-start-3 lg:landscape:block">
            <Link
              href={PADDY_HREF}
              className="absolute right-0 bottom-1/2 mb-3 w-full border border-steamed/25 px-3 py-2 text-right font-mono text-chomp-note leading-snug tracking-[0.12em] text-steamed/50 uppercase transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
            >
              {PADDY_LABEL}
            </Link>
          </div>

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
            <span className="hidden items-center gap-1.5 font-mono text-chomp-body text-steamed/45 sm:flex">
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
            <span className="hidden items-center gap-1.5 font-mono text-chomp-body text-steamed/45 sm:flex">
              <Key>P</Key>
              <span>pause</span>
              <Key>M</Key>
              <span>mute</span>
            </span>
            <span className="font-mono text-chomp-note text-steamed/30 sm:hidden">
              Swipe the board to steer
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
