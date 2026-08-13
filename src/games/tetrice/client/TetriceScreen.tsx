"use client";

/**
 * TETRICE — the screen.
 *
 * Thin route -> this client component -> the directive-free engine. Nothing in
 * `src/games/tetrice/engine/` is reimplemented here and no rule is re-derived: this file
 * draws what the engine says and records what the player pressed.
 *
 * **THIS FILE OWNS NO CONTROL LOGIC EITHER.** It translates browser events into the edges
 * `InputState` understands — `press`, `release`, `pulse` — and calls `drain()` once per
 * simulation tick. DAS, ARR, the swipe thresholds and the flick split are all in
 * `controls.ts`, in one object, and the keyboard, the swipe surface and the on-screen
 * cluster are three ways of reaching the same instance of it. There is exactly one path
 * into the engine, which is what makes the trace mean the same thing whoever recorded it.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BUFFER_ROWS,
  COLS,
  ENGINE_VERSION,
  QUEUE_LOOKAHEAD,
  VISIBLE_ROWS,
  cellsOf,
  type Shape,
} from "../engine/rules";
import { createInitialState, type GameState } from "../engine/state";
import { step } from "../engine/step";
import { verifyRunLog } from "@/lib/tetrice/verify";
import type { SubmitResponse } from "@/lib/tetrice/wire";
import { startRun, submitRun } from "./leaderboard";
import { NameField, TetriceBoard } from "./Leaderboard";
// The route's own name rules, so the button can be disabled for a reason the player can
// read instead of a 400 they cannot. Shared, never reimplemented (CLAUDE.md).
import { checkName } from "@/lib/chomp/score";
import { InputState, type HeldButton, type PulseAction } from "./controls";
import { InputRecorder, maskOf, selfCheck, type RunLog } from "./inputLog";
import { previewCell, resolveBoardSize, type BoardSize } from "./layout";
import { startLoop } from "./loop";
import { useDpad, toggleDpad } from "./prefs";
import { readPalette, type FusionMode, type Palette } from "./grains";
import { Effects, drawPreview, drawWell, landingRow } from "./render";
import { TouchControls } from "./TouchControls";
import {
  addPointer,
  beginTouch,
  endTouch,
  feedTouch,
  pollTouch,
  type TouchEdge,
  type TouchTracker,
} from "./touch";

/** The decided fusion mechanism. See `docs/tetrice-spec.md`, *The pieces*. */
const FUSION: FusionMode = "brick";

/**
 * The keyboard, by `event.code` — physical position, not the character produced, so the
 * mapping is the same on QWERTY and AZERTY.
 *
 * The spec's *Controls* list is the authority and this is a superset of nothing: every
 * binding below is in it. Held keys and one-shot keys are separate maps because they are
 * separate mechanisms — a key in `KEY_HOLD` charges DAS, a key in `KEY_PULSE` cannot.
 */
const KEY_HOLD: Record<string, HeldButton> = {
  ArrowLeft: "Left",
  KeyA: "Left",
  ArrowRight: "Right",
  KeyD: "Right",
  ArrowDown: "SoftDrop",
  KeyS: "SoftDrop",
};

const KEY_PULSE: Record<string, PulseAction> = {
  ArrowUp: "RotateCW",
  KeyX: "RotateCW",
  KeyZ: "RotateCCW",
  ControlLeft: "RotateCCW",
  Space: "HardDrop",
  KeyC: "Hold",
  ShiftLeft: "Hold",
  ShiftRight: "Hold",
};

/** Pause is not an engine action: it stops ticks, and a tick that did not happen cannot
 *  be in a tick-indexed trace. */
const KEY_PAUSE = new Set(["KeyP", "Escape"]);

/** Where a finished run is in the submit flow. Nothing here affects play. */
type SubmitState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "done"; result: SubmitResponse }
  | { phase: "error"; message: string };

const NAME_KEY = "tetrice:name";

const NARROW = 720;

