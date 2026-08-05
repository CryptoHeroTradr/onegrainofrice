"use client";

import { useEffect, useRef, useState } from "react";
import { LOCUST, RAT, SPARROW, WEEVIL } from "./engine/levels";
import { PestPortrait } from "./PestPortrait";
import { useScores } from "./scores";

/**
 * The attract screen: title, the four pests introduced one at a time, the high
 * scores, and a way in.
 *
 * IT IS DOM, NOT CANVAS, and that is a decision rather than a shortcut. A canvas
 * attract screen would have been closer to the arcade, and it would have been text
 * a screen reader cannot see, a button a keyboard cannot reach, and a layout that
 * has to be hand-measured at every viewport. The one thing canvas is genuinely
 * needed for — the pests themselves — is done on canvas, one small context per
 * portrait, through the same drawing code the board uses.
 *
 * It also costs the simulation nothing, because there is no simulation: while this
 * is up ChompCanvas does not call tick() at all, and the run that starts is a new
 * state. See engine/cues.ts.
 */

const CAST: ReadonlyArray<{ kind: number; name: string; blurb: string }> = [
  { kind: RAT, name: "Rat", blurb: "Comes straight at you. No cleverness, no let-up." },
  { kind: SPARROW, name: "Sparrow", blurb: "Aims at where you are going, not where you are." },
  { kind: WEEVIL, name: "Weevil", blurb: "Swings wide off the Rat and closes the other end." },
  { kind: LOCUST, name: "Locust", blurb: "Hunts from a distance, and bolts when you get close." },
];

/** Milliseconds between one pest arriving and the next. */
const REVEAL_MS = 550;

/** How far a finger may drift and still count as a tap rather than a scroll, in CSS px. */
const TAP_SLOP = 10;

export function ChompAttract({
  onStart,
  reducedMotion,
}: {
  onStart: () => void;
  reducedMotion: boolean;
}) {
  const [revealed, setRevealed] = useState(0);
  const scores = useScores();
  const downRef = useRef<{ x: number; y: number } | null>(null);

  // Under reduced motion the roll call arrives whole. The information is the point;
  // the staging is the flourish, and the flourish is what the preference asks to
  // drop. Derived at render rather than pushed into state, so the effect below has
  // nothing to do in that case and no state to set synchronously.
  const shown = reducedMotion ? CAST.length : revealed;

  useEffect(() => {
    if (reducedMotion) return;
    const timers = CAST.map((_, i) =>
      setTimeout(() => setRevealed((n) => Math.max(n, i + 1)), (i + 1) * REVEAL_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-y-auto bg-nori/88 px-5 py-6 text-center"
      // Tap anywhere to play. The overlay covers the board, so the canvas's own tap
      // handler never sees the gesture — without this, "tap to start" would be a
      // promise the screen quietly breaks.
      //
      // It must be a TAP and not any pointerup: this panel scrolls on a short phone,
      // and a flick to read the high scores that started the game under you would be
      // maddening. Presses that land on a real control are left alone so the Start
      // button still works as a button.
      onPointerDown={(e) => {
        downRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const d = downRef.current;
        if (!d) return;
        downRef.current = null;
        if (Math.abs(e.clientX - d.x) > TAP_SLOP || Math.abs(e.clientY - d.y) > TAP_SLOP) return;
        onStart();
      }}
    >
      <div>
        <h2 className="font-display-round text-4xl font-semibold tracking-tight text-khaki sm:text-chomp-hero">
          RICE CHOMP
        </h2>
        <p className="mt-1 font-mono text-chomp-chip tracking-[0.22em] text-steamed/45 uppercase">
          Clear the paddy · mind the pests
        </p>
      </div>

      <ul className="flex w-full max-w-md flex-col gap-2 text-left">
        {CAST.map((p, i) => (
          <li
            key={p.name}
            className="flex items-center gap-3 transition-opacity duration-300"
            style={{ opacity: i < shown ? 1 : 0 }}
            // Hidden from assistive tech until it has arrived, so the reading order
            // matches what is on screen rather than announcing four pests at once.
            aria-hidden={i >= shown}
          >
            <PestPortrait kind={p.kind} />
            <div className="min-w-0">
              <p className="font-display-round text-chomp-name leading-tight font-semibold text-steamed">
                {p.name}
              </p>
              <p className="font-mono text-chomp-note leading-snug text-steamed/50">{p.blurb}</p>
            </div>
          </li>
        ))}
      </ul>

      <div translate="no" className="notranslate w-full max-w-md">
        <p className="font-mono text-chomp-micro tracking-[0.18em] text-steamed/40 uppercase">
          Best on this device
        </p>
        {scores.length === 0 ? (
          <p className="mt-1 font-mono text-chomp-body text-steamed/35">Nothing yet. Go first.</p>
        ) : (
          <ol className="mt-1.5 flex flex-col gap-0.5">
            {scores.map((s, i) => (
              <li
                key={`${s.at}-${i}`}
                className="flex items-baseline justify-between gap-4 font-mono text-chomp-body tabular-nums"
              >
                <span className="text-steamed/35">{i + 1}</span>
                <span className="flex-1 border-b border-dotted border-steamed/15" />
                <span className="text-khaki">{s.score.toLocaleString()}</span>
                <span className="w-14 text-right text-steamed/35">level {s.level}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <button
        type="button"
        autoFocus
        onClick={onStart}
        className="min-h-12 border-2 border-khaki px-8 font-mono text-chomp-lead tracking-[0.2em] text-khaki uppercase transition-colors hover:bg-khaki hover:text-nori focus-visible:bg-khaki focus-visible:text-nori focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steamed"
      >
        Start
      </button>
      <p className="font-mono text-chomp-note text-steamed/40">or press any key · tap anywhere</p>
    </div>
  );
}
