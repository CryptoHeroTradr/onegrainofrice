"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { JourneyNav } from "@/components/journey/JourneyNav";
import { CELL_COUNT, GOLDEN_STEPS, START_LENGTH, TIERS } from "@/lib/grainsnake/rules";
import type { Dir } from "@/lib/grainsnake/types";
import { TouchControls } from "./TouchControls";
import { Leaderboard } from "./Leaderboard";
import { NAME_MAX_LEN, NAME_MIN_LEN, readName, submitRun, writeName } from "./board";
import { toggleDpad, toggleGameSound, toggleMusic, useDpad, useGameSound, useMusic } from "./prefs";
import { startMusic, stopMusic } from "./music";
import {
  GrainsnakeCanvas,
  type GrainsnakeHandle,
  type GrainsnakeStats,
} from "./GrainsnakeCanvas";

/**
 * GRAINSNAKE — the screen. HUD, menus, framing; the game is <GrainsnakeCanvas /> and
 * the rules are in `@/lib/grainsnake`.
 *
 * NONE OF THIS REACHES THE SIMULATION. Menus render while the engine is not being
 * ticked at all, and no control here is a rule: pause freezes the host loop, restart
 * reseeds, steering goes straight to the engine, and the leaderboard is a fetch.
 *
 * The HUD is marked translate="no". Translation is scoped off this route through
 * `src/lib/playSurfaces.ts` anyway, so this is the belt to that braces.
 *
 * ── THE HUD IS FOUR NUMBERS, AND GOLDENS IS ITS OWN ─────────────────────────────
 * Score, length, goldens, tier. Per the spec's *Scoring*: the base score is a strictly
 * increasing function of length, so it is order-isomorphic to it — goldens are the
 * only quantity a player controls independently of how long they survived, and folding
 * them into the total wastes the one real second axis this game has.
 */

const LABEL = "font-mono text-[0.6rem] tracking-[0.18em] text-steamed/45 uppercase sm:text-xs";
const VALUE = "font-display-round text-xl leading-none font-semibold tabular-nums sm:text-2xl";
/** One focus treatment, used by every interactive control on this page. */
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-salmon";
const BTN = `border border-steamed/30 px-4 py-2 font-mono text-sm text-steamed/85 hover:bg-steamed/10 ${FOCUS}`;

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

type Panel = "menu" | "how" | "board" | null;