/**
 * True only after hydration.
 *
 * The layout is chosen from `window.innerWidth`, which the server cannot know, so the
 * server and the first client render disagree about the row's className — and React does
 * NOT patch attribute mismatches during hydration ("this won't be patched up"). The result
 * is a page that looks fine and whose flex classes are the server's guess for ever, which
 * is how a 2560x1440 desktop ends up measuring a zero-height wrapper. Render nothing
 * layout-dependent until the client is in charge.
 */
const NOOP_SUBSCRIBE = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(NOOP_SUBSCRIBE, () => true, () => false);
}

export default function TetriceScreen() {
  const mounted = useMounted();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const prevRef = useRef<GameState | null>(null);
  const inputRef = useRef<InputState>(new InputState());
  const touchRef = useRef<TouchTracker | null>(null);
  const pausedRef = useRef(false);
  const recorderRef = useRef<InputRecorder>(new InputRecorder());
  const effectsRef = useRef<Effects>(new Effects());
  const paletteRef = useRef<Palette | null>(null);
  const seedRef = useRef<number>(0);
  /** The server's run id for the run in play, or null when it is unranked. */
  const runIdRef = useRef<string | null>(null);
  /** The finished run's log, held for submission. Built once, on the tick it ended. */
  const finishedRef = useRef<RunLog | null>(null);
  /** True while `/api/tetrice/start` is in flight, so a resize cannot start a second run. */
  const startingRef = useRef(false);

  const [size, setSize] = useState<BoardSize | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [hud, setHud] = useState({ score: 0, level: 1, lines: 0, over: false });
  const [queue, setQueue] = useState<Shape[]>([]);
  const [hold, setHold] = useState<Shape | null>(null);
  const [ghostOn, setGhostOn] = useState(true);
  const [paused, setPaused] = useState(false);
  const [ranked, setRanked] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle" });
  /**
   * The last name this browser used, so a returning player does not retype it.
   *
   * A lazy initialiser rather than an effect, and it is hydration-safe for a specific
   * reason: the server render is the empty `<main>` (see `useMounted`), so the field this
   * feeds does not exist in the server's output and there is nothing for a stored name to
   * disagree with.
   */
  const [name, setName] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return ""; // storage blocked — the field simply starts empty
    }
  });
  /** Bumped after a successful submit so the board re-reads rather than showing a stale one. */
  const [boardKey, setBoardKey] = useState(0);
  const dpad = useDpad();

  /**
   * Post the finished run.
   *
   * **The body carries no score.** It carries the run id, the engine version, the input
   * log and the name; the server replays the log against the seed IT stored and computes
   * everything else. A failure here leaves the run on screen and the button live.
   */
  const sendRun = useCallback(async () => {
    const log = finishedRef.current;
    const runId = runIdRef.current;
    if (!log || !runId) return;
    setSubmit({ phase: "sending" });
    try {
      window.localStorage.setItem(NAME_KEY, name);
    } catch {
      /* not worth failing a submission over */
    }
    const outcome = await submitRun(runId, log, name);
    if (outcome.ok) {
      setSubmit({ phase: "done", result: outcome.result });
      setBoardKey((k) => k + 1);
    } else {
      setSubmit({ phase: "error", message: `${outcome.error}${outcome.status ? ` (${outcome.status})` : ""}` });
    }
  }, [name]);

  // ─── sizing ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setNarrow(window.innerWidth < NARROW);
      setSize(resolveBoardSize(r.width, r.height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // `mounted` is a dependency because the shell renders as an empty <main> until
    // hydration: on the first pass this ref is null, the effect bails, and with an empty
    // dep array it would never run again — leaving the board unsized for ever.
  }, [mounted]);

  // ─── pause ─────────────────────────────────────────────────────────────────
  const setPause = useCallback((on: boolean) => {
    pausedRef.current = on;
    setPaused(on);
    // Everything comes up on a pause. A key held across a pause is a key whose `up` event
    // the game may never see in a state where it can act on it, and a piece that starts
    // walking the instant play resumes is the bug that produces.
    if (on) inputRef.current.releaseAll();
  }, []);

  // ─── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // ── THE OS's KEY REPEAT IS DROPPED HERE, AND THAT IS THE WHOLE DAS DESIGN ──
      // A held key delivers `keydown` at the operating system's typematic rate — around
      // 500 ms to the first repeat, ~30 ms after, both a control-panel setting. Feeding
      // those to `InputState` would hand this game's feel to a preference that is not
      // ours and give two players on the same build different games. The DOWN and UP
      // EDGES are the input; every repeat in this game is counted in `controls.ts`, in
      // simulation frames.
      if (e.repeat) return;

      if (KEY_PAUSE.has(e.code)) {
        e.preventDefault();
        if (!stateRef.current?.over) setPause(!pausedRef.current);
        return;
      }
      const held = KEY_HOLD[e.code];
      if (held) {
        e.preventDefault();
        if (!pausedRef.current) inputRef.current.press(held);
        return;
      }
      const pulse = KEY_PULSE[e.code];
      if (pulse) {
        e.preventDefault();
        if (!pausedRef.current) inputRef.current.pulse(pulse);
      }
    };
    const up = (e: KeyboardEvent) => {
      const held = KEY_HOLD[e.code];
      if (!held) return;
      e.preventDefault();
      inputRef.current.release(held);
    };
    // A key held while the window loses focus never sends its `up` — the browser has
    // stopped talking to us by then. Both of these are that key's release.
    const letGo = () => inputRef.current.releaseAll();
    const hidden = () => {
      if (document.visibilityState === "hidden") letGo();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", letGo);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", letGo);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [setPause]);

  // ─── touch ─────────────────────────────────────────────────────────────────
  //
  // ONE CLOCK. The recogniser is fed `event.timeStamp` from pointer events here and
  // `performance.now()` from the draw callback, and those have to be the same clock or
  // the flick split is comparing two origins — a `DOMHighResTimeStamp` against an epoch
  // would read as an enormous velocity and slam every piece. They are: `timeStamp` on a
  // trusted event has been high-resolution and relative to the same time origin
  // everywhere for years. It is written down because the failure would look like a
  // gesture bug rather than a clock bug.
  //
  /** Apply what the recogniser produced. It speaks in edges, so this is a translation
   *  and not a second place where a control decision gets made. */
  const applyTouch = useCallback((events: readonly TouchEdge[]) => {
    const input = inputRef.current;
    for (const ev of events) {
      if (ev.kind === "press") input.press(ev.button);
      else if (ev.kind === "release") input.release(ev.button);
      else if (ev.kind === "nudge") input.nudge(ev.button);
      else input.pulse(ev.action);
    }
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return; // the desktop has a keyboard
      // THE ORDER MATTERS. `preventDefault()` on a touch `pointerdown` suppresses the
      // compatibility `click` that follows it, so taking it before this early return
      // would make the pause overlay — a button inside this surface — untappable on the
      // only pointer type that needs it.
      if (pausedRef.current || stateRef.current?.over) return;
      e.preventDefault();
      if (touchRef.current) {
        addPointer(touchRef.current);
        return;
      }
      touchRef.current = beginTouch(e.clientX, e.clientY, e.timeStamp);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const tr = touchRef.current;
      if (!tr) return;
      e.preventDefault();
      applyTouch(feedTouch(tr, e.clientX, e.clientY, e.timeStamp));
    },
    [applyTouch],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const tr = touchRef.current;
      if (!tr) return;
      e.preventDefault();
      const { events, done } = endTouch(tr, e.timeStamp);
      applyTouch(events);
      if (done) touchRef.current = null;
    },
    [applyTouch],
  );

  // ─── the run ───────────────────────────────────────────────────────────────
  /**
   * Begin a run on a seed the SERVER chose.
   *
   * `startRun()` fails soft: no session, a 429, or a route that is down all end at a
   * locally generated seed and `ranked: false`. The run is fully playable either way and
   * the panel says which it is — a leaderboard is not the game, and a game that refuses to
   * start because an API had a bad minute is the failure constraint 7 names.
   */
  const start = useCallback(async () => {
    const ticket = await startRun();
    seedRef.current = ticket.seed;
    runIdRef.current = ticket.runId;
    finishedRef.current = null;
    const s0 = createInitialState(ticket.seed);
    stateRef.current = s0;
    prevRef.current = null;
    recorderRef.current = new InputRecorder();
    effectsRef.current = new Effects();
    inputRef.current.releaseAll();
    touchRef.current = null;
    pausedRef.current = false;
    setPaused(false);
    setRanked(ticket.ranked);
    setSubmit({ phase: "idle" });
    setHud({ score: 0, level: 1, lines: 0, over: false });
    setQueue([...s0.queue]);
    setHold(s0.hold);
  }, []);

  useEffect(() => {
    if (!size) return;
    if (!paletteRef.current) paletteRef.current = readPalette(document.documentElement);
    // The first run's seed is a round trip away, and this effect re-runs on every resize —
    // so the guard is "a run exists or one is on its way", not just the former. Without the
    // second half a resize during that round trip starts a second run.
    if (!stateRef.current && !startingRef.current) {
      startingRef.current = true;
      void start().finally(() => {
        startingRef.current = false;
      });
    }

    const handle = startLoop({
      step: () => {
        const s = stateRef.current;
        // NO STATE YET IS NOT THE END OF THE RUN. Returning false here would stop the loop
        // for good, so the seed arriving a moment later would find nothing running.
        if (!s) return true;
        if (s.over) return false;
        // ONE DRAIN PER STEPPED TICK. The repeat schedule is counted in these calls, so a
        // drain on a tick that is not stepped would charge DAS against a frame the engine
        // never saw — and the trace records what was drained.
        const actions = inputRef.current.drain();
        recorderRef.current.record(s.ticks, maskOf(actions));

        const before = s;
        const next = step(s, actions, s.ticks);
        prevRef.current = before;
        stateRef.current = next;

        // Cosmetics are DERIVED from the two states. Nothing here can delay a tick.
        const now = performance.now();
        if (actions.includes("HardDrop") && before.active) {
          const land = landingRow(before);
          if (land !== null) {
            const cols = cellsOf(before.active.shape, before.active.rot).map(([cx]) => before.active!.x + cx);
            effectsRef.current.trail(Math.min(...cols), Math.max(...cols), before.active.y, land, now);
          }
        }
        if (next.lines > before.lines) {
          // Which rows completed, recomputed from the state before the lock.
          const rows: number[] = [];
          const p = before.active;
          if (p) {
            const touched = new Set(cellsOf(p.shape, p.rot).map(([, cy]) => p.y + cy));
            for (const row of touched) {
              let full = true;
              for (let col = 0; col < COLS; col++) {
                const filled =
                  before.well[row * COLS + col] !== 0 ||
                  cellsOf(p.shape, p.rot).some(([cx, cy]) => p.x + cx === col && p.y + cy === row);
                if (!filled) {
                  full = false;
                  break;
                }
              }
              if (full) rows.push(row);
            }
          }
          effectsRef.current.clear(rows.sort((a, b) => a - b), now);
        }

        if (next.score !== before.score || next.lines !== before.lines || next.level !== before.level || next.over) {
          setHud({ score: next.score, level: next.level, lines: next.lines, over: next.over });
        }
        if (next.queue[0] !== before.queue[0] || next.hold !== before.hold) {
          setQueue([...next.queue]);
          setHold(next.hold);
        }

        if (next.over) {
          const log = recorderRef.current.build(seedRef.current, ENGINE_VERSION, next.ticks);

          // ── TWO CHECKS ON A FINISHED RUN, AND THEY ANSWER DIFFERENT QUESTIONS ──
          // Both run on the finished run only, so neither costs anything during play.
          //
          //  1. `selfCheck` replays the log and compares the FINAL STATE with the one just
          //     played. A mismatch means the engine picked up nondeterminism — the log and
          //     the run disagree, which makes the log worthless.
          //  2. `verifyRunLog` is the SERVER'S verifier, imported rather than reimplemented.
          //     A failure here means this run will be rejected by the route, and knowing
          //     that in the console in dev is worth more than discovering it as a 422 in
          //     production. A self-check that ran different code from the server would go
          //     green on runs the server refuses, which is worse than no self-check at all.
          selfCheck(log, next);
          const verdict = verifyRunLog(log);
          if (!verdict.ok) {
            console.error(
              `[tetrice] LOCAL VERIFY FAILED — this run would be refused by /api/tetrice/submit.\n` +
                `  ${verdict.status} ${verdict.reason}\n` +
                `  seed ${log.seed}, ticks ${log.ticks}, ${log.entries.length} entries\n` +
                `  played: score ${next.score} lines ${next.lines} level ${next.level}`,
            );
          } else if (verdict.run.score !== next.score) {
            // Cannot happen unless the replay diverged, which `selfCheck` would also have
            // caught — reported separately because THIS is the number that reaches the board.
            console.error(
              `[tetrice] VERIFIER DISAGREES ABOUT THE SCORE — played ${next.score}, ` +
                `replayed ${verdict.run.score}. The board would show the replayed one.`,
            );
          }

          finishedRef.current = log;
          inputRef.current.releaseAll();
          touchRef.current = null;
          setHud({ score: next.score, level: next.level, lines: next.lines, over: true });
          return false;
        }
        return true;
      },
      paused: () => pausedRef.current,
      draw: (alpha) => {
        const s = stateRef.current;
        const cvs = canvasRef.current;
        const pal = paletteRef.current;
        if (!s || !cvs || !pal || !size) return;
        const ctx = cvs.getContext("2d");
        if (!ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const w = size.width;
        const h = size.height;
        if (cvs.width !== Math.round(w * dpr)) {
          cvs.width = Math.round(w * dpr);
          cvs.height = Math.round(h * dpr);
          cvs.style.width = `${w}px`;
          cvs.style.height = `${h}px`;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const now = performance.now();
        // A thumb that stops moving stops sending events, so the downward stroke waiting
        // to be told whether it is a drop or a drag is settled here, on the frame clock.
        // Nothing else in the draw path may touch input state.
        if (touchRef.current) applyTouch(pollTouch(touchRef.current, now));
        effectsRef.current.prune(now);
        drawWell(ctx, s, {
          cell: size.cell,
          palette: pal,
          fusion: FUSION,
          ghost: ghostOn,
          effects: effectsRef.current,
          now,
          alpha,
          prev: prevRef.current,
        });
      },
    });
    return () => handle.stop();
  }, [size, ghostOn, start, applyTouch]);

  const pCell = size ? previewCell(size.cell) : 0;
  const shown = narrow ? 2 : QUEUE_LOOKAHEAD;

  // h-screen + overflow-hidden, not min-h-screen: a game page is exactly one viewport tall
  // and never scrolls. With min-h-screen the flex row has no ceiling, so the wrapper grows
  // to whatever the cell arithmetic asks for and the page scrolls — the opposite failure to
  // the circular one below, and just as invisible until you measure it.
  if (!mounted) {
    // Server output and first paint: the frame, no layout-dependent structure.
    return <main className="flex h-screen flex-col overflow-hidden bg-nori text-paper" />;
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-nori text-paper">
      {/* THE WRAPPER MUST NOT BE SIZED BY THE CANVAS IT CONTAINS. The canvas is absolutely
          positioned below, so it contributes nothing to the wrapper's height, and the
          wrapper takes its height from this row instead. With the canvas in flow the
          measurement is circular — canvas starts at 0, wrapper measures ~0, the cell
          floors to 15, the canvas becomes 300 tall, the wrapper measures 300, and it
          never grows again. Every viewport then resolves to the same floor cell, which is
          what a 2560x1440 desktop rendering a 150px-wide well looks like. Same shape as
          the GRAINSNAKE desktop fix. */}
      <div
        className={
          narrow
            ? "flex min-h-0 flex-1 flex-col gap-2 p-2"
            : "flex min-h-0 flex-1 items-stretch justify-center gap-6 p-4"
        }
      >
        {narrow && (
          <CompactStrip queue={queue.slice(0, shown)} hold={hold} hud={hud} cell={Math.max(15, Math.round(pCell * 0.7))} />
        )}
        {/* THE SWIPE SURFACE IS THE WHOLE WELL AREA, AND IT IS LIVE WHETHER OR NOT THE
            CLUSTER IS. `touch-action: none` is what stops a downward drag from scrolling
            the page and a tap from being held back 300 ms while the browser waits to see
            a double-tap — without it the soft drop scrolls and the rotate is late. It is
            scoped here rather than to the document so the rest of the page still behaves
            like a page. */}
        <div
          ref={wrapRef}
          className="relative min-h-0 min-w-0 flex-1"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <canvas
            ref={canvasRef}
            className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2"
            style={{ border: "2px solid rgba(196,179,112,0.45)" }}
            aria-label="TETRICE well"
          />
          {paused && !hud.over && (
            <button
              type="button"
              onClick={() => setPause(false)}
              className="absolute inset-0 flex items-center justify-center bg-nori/70 font-mono text-sm tracking-widest"
            >
              PAUSED — press P or tap to resume
            </button>
          )}
        </div>
        {!narrow && (
          <Panel
            queue={queue.slice(0, shown)}
            hold={hold}
            hud={hud}
            cell={pCell}
            ghostOn={ghostOn}
            onGhost={() => setGhostOn((g) => !g)}
            dpad={dpad}
            onDpad={toggleDpad}
            paused={paused}
            onPause={() => setPause(!paused)}
          />
        )}
      </div>
      {/* The cluster sits below the well on every layout, because a control column beside
          it would be reachable only by the hand that is not holding the phone. */}
      {dpad && !hud.over && (
        <TouchControls
          className="mx-auto w-full max-w-md px-2 pb-2"
          onPress={(b) => !pausedRef.current && inputRef.current.press(b)}
          onRelease={(b) => inputRef.current.release(b)}
          onPulse={(a) => !pausedRef.current && inputRef.current.pulse(a)}
        />
      )}
      {narrow && !hud.over && (
        <NarrowBar
          dpad={dpad}
          onDpad={toggleDpad}
          ghostOn={ghostOn}
          onGhost={() => setGhostOn((g) => !g)}
          paused={paused}
          onPause={() => setPause(!paused)}
        />
      )}
      {hud.over && (
        <GameOverCard
          hud={hud}
          ranked={ranked}
          submit={submit}
          name={name}
          onName={setName}
          onSubmit={sendRun}
          onAgain={() => void start()}
          boardKey={boardKey}
        />
      )}
    </main>
  );
}

/**
 * The end of a run: what it scored, the name field, and the board.
 *
 * **The score shown here is the one the client simulated; the score on the board is the
 * one the server computed.** They agree — the verifier ran locally on this very log a
 * moment ago and would have shouted in the console if they did not — but they are two
 * different numbers with two different provenances, and this card shows the server's the
 * moment it has one.
 */
function GameOverCard({
  hud,
  ranked,
  submit,
  name,
  onName,
  onSubmit,
  onAgain,
  boardKey,
}: {
  hud: { score: number; level: number; lines: number };
  ranked: boolean;
  submit: SubmitState;
  name: string;
  onName: (v: string) => void;
  onSubmit: () => void;
  onAgain: () => void;
  boardKey: number;
}) {
  const nameOk = checkName(name).ok;
  return (
    <div className="mx-auto mb-3 flex w-full max-w-md flex-col gap-3 border border-khaki/40 p-3">
      <div className="flex items-baseline justify-between font-mono">
        <span className="text-sm tracking-widest opacity-70">RUN OVER</span>
        <span className="text-lg tabular-nums">{hud.score.toLocaleString()}</span>
      </div>

      {submit.phase === "done" ? (
        <p className="font-mono text-[11px]">
          Submitted · score {submit.result.score.toLocaleString()} · level {submit.result.level} ·{" "}
          {submit.result.lines} lines · rank {submit.result.rank}
          {submit.result.improved ? " · a personal best" : ""}
          {submit.result.duplicate ? " · already on the board" : ""}
        </p>
      ) : ranked ? (
        <div className="flex flex-col gap-2">
          <NameField value={name} onChange={onName} disabled={submit.phase === "sending"} />
          <button
            type="button"
            onClick={onSubmit}
            disabled={!nameOk || submit.phase === "sending"}
            className="border border-khaki/50 px-3 py-1.5 font-mono text-sm disabled:opacity-40"
          >
            {submit.phase === "sending" ? "sending…" : "submit to the board"}
          </button>
          {submit.phase === "error" && (
            <span className="font-mono text-[11px] text-tuna">{submit.message}</span>
          )}
        </div>
      ) : (
        // The honest state, named on screen rather than left as a submit button that fails.
        <p className="font-mono text-[11px] opacity-60">
          Unranked run — the server did not issue this seed, so it cannot be verified. The
          next run will be ranked if the board is reachable.
        </p>
      )}

      <button
        type="button"
        onClick={onAgain}
        className="self-start border border-khaki/50 px-3 py-1.5 font-mono text-sm"
      >
        play again
      </button>

      <div className="border-t border-khaki/25 pt-2">
        <h2 className="mb-1 font-mono text-[11px] uppercase tracking-widest opacity-60">
          Top 50
        </h2>
        <TetriceBoard refreshKey={boardKey} />
      </div>
    </div>
  );
}

/** The narrow layout's switches. One row, small, below the cluster — it is not a control
 *  and must not compete with one for the thumb's resting position. */
function NarrowBar({
  dpad,
  onDpad,
  ghostOn,
  onGhost,
  paused,
  onPause,
}: {
  dpad: boolean;
  onDpad: () => void;
  ghostOn: boolean;
  onGhost: () => void;
  paused: boolean;
  onPause: () => void;
}) {
  const item = "px-2 py-1 font-mono text-[11px] opacity-70 underline";
  return (
    <div className="mx-auto mb-1 flex items-center justify-center gap-2">
      <button type="button" className={item} onClick={onPause} aria-pressed={paused}>
        {paused ? "resume" : "pause"}
      </button>
      <button type="button" className={item} onClick={onDpad} aria-pressed={dpad}>
        buttons {dpad ? "on" : "off"}
      </button>
      <button type="button" className={item} onClick={onGhost} aria-pressed={ghostOn}>
        ghost {ghostOn ? "on" : "off"}
      </button>
    </div>
  );
}

// ─── panel ───────────────────────────────────────────────────────────────────

function PreviewBox({ shape, cell, id }: { shape: Shape | null; cell: number; id: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const box = 4;
    cvs.width = Math.round(box * cell * dpr);
    cvs.height = Math.round(box * cell * dpr);
    cvs.style.width = `${box * cell}px`;
    cvs.style.height = `${box * cell}px`;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPreview(ctx, shape, box, {
      cell,
      palette: readPalette(document.documentElement),
      fusion: FUSION,
      id,
    });
  }, [shape, cell, id]);
  return <canvas ref={ref} className="block" />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 font-mono">
      <span className="text-[11px] uppercase tracking-widest opacity-60">{label}</span>
      {/* Fixed width: a HUD that reflows at 10,000 points is a HUD that moves the well. */}
      <span className="w-[7ch] text-right text-lg tabular-nums">{value}</span>
    </div>
  );
}

