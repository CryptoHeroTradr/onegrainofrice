"use client";

/**
 * TETRICE — the screen.
 *
 * Thin route -> this client component -> the directive-free engine. Nothing in
 * `src/games/tetrice/engine/` is reimplemented here and no rule is re-derived: this file
 * draws what the engine says and records what the player pressed.
 *
 * **DAS/ARR ARE NOT HERE.** Auto-repeat is Phase 4, by decision, in the input layer. A
 * held key produces exactly one action here (`event.repeat` is ignored on purpose), so the
 * only thing that repeats today is gravity.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { step, type Action } from "../engine/step";
import { InputRecorder, maskOf, selfCheck } from "./inputLog";
import { previewCell, resolveBoardSize, type BoardSize } from "./layout";
import { startLoop } from "./loop";
import { readPalette, type FusionMode, type Palette } from "./grains";
import { Effects, drawPreview, drawWell, landingRow } from "./render";

/** The decided fusion mechanism. See `docs/tetrice-spec.md`, *The pieces*. */
const FUSION: FusionMode = "brick";

const KEY_ACTIONS: Record<string, Action> = {
  ArrowLeft: "MoveLeft",
  KeyA: "MoveLeft",
  ArrowRight: "MoveRight",
  KeyD: "MoveRight",
  ArrowUp: "RotateCW",
  KeyX: "RotateCW",
  KeyZ: "RotateCCW",
  ControlLeft: "RotateCCW",
  ArrowDown: "SoftDrop",
  KeyS: "SoftDrop",
  Space: "HardDrop",
  KeyC: "Hold",
  ShiftLeft: "Hold",
};

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

function newSeed(): number {
  // The seed is the SERVER's job from Phase 5 (`POST /api/tetrice/seed`). Until that route
  // exists every run takes a local seed and is UNRANKED — which is the same path the spec
  // specifies for a failed seed request, so this is the fallback, not a placeholder.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 0;
}

export default function TetriceScreen() {
  const mounted = useMounted();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const prevRef = useRef<GameState | null>(null);
  const pendingRef = useRef<Set<Action>>(new Set());
  const recorderRef = useRef<InputRecorder>(new InputRecorder());
  const effectsRef = useRef<Effects>(new Effects());
  const paletteRef = useRef<Palette | null>(null);
  const seedRef = useRef<number>(0);

  const [size, setSize] = useState<BoardSize | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [hud, setHud] = useState({ score: 0, level: 1, lines: 0, over: false });
  const [queue, setQueue] = useState<Shape[]>([]);
  const [hold, setHold] = useState<Shape | null>(null);
  const [ghostOn, setGhostOn] = useState(true);

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

  // ─── input ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Auto-repeat is Phase 4. Ignoring it here keeps the engine's contract honest: it
      // sees discrete per-frame actions and knows nothing about a key being held.
      if (e.repeat) return;
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      e.preventDefault();
      pendingRef.current.add(action);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  // ─── the run ───────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    const seed = newSeed();
    seedRef.current = seed;
    const s0 = createInitialState(seed);
    stateRef.current = s0;
    prevRef.current = null;
    recorderRef.current = new InputRecorder();
    effectsRef.current = new Effects();
    setHud({ score: 0, level: 1, lines: 0, over: false });
    setQueue([...s0.queue]);
    setHold(s0.hold);
  }, []);

  useEffect(() => {
    if (!size) return;
    if (!paletteRef.current) paletteRef.current = readPalette(document.documentElement);
    if (!stateRef.current) start();

    const handle = startLoop({
      step: () => {
        const s = stateRef.current;
        if (!s || s.over) return false;
        const actions = [...pendingRef.current];
        pendingRef.current.clear();
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
          // THE SELF-CHECK, on a finished run only. See inputLog.selfCheck.
          const log = recorderRef.current.build(seedRef.current, ENGINE_VERSION, next.ticks);
          selfCheck(log, next);
          setHud({ score: next.score, level: next.level, lines: next.lines, over: true });
          return false;
        }
        return true;
      },
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
  }, [size, ghostOn, start]);

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
        <div ref={wrapRef} className="relative min-h-0 min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2"
            style={{ border: "2px solid rgba(196,179,112,0.45)" }}
            aria-label="TETRICE well"
          />
        </div>
        {!narrow && (
          <Panel queue={queue.slice(0, shown)} hold={hold} hud={hud} cell={pCell} ghostOn={ghostOn} onGhost={() => setGhostOn((g) => !g)} />
        )}
      </div>
      {hud.over && (
        <button
          type="button"
          onClick={start}
          className="mx-auto mb-4 border border-khaki/50 px-4 py-2 font-mono text-sm"
        >
          RUN OVER — {hud.score.toLocaleString()} · play again
        </button>
      )}
    </main>
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
}: {
  queue: Shape[];
  hold: Shape | null;
  hud: { score: number; level: number; lines: number };
  cell: number;
  ghostOn: boolean;
  onGhost: () => void;
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
      <button type="button" onClick={onGhost} className="self-start font-mono text-[11px] opacity-60 underline">
        ghost {ghostOn ? "on" : "off"}
      </button>
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