export function GrainsnakeScreen() {
  const reduced = usePrefersReducedMotion();
  const dpad = useDpad();
  const sound = useGameSound();
  const music = useMusic();
  const gameRef = useRef<GrainsnakeHandle>(null);
  const [stats, setStats] = useState<GrainsnakeStats>({
    score: 0,
    length: START_LENGTH,
    goldens: 0,
    tier: 1,
    tick: 0,
    dead: false,
    filled: false,
    started: false,
    paused: false,
    countdown: 0,
  });
  const [panel, setPanel] = useState<Panel>("menu");
  /**
   * The name draft. `null` means "not typed in this session yet", in which case the
   * persisted value is read DURING RENDER rather than in an effect.
   *
   * That is safe here and only here: `readName()` returns "" when there is no
   * `window`, and the input it feeds lives on the game-over card, which cannot render
   * on the server (it needs `stats.dead`, and stats start at their defaults). So there
   * is no pass where the server and the client disagree about it — which is the only
   * thing the after-mount effect was buying.
   */
  const [name, setName] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [boardKey, setBoardKey] = useState(0);

  // Identity-stable so the canvas never re-runs its boot effect.
  const onStats = useCallback((s: GrainsnakeStats) => setStats(s), []);
  const over = stats.dead || stats.filled;

  const nameValue = name ?? readName();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g) return;
      if (e.key === "Escape" && panel !== null) {
        setPanel(null);
        return;
      }
      if (e.key === "p" || e.key === "P" || e.key === "Escape") {
        if (stats.paused) g.resume();
        else g.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stats.paused, panel]);

  /**
   * Start or stop the loop when the preference changes.
   *
   * An effect is right here: this IS synchronising React state with an external
   * system (the AudioContext), which is what effects are for. Toggling inside the
   * click handler would miss the case where the pref changes in another tab.
   */
  useEffect(() => {
    if (music) startMusic();
    else stopMusic();
  }, [music]);

  const play = () => {
    setPanel(null);
    // Clearing the submit state belongs HERE rather than in an effect keyed on
    // `over`: starting a run is the only thing that makes the last run's result
    // stale, and this is the only way to start one. An effect would be a second
    // place the same fact is expressed.
    setSubmitState("idle");
    setSubmitMsg(null);
    if (over) gameRef.current?.restart();
  };

  /**
   * Submit the finished run.
   *
   * Sends `(seed, inputs, ticks, engineVersion)` — THERE IS NO SCORE IN THE BODY. The
   * server re-simulates the log with the same step function this browser ran and
   * computes the score itself, so nothing a player edits here can change what is
   * stored. What comes back is the VERIFIED score, and that is what gets shown.
   */
  const submit = async () => {
    const log = gameRef.current?.log();
    if (!log) return;
    const trimmed = nameValue.trim();
    if (trimmed.length < NAME_MIN_LEN) {
      setSubmitState("error");
      setSubmitMsg(`Names are ${NAME_MIN_LEN}–${NAME_MAX_LEN} characters.`);
      return;
    }
    writeName(trimmed);
    setSubmitState("sending");
    setSubmitMsg(null);
    const outcome = await submitRun({
      name: trimmed,
      seed: log.seed,
      inputs: log.inputs,
      ticks: log.ticks,
      engineVersion: log.engineVersion,
    });
    if (!outcome.ok) {
      setSubmitState("error");
      setSubmitMsg(outcome.error ?? "Could not submit.");
      return;
    }
    setSubmitState("done");
    const r = outcome.result;
    setSubmitMsg(
      r?.duplicate
        ? "Already on the board."
        : `Verified ${r?.score.toLocaleString()} · rank ${r?.rank}${r?.improved ? " · new best" : ""}`,
    );
    setBoardKey((k) => k + 1);
  };

  return (
    /*
     * ── `h-[100svh]`, NOT `min-h-screen`, AND IT IS THE WHOLE OF THE SCALE FIX ─────
     * *Changed 2026-08-08.* `min-height` is not a definite height. A column flex
     * container sized by `min-h-screen` is still laid out from its CONTENT, so there is
     * no spare space for `flex-1` to distribute — `main` got its content height, the
     * board's `flex-1 min-h-0` got nothing extra, and the board's height came from the
     * canvas, whose size is measured from the board. `boardScale()` then had a fixed
     * point at its floor and returned 15px on a 1440p monitor exactly as on a phone.
     *
     * A definite height breaks the loop: `main` gets 100svh minus the nav, the board
     * gets what the HUD and the controls leave, and the measurement finally describes
     * the screen. This is the same construction RICE CHOMP uses and for the same
     * reason — see its shell, which spells out that `min-height` gives descendants
     * nothing to resolve against.
     *
     * `svh` rather than `vh` so mobile browser chrome hiding does not resize the board
     * mid-run, and `overflow-hidden` because a game page owns its viewport.
     */
    <div className="flex h-[100svh] min-h-0 flex-col overflow-hidden bg-nori text-steamed">
      <JourneyNav />

      {/*
        THREE LAYOUTS, AND THE MIDDLE ONE USED TO EAT THE THIRD.

        - **Base (portrait, and any narrow window):** HUD above, board centred,
          controls under the thumb. The board takes the one `flex-1` slot.
        - **Phone landscape** (`max-lg:landscape:`): the same three side by side,
          because a 390px-tall window has no vertical budget for a HUD row AND a
          control cluster.
        - **Desktop** (`lg:`): the base column, centred, with the board allowed to
          grow and the HUD clustered over it rather than spread to the window edges.

        *Fixed 2026-08-08.* The middle branch was written as bare `landscape:`, which is
        `@media (orientation: landscape)` — true of every desktop monitor ever made. So
        a 2560×1440 screen got a layout designed for a 390px-tall phone: HUD pinned to
        the far left, controls stranded mid-right, and 1,700px of empty paddy between
        them. It is scoped to `max-lg` now — under 1024px WIDE — which is every phone in
        landscape and no desktop.

        **The stretching was not the whole story, and this is the part worth keeping.**
        `landscape:items-center` also stopped the board's container stretching to the
        row's height, so the container's height came from its own content — the canvas —
        whose size is measured FROM the container. That loop has a fixed point at the
        floor: 15px cells, 345px board, 345px container, measure again, 15px. Identical
        at 1440×900 and 2560×1440, which is the tell. The column layout has no such loop
        because `flex-1 min-h-0` gives the board a real height to be measured against.
      */}
      <main className="flex min-h-0 flex-1 flex-col px-3 pb-3 max-lg:landscape:flex-row max-lg:landscape:items-center max-lg:landscape:gap-4 lg:px-6 lg:pb-4">
        <div
          translate="no"
          // `lg:justify-center` rather than `justify-between`: spread across a 2560px
          // window the four stats are four separate things at four different places,
          // and the point of the desktop branch is that the HUD belongs to the board.
          className="mx-auto flex w-full max-w-[720px] items-end justify-between gap-3 py-2 max-lg:landscape:mx-0 max-lg:landscape:w-auto max-lg:landscape:max-w-none max-lg:landscape:flex-col max-lg:landscape:items-start max-lg:landscape:gap-5 max-lg:landscape:py-0 lg:max-w-[1100px] lg:justify-center lg:gap-12 lg:py-2"
        >
          <Stat label="Score" value={stats.score.toLocaleString()} />
          <Stat label="Length" value={String(stats.length)} />
          <Stat label="Goldens" value={String(stats.goldens)} tone="text-salmon" />
          <Stat label="Tier" value={`${stats.tier}/${TIERS.length}`} tone="text-khaki" />
        </div>

        {/* `lg:max-w-[1100px]` is what lets the board reach 45px cells (23 × 45 = 1035)
            on a tall desktop while keeping the column a unit rather than a screen. */}
        <div className="relative mx-auto flex w-full max-w-[720px] min-h-0 flex-1 items-center justify-center overflow-auto max-lg:landscape:mx-0 lg:max-w-[1100px]">
          <GrainsnakeCanvas ref={gameRef} reduced={reduced} onStats={onStats} />

          {panel === "menu" && !over && (
            <Overlay>
              <h1 className="font-display-round text-3xl font-bold sm:text-4xl">GRAINSNAKE</h1>
              <p className="max-w-xs font-mono text-sm text-steamed/70">
                One grain becomes many. That is the problem.
              </p>
              <div className="flex w-full flex-col gap-2">
                <button type="button" className={BTN} onClick={play} autoFocus>
                  Play
                </button>
                <button type="button" className={BTN} onClick={() => setPanel("how")}>
                  How to play
                </button>
                <button type="button" className={BTN} onClick={() => setPanel("board")}>
                  Leaderboard
                </button>
                <button type="button" className={BTN} onClick={toggleDpad} aria-pressed={dpad}>
                  D-pad: {dpad ? "on" : "off"}
                </button>
                <button
                  type="button"
                  className={BTN}
                  onClick={toggleGameSound}
                  aria-pressed={sound}
                >
                  Sound: {sound ? "on" : "off"}
                </button>
                <button type="button" className={BTN} onClick={toggleMusic} aria-pressed={music}>
                  Music: {music ? "on" : "off"}
                </button>
              </div>
            </Overlay>
          )}

          {panel === "how" && (
            <Overlay>
              <h2 className="font-display-round text-2xl font-bold">How to play</h2>
              <ul className="space-y-2 text-left font-mono text-xs leading-relaxed text-steamed/70">
                <li>
                  <strong className="text-steamed">Goal.</strong> Eat grains. Every grain joins the
                  trail behind you. The board never gets bigger and you always do.
                </li>
                <li>
                  <strong className="text-steamed">Controls.</strong> Swipe the board, the arrow
                  keys, <Key>W</Key>
                  <Key>A</Key>
                  <Key>S</Key>
                  <Key>D</Key>, or the d-pad. <Key>P</Key> pauses.
                </li>
                <li>
                  <strong className="text-salmon">Golden grains.</strong> One appears every eighth
                  grain and is worth five times as much — but it expires after {GOLDEN_STEPS} steps
                  of travel, so taking it costs a detour you may not have room for. It is the only
                  real decision in the game.
                </li>
                <li>
                  <strong className="text-steamed">Speed.</strong> Faster every few grains, up to
                  tier {TIERS.length}. Later grains are worth more.
                </li>
                <li>
                  <strong className="text-steamed">One life.</strong> The edges wrap — go off one
                  side and you come back the other. Only your own trail ends the run.
                </li>
              </ul>
              <button type="button" className={BTN} onClick={() => setPanel("menu")} autoFocus>
                Back
              </button>
            </Overlay>
          )}

          {panel === "board" && (
            <Overlay wide>
              <h2 className="font-display-round text-2xl font-bold">Leaderboard</h2>
              <Leaderboard refreshKey={boardKey} />
              <button
                type="button"
                className={BTN}
                onClick={() => setPanel(over ? null : "menu")}
                autoFocus
              >
                Back
              </button>
            </Overlay>
          )}

          {stats.countdown > 0 && panel === null && (
            <Overlay passThrough>
              <p className={LABEL}>Resuming</p>
              <p className="font-display-round text-6xl font-bold tabular-nums">{stats.countdown}</p>
            </Overlay>
          )}

          {stats.paused && stats.countdown === 0 && !over && panel === null && (
            <Overlay>
              <p className="font-display-round text-3xl font-bold">Paused</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={BTN}
                  onClick={() => gameRef.current?.resume()}
                  autoFocus
                >
                  Resume
                </button>
                <button type="button" className={BTN} onClick={() => setPanel("menu")}>
                  Menu
                </button>
              </div>
            </Overlay>
          )}

          {over && panel === null && (
            <Overlay>
              <p className="font-display-round text-3xl font-bold">
                {stats.filled ? "Board cleared" : "Run over"}
              </p>
              {stats.filled && (
                <p className="font-mono text-sm text-salmon">
                  Every cell is grain. Nobody has done this.
                </p>
              )}
              <div className="flex gap-5">
                <Stat label="Score" value={stats.score.toLocaleString()} />
                <Stat label="Length" value={`${stats.length}/${CELL_COUNT}`} />
                <Stat label="Goldens" value={String(stats.goldens)} tone="text-salmon" />
              </div>

              {submitState !== "done" && (
                <div className="flex flex-col items-center gap-2">
                  <label className={LABEL} htmlFor="gs-name">
                    Name for the board
                  </label>
                  <input
                    id="gs-name"
                    value={nameValue}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={NAME_MAX_LEN}
                    autoComplete="off"
                    className={`w-44 border border-steamed/30 bg-steamed/5 px-2 py-1 text-center font-mono text-sm text-steamed ${FOCUS}`}
                  />
                  <button
                    type="button"
                    className={BTN}
                    onClick={submit}
                    disabled={submitState === "sending"}
                  >
                    {submitState === "sending" ? "Submitting…" : "Submit score"}
                  </button>
                </div>
              )}
              {submitMsg && (
                <p
                  className={`font-mono text-xs ${submitState === "error" ? "text-tuna" : "text-bamboo"}`}
                  role="status"
                >
                  {submitMsg}
                </p>
              )}

              <div className="flex gap-2">
                <button type="button" className={BTN} onClick={play}>
                  Play again
                </button>
                <button type="button" className={BTN} onClick={() => setPanel("board")}>
                  Leaderboard
                </button>
              </div>
            </Overlay>
          )}
        </div>

        <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-2 pt-2 max-lg:landscape:mx-0 max-lg:landscape:w-auto max-lg:landscape:max-w-none max-lg:landscape:pt-0 lg:max-w-[1100px] lg:pt-3">
          {dpad && (
            <TouchControls
              onSteer={(d: Dir) => gameRef.current?.steer(d)}
              /*
               * SMALLER ON DESKTOP, and it is a board-size decision rather than a
               * styling one. *2026-08-08.* The d-pad sits in the controls column, so
               * every pixel of it comes off the board's `flex-1` slot — and because
               * `boardScale()` steps in whole multiples of 15, a 192px pad at 1920×1080
               * took the available height from 886 to 686, one pixel under the 690 a
               * 30px cell needs, and HALVED the board to 15px the moment the toggle was
               * flipped. A thumb needs 192px; a mouse pointer does not.
               */
              className="h-[168px] w-[168px] sm:h-[192px] sm:w-[192px] lg:h-[140px] lg:w-[140px]"
            />
          )}
          {/* THE "Menu" BUTTON'S HOME. *Placed deliberately 2026-08-08.* It was
              floating alone mid-right of a 2560px screen: this row is the phone
              landscape control cluster, and its two siblings are `landscape:hidden`, so
              on a desktop that matched the landscape branch the button was the only
              thing left in it. With the branch scoped to phones the row is a real
              controls row again — hint, Menu, and the paddy link below. */}
          <div className="flex w-full items-center justify-between gap-4 max-lg:landscape:flex-col max-lg:landscape:items-stretch max-lg:landscape:gap-2 lg:justify-center lg:gap-8">
            {/* The hint names the control the reader actually has. Swipe is the primary
                control on touch and does not exist on a desktop, where telling someone
                to swipe a board is telling them the wrong thing. */}
            <p className="font-mono text-[0.65rem] text-steamed/40 max-lg:landscape:hidden">
              <span className="[@media(pointer:fine)]:hidden">Swipe the board to steer</span>
              <span className="hidden [@media(pointer:fine)]:inline">
                Arrow keys or WASD to steer · P to pause
              </span>
            </p>
            <button
              type="button"
              onClick={() => setPanel("menu")}
              className={`border border-steamed/20 px-2.5 py-1 font-mono text-[0.65rem] text-steamed/60 hover:bg-steamed/10 ${FOCUS}`}
            >
              Menu
            </button>
          </div>
          <Link
            href={PADDY_HREF}
            className={`font-mono text-[0.65rem] text-steamed/40 hover:text-steamed max-lg:landscape:hidden ${FOCUS}`}
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
 * canvas and swallows the touch events the canvas listens for — on a panel with
 * nothing to press, that would eat the swipe the player is making. Panels with buttons
 * keep their pointer events; panels without let touches through.
 */
function Overlay({
  children,
  passThrough = false,
  wide = false,
}: {
  children: React.ReactNode;
  passThrough?: boolean;
  wide?: boolean;
}) {
  return (
    /*
     * ── `m-auto` ON THE INNER, NOT `justify-center` ON THE SCROLLER ────────────────
     * *Fixed 2026-08-08.* This was `items-center justify-center overflow-y-auto`, which
     * is the classic way to build an overlay that clips its own title: when the content
     * is taller than the box, `justify-content: center` overflows it EQUALLY in both
     * directions and a scroll container cannot reach what has been pushed above its top
     * edge. On desktop that meant the GRAINSNAKE heading was cut off and the last menu
     * option was below the fold, inside a scrollbar on a 1440px-tall screen.
     *
     * `margin: auto` on the child centres it exactly the same way when there is room
     * and degrades to top-aligned — fully scrollable — when there is not. The scroller
     * stays as the last resort for a genuinely short window (a phone in landscape has
     * ~330px of board to put a 380px panel in); at any normal size it never engages,
     * which is the actual requirement: an overlay sizes to its content.
     */
    <div
      className={`absolute inset-0 flex overflow-y-auto bg-nori/90 p-4 text-center ${
        passThrough ? "pointer-events-none" : ""
      }`}
    >
      <div className={`m-auto flex w-full flex-col items-center gap-4 ${wide ? "max-w-md" : "max-w-xs"}`}>
        {children}
      </div>
    </div>
  );
}