function Panel({
  queue,
  hold,
  hud,
  cell,
  ghostOn,
  onGhost,
  dpad,
  onDpad,
  paused,
  onPause,
}: {
  queue: Shape[];
  hold: Shape | null;
  hud: { score: number; level: number; lines: number };
  cell: number;
  ghostOn: boolean;
  onGhost: () => void;
  dpad: boolean;
  onDpad: () => void;
  paused: boolean;
  onPause: () => void;
}) {
  return (
    <aside className="flex w-[16rem] shrink-0 flex-col gap-4">
      <section>
        <h2 className="mb-1 font-mono text-[11px] uppercase tracking-widest opacity-60">Next</h2>
        <div className="flex flex-col gap-1">
          {queue.map((s, i) => (
            <PreviewBox key={`${s}-${i}`} shape={s} cell={i === 0 ? cell : Math.round(cell * 0.72)} id={`next-${i}`} />
          ))}
        </div>
      </section>
      {/* The mood board has no hold box; the spec decided one. Below NEXT because NEXT is
          read every piece and hold every few, so NEXT keeps the position nearest the well. */}
      <section>
        <h2 className="mb-1 font-mono text-[11px] uppercase tracking-widest opacity-60">Hold</h2>
        <PreviewBox shape={hold} cell={Math.round(cell * 0.72)} id="hold" />
      </section>
      <section className="flex flex-col gap-1 border-t border-khaki/25 pt-3">
        <Stat label="Score" value={hud.score.toLocaleString()} />
        <Stat label="Level" value={String(hud.level)} />
        <Stat label="Lines" value={String(hud.lines)} />
      </section>
      <div className="flex flex-col items-start gap-1">
        <button type="button" onClick={onGhost} className="font-mono text-[11px] opacity-60 underline">
          ghost {ghostOn ? "on" : "off"}
        </button>
        <button type="button" onClick={onDpad} className="font-mono text-[11px] opacity-60 underline" aria-pressed={dpad}>
          buttons {dpad ? "on" : "off"}
        </button>
        <button type="button" onClick={onPause} className="font-mono text-[11px] opacity-60 underline" aria-pressed={paused}>
          {paused ? "resume" : "pause"} <span className="opacity-70">(P)</span>
        </button>
      </div>
      <KeyHelp />
      <Wordmark />
    </aside>
  );
}

