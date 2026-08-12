"use client";

/**
 * TETRICE — palette + grain-axis GATE. THROWAWAY, not linked from anywhere.
 *
 * A falsification test of two decisions in `docs/tetrice-spec.md` (*The pieces*). It
 * renders what that section specifies and nothing else. The greyscale view is a REAL
 * render with hue removed at fill time (see `gateRender.toMono`), not a CSS filter over
 * the coloured output — the point is to see what the renderer produces without hue, which
 * a filter over a screenshot cannot tell you.
 *
 * Query params so a headless capture can pin the view: `?mono=1`, `?grid=0`.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AXIS,
  FAMILY,
  SHAPES,
  SHAPE_DEF,
  buildStack,
  paintField,
  paintPiece,
  paintGhost,
  paintCell,
  readPalette,
  type FusionMode,
  type Palette,
  type Shape,
} from "./gateRender";

const DPR_CAP = 3;

/** True only after hydration, without a setState-in-effect. */
const NOOP_SUBSCRIBE = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => true,
    () => false,
  );
}

interface CanvasProps {
  wCells: number;
  hCells: number;
  cell: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
  label?: string;
}

function GateCanvas({ wCells, hCells, cell, draw }: CanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const w = wCells * cell;
    const h = hCells * cell;
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    cvs.style.width = `${w}px`;
    cvs.style.height = `${h}px`;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
  }, [wCells, hCells, cell, draw]);
  return <canvas ref={ref} className="block" />;
}

/** One shape, all four rotations, in a row of 5-cell slots. */
function RotationRow({
  shape,
  cell,
  palette,
  mono,
  grid,
  fusion,
}: {
  shape: Shape;
  cell: number;
  palette: Palette;
  mono: boolean;
  grid: boolean;
  fusion: FusionMode;
}) {
  const slot = 5;
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 font-mono text-xs text-paper">
        <span className="text-base font-bold">{shape}</span>{" "}
        <span className="opacity-70">
          {AXIS[shape].replace("diagNE", "↗").replace("diagSE", "↘")}
        </span>
        <div className="opacity-50">{FAMILY[shape]}</div>
      </div>
      <GateCanvas
        wCells={slot * 4}
        hCells={slot}
        cell={cell}
        draw={(ctx) => {
          paintField(ctx, slot * 4, slot, { cell, grid });
          for (let rot = 0; rot < 4; rot++) {
            const box = SHAPE_DEF[shape].box;
            const pad = (slot - box) / 2;
            paintPiece(
              ctx,
              shape,
              rot,
              { col: rot * slot + pad, row: pad },
              // One instance id per (shape, rotation) cell — so the four rotations show
              // the SAME piece instance re-rendered, which is the point: a rotation must
              // not re-roll the jitter.
              `rot-demo-${shape}`,
              { cell, palette, mono, fusion },
            );
          }
        }}
      />
    </div>
  );
}

function PieceTile({
  shape,
  rot = 0,
  cell,
  palette,
  mono,
  grid,
  fusion,
  id,
}: {
  shape: Shape;
  rot?: number;
  cell: number;
  palette: Palette;
  mono: boolean;
  grid: boolean;
  fusion: FusionMode;
  id: string;
}) {
  const box = SHAPE_DEF[shape].box;
  const w = box + 1;
  return (
    <GateCanvas
      wCells={w}
      hCells={w}
      cell={cell}
      draw={(ctx) => {
        paintField(ctx, w, w, { cell, grid });
        paintPiece(ctx, shape, rot, { col: 0.5, row: 0.5 }, id, { cell, palette, mono, fusion });
      }}
    />
  );
}

function Pair({
  a,
  b,
  cell,
  palette,
  mono,
  grid,
  fusion,
  note,
}: {
  a: Shape;
  b: Shape;
  cell: number;
  palette: Palette;
  mono: boolean;
  grid: boolean;
  fusion: FusionMode;
  note: string;
}) {
  return (
    <div className="inline-flex flex-col gap-1">
      <div className="flex items-start gap-2">
        {[a, b].map((s) => (
          <div key={s} className="flex flex-col items-center gap-1">
            <PieceTile
              shape={s}
              cell={cell}
              palette={palette}
              mono={mono}
              grid={grid}
              fusion={fusion}
              id={`pair-${a}${b}-${s}`}
            />
            <span className="font-mono text-[10px] text-paper opacity-70">{s}</span>
          </div>
        ))}
      </div>
      <span className="font-mono text-[10px] text-paper opacity-50">{note}</span>
    </div>
  );
}

