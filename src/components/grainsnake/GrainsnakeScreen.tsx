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
    <div className="flex min-h-screen flex-col bg-nori text-steamed">
      <JourneyNav />

      {/*
        PORTRAIT: HUD above, board centred, controls under the thumb.
        LANDSCAPE: the same three side by side — a 400px-tall window has no vertical
        budget for a HUD row AND a control cluster. The board keeps one 1fr slot in both.
      */}
      <main className="flex min-h-0 flex-1 flex-col px-3 pb-3 landscape:flex-row landscape:items-center landscape:gap-4 lg:landscape:gap-8">
        <div
          translate="no"
          className="mx-auto flex w-full max-w-[720px] items-end justify-between gap-3 py-2 landscape:mx-0 landscape:w-auto landscape:max-w-none landscape:flex-col landscape:items-start landscape:gap-5 landscape:py-0"
        >
          <Stat label="Score" value={stats.score.toLocaleString()} />
          <Stat label="Length" value={String(stats.length)} />
          <Stat label="Goldens" value={String(stats.goldens)} tone="text-salmon" />
          <Stat label="Tier" value={`${stats.tier}/${TIERS.length}`} tone="text-khaki" />
        </div>

        <div className="relative mx-auto flex w-full max-w-[720px] min-h-0 flex-1 items-center justify-center overflow-auto landscape:mx-0">
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
              onClick={() => setPanel("menu")}
              className={`border border-steamed/20 px-2.5 py-1 font-mono text-[0.65rem] text-steamed/60 hover:bg-steamed/10 ${FOCUS}`}
            >
              Menu
            </button>
          </div>
          <Link
            href={PADDY_HREF}
            className={`font-mono text-[0.65rem] text-steamed/40 hover:text-steamed landscape:hidden ${FOCUS}`}
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
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center overflow-y-auto bg-nori/90 p-4 text-center ${
        passThrough ? "pointer-events-none" : ""
      }`}
    >
      <div className={`flex w-full flex-col items-center gap-4 ${wide ? "max-w-md" : "max-w-xs"}`}>
        {children}
      </div>
    </div>
  );
}