function CompactStrip({
  queue,
  hold,
  hud,
  cell,
}: {
  queue: Shape[];
  hold: Shape | null;
  hud: { score: number; level: number; lines: number };
  cell: number;
}) {
  return (
    <div className="flex items-center gap-3 border border-khaki/25 p-2">
      <div className="flex gap-1">
        {queue.map((s, i) => (
          <PreviewBox key={`${s}-${i}`} shape={s} cell={cell} id={`nnext-${i}`} />
        ))}
      </div>
      <PreviewBox shape={hold} cell={cell} id="nhold" />
      <div className="ml-auto flex flex-col font-mono text-[11px] leading-tight">
        <span className="tabular-nums">{hud.score.toLocaleString()}</span>
        <span className="opacity-60">L{hud.level} · {hud.lines}</span>
      </div>
    </div>
  );
}

/** The bindings, on screen, because a control nobody can find does not exist. */
function KeyHelp() {
  const row = (keys: string, what: string) => (
    <div className="flex justify-between gap-3">
      <span className="opacity-80">{keys}</span>
      <span className="opacity-50">{what}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-0.5 border-t border-khaki/25 pt-3 font-mono text-[10px] leading-tight">
      {row("← →", "move")}
      {row("↑ / X", "rotate")}
      {row("Z / Ctrl", "rotate back")}
      {row("↓", "soft drop")}
      {row("Space", "hard drop")}
      {row("Shift / C", "hold")}
      {row("P / Esc", "pause")}
    </div>
  );
}

/** The panel wordmark. Two lines, and the mood board's title block is not reproduced. */
function Wordmark() {
  return (
    <div className="mt-auto flex items-center gap-3 pt-4">
      <RiceBowlMark />
      <div className="font-display leading-none">
        <div className="text-2xl tracking-wide">TETRICE</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-60">
          One Grain of Rice
        </div>
      </div>
    </div>
  );
}

/** Drawn inline: no file, no request, nothing to go missing at runtime. */
function RiceBowlMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <path d="M4 16 h26 a13 13 0 0 1 -26 0 z" fill="#eae3d2" opacity="0.9" />
      <ellipse cx="13" cy="13" rx="5" ry="3" fill="#f4efe2" transform="rotate(-20 13 13)" />
      <ellipse cx="20" cy="12" rx="5" ry="3" fill="#f4efe2" transform="rotate(15 20 12)" />
      <ellipse cx="17" cy="15" rx="5" ry="3" fill="#fbf7ee" transform="rotate(-5 17 15)" />
      <path d="M2 30 h30" stroke="#c4b370" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export const _internals = { VISIBLE_ROWS, BUFFER_ROWS };