export default function TetriceGate() {
  const mounted = useMounted();
  // Overrides start null so the URL is the initial view; a click takes over from there.
  const [monoOverride, setMonoOverride] = useState<boolean | null>(null);
  const [gridOverride, setGridOverride] = useState<boolean | null>(null);
  const [fusionOverride, setFusionOverride] = useState<string | null>(null);

  const params = mounted ? new URLSearchParams(window.location.search) : null;
  const mono = monoOverride ?? params?.get("mono") === "1";
  const grid = gridOverride ?? params?.get("grid") !== "0";
  // PHASE 3 ACCEPTANCE EVIDENCE: the fused read, before and after, on the SHIPPED painter.
  const fusion = ((fusionOverride ?? params?.get("fusion")) || "brick") as FusionMode;
  const palette = mounted ? readPalette(document.documentElement) : null;

  if (!palette) return <div className="p-4 font-mono text-xs text-paper">…</div>;

  const stack = buildStack(10, 6, 0x7e771ce);
  const queueCell = 42; // 1.4x the 30px well cell, per the spec.

  const stackPanel = (cell: number, id: string) => (
    <section id={id} className="flex flex-col gap-2">
      <h2 className="font-mono text-xs text-paper">
        Stacked field — 10×6 locked pieces, cell {cell}px
      </h2>
      <div className="overflow-x-auto">
        <GateCanvas
          wCells={10}
          hCells={6}
          cell={cell}
          draw={(ctx) => {
            paintField(ctx, 10, 6, { cell, grid });
            for (const c of stack) paintCell(ctx, c, { cell, palette, mono, fusion });
          }}
        />
      </div>
    </section>
  );

  return (
    <main className="min-h-screen bg-nori px-3 py-4 text-paper">
      <header className="mb-4 flex flex-col gap-2">
        <h1 className="font-mono text-sm font-bold">
          TETRICE — palette + grain-axis gate
        </h1>
        <p className="max-w-prose font-mono text-[11px] leading-relaxed opacity-70">
          Falsification test of <em>The pieces</em> in docs/tetrice-spec.md. Seven @theme
          tokens, three-way categorical grain axis fixed in screen space, four grains per
          cell in a loose 2×2, jitter keyed on (pieceInstanceId, cellIndex, grainIndex).
        </p>
        <div className="flex gap-2">
          <button
            id="toggle-mono"
            type="button"
            onClick={() => setMonoOverride(!mono)}
            className="border border-khaki/40 px-2 py-1 font-mono text-[11px]"
          >
            {mono ? "greyscale ON" : "greyscale off"}
          </button>
          {(["anisotropic", "crossAxis", "brick"] as const).map((m) => (
            <button
              key={m}
              id={`fusion-${m}`}
              type="button"
              onClick={() => setFusionOverride(m)}
              className={`border px-2 py-1 font-mono text-[11px] ${fusion === m ? "border-tuna text-tuna" : "border-khaki/40"}`}
            >
              {m}
            </button>
          ))}
          <button
            id="toggle-grid"
            type="button"
            onClick={() => setGridOverride(!grid)}
            className="border border-khaki/40 px-2 py-1 font-mono text-[11px]"
          >
            {grid ? "grid ON" : "grid off"}
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-8">
        {/* ---- PRIMARY TARGET: S vs Z at the 15px floor ---- */}
        <section id="panel-primary" className="flex flex-col gap-2 border border-tuna/40 p-2">
          <h2 className="font-mono text-xs font-bold">
            PRIMARY — S (↗) vs Z (↘), cell 15px
          </h2>
          <div className="flex flex-wrap items-start gap-3">
            {[0, 1, 2, 3].map((rot) => (
              <div key={rot} className="flex items-start gap-2">
                {(["S", "Z"] as Shape[]).map((s) => (
                  <div key={s} className="flex flex-col items-center gap-1">
                    <PieceTile
                      shape={s}
                      rot={rot}
                      cell={15}
                      palette={palette}
                      mono={mono}
                      grid={grid}
              fusion={fusion}
                      id={`primary-${s}-${rot}`}
                    />
                    <span className="font-mono text-[10px] opacity-70">
                      {s}·r{rot}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* ---- hue-family pairs ---- */}
        <section id="panel-pairs-15" className="flex flex-col gap-2">
          <h2 className="font-mono text-xs">Hue-family pairs — well floor, cell 15px</h2>
          <div className="flex flex-wrap gap-6">
            <Pair fusion={fusion} a="S" b="O" cell={15} palette={palette} mono={mono} grid={grid} note="both green" />
            <Pair fusion={fusion} a="Z" b="T" cell={15} palette={palette} mono={mono} grid={grid} note="both red" />
            <Pair fusion={fusion} a="J" b="O" cell={15} palette={palette} mono={mono} grid={grid} note="both green" />
            <Pair fusion={fusion} a="S" b="J" cell={15} palette={palette} mono={mono} grid={grid} note="both green" />
          </div>
        </section>

        <section id="panel-pairs-queue" className="flex flex-col gap-2">
          <h2 className="font-mono text-xs">
            Hue-family pairs — NEXT queue, cell {queueCell}px (1.4× the 30px well)
          </h2>
          <div className="flex flex-wrap gap-6 overflow-x-auto">
            <Pair fusion={fusion} a="S" b="O" cell={queueCell} palette={palette} mono={mono} grid={grid} note="both green" />
            <Pair fusion={fusion} a="Z" b="T" cell={queueCell} palette={palette} mono={mono} grid={grid} note="both red" />
          </div>
        </section>

        {/* ---- NEXT queue treatment, all seven ---- */}
        <section id="panel-queue" className="flex flex-col gap-2">
          <h2 className="font-mono text-xs">NEXT-queue treatment — all 7, cell {queueCell}px</h2>
          <div className="flex flex-wrap gap-3 overflow-x-auto">
            {SHAPES.map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <PieceTile
                  shape={s}
                  cell={queueCell}
                  palette={palette}
                  mono={mono}
                  grid={grid}
              fusion={fusion}
                  id={`queue-${s}`}
                />
                <span className="font-mono text-[10px] opacity-70">{s}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---- all shapes, all rotations, three cell sizes ---- */}
        {[15, 22, 30].map((cell) => (
          <section id={`panel-rot-${cell}`} key={cell} className="flex flex-col gap-2">
            <h2 className="font-mono text-xs">
              All 7 shapes × 4 rotations — cell {cell}px
              {cell === 15 ? " (the floor)" : ""}
            </h2>
            <div className="flex flex-col gap-2 overflow-x-auto">
              {SHAPES.map((s) => (
                <RotationRow
                  key={s}
                  shape={s}
                  cell={cell}
                  palette={palette}
                  mono={mono}
                  grid={grid}
                  fusion={fusion}
                />
              ))}
            </div>
          </section>
        ))}


        {/* ---- PHASE 3: the ghost against a locked stack, in one frame ---- */}
        {[22, 15].map((cell) => (
          <section id={`panel-ghost-${cell}`} key={cell} className="flex flex-col gap-2">
            <h2 className="font-mono text-xs">
              Ghost + locked stack — cell {cell}px · fusion {fusion}
            </h2>
            <div className="overflow-x-auto">
              <GateCanvas
                wCells={10}
                hCells={12}
                cell={cell}
                draw={(ctx) => {
                  paintField(ctx, 10, 12, { cell, grid });
                  // A four-row stack at the bottom, from the same deterministic sample.
                  const stackCells = buildStack(10, 4, 0x9051);
                  const occupied = new Set<string>();
                  for (const c of stackCells) {
                    const row = c.row + 8;
                    occupied.add(`${c.col},${row}`);
                    paintCell(ctx, { ...c, row }, { cell, palette, mono, fusion });
                  }
                  // An S piece falling down the middle, and its landing position.
                  const shape: Shape = "S";
                  const col = 3;
                  const cellsFor = (r: number) =>
                    SHAPE_DEF[shape].cells.map(([x, y]) => [col + x, r + y] as const);
                  let land = 1;
                  while (
                    land < 11 &&
                    !cellsFor(land + 1).some(([x, y]) => occupied.has(`${x},${y}`) || y > 11)
                  ) {
                    land += 1;
                  }
                  paintGhost(ctx, shape, 0, { col, row: land }, "ghost-demo", {
                    cell,
                    palette,
                    mono,
                    fusion,
                  });
                  paintPiece(ctx, shape, 0, { col, row: 1 }, "ghost-demo", {
                    cell,
                    palette,
                    mono,
                    fusion,
                  });
                }}
              />
            </div>
          </section>
        ))}
        {stackPanel(22, "panel-stack-22")}
        {stackPanel(15, "panel-stack-15")}

        {/* ---- fused-edge check: one piece, grid off, at each size ---- */}
        <section id="panel-fuse" className="flex flex-col gap-2">
          <h2 className="font-mono text-xs">
            Fused-edge check — I (horizontal), S (↗), Z (↘), L (↘), at 15 / 22 / 30
          </h2>
          <div className="flex flex-wrap gap-4 overflow-x-auto">
            {[15, 22, 30].map((cell) =>
              (["I", "S", "Z", "L"] as Shape[]).map((s) => (
                <div key={`${s}-${cell}`} className="flex flex-col items-center gap-1">
                  <PieceTile
                    shape={s}
                    cell={cell}
                    palette={palette}
                    mono={mono}
                    grid={grid}
              fusion={fusion}
                    id={`fuse-${s}-${cell}`}
                  />
                  <span className="font-mono text-[10px] opacity-70">
                    {s}·{cell}px
                  </span>
                </div>
              )),
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
