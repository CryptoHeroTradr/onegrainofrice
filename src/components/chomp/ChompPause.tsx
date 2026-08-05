"use client";

import { ChompSettings } from "./ChompSettings";

/**
 * The pause screen.
 *
 * A real screen rather than the inert "Paused" scrim it replaces: pause is where a
 * player goes to change something, and an overlay that only says the game is
 * stopped sends them hunting for the settings behind it. Resume is autofocused, so
 * Space or Enter gets straight back into the run.
 *
 * Pausing costs the simulation nothing — ChompCanvas simply stops calling tick(),
 * and the accumulator is not fed while paused, so no time is banked and no catch-up
 * burst arrives on resume.
 */
export function ChompPause({
  onResume,
  onQuit,
}: {
  onResume: () => void;
  onQuit: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-y-auto bg-nori/85 px-5 py-6 text-center">
      <p className="font-display-round text-chomp-head font-semibold text-khaki">Paused</p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          autoFocus
          onClick={onResume}
          className="min-h-11 border-2 border-khaki px-5 font-mono text-chomp-lead tracking-[0.15em] text-khaki uppercase transition-colors hover:bg-khaki hover:text-nori focus-visible:bg-khaki focus-visible:text-nori focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steamed"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={onQuit}
          className="min-h-11 border border-steamed/25 px-5 font-mono text-chomp-lead tracking-[0.15em] text-steamed/60 uppercase transition-colors hover:border-tuna hover:text-tuna focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
        >
          End run
        </button>
      </div>

      <ChompSettings />

      <p className="max-w-sm font-mono text-chomp-note leading-relaxed text-steamed/40">
        Arrows or WASD to steer, or swipe the board. P or Esc pauses, M mutes. Turn
        early into a corner and you gain ground — the pests can only turn dead centre.
      </p>
    </div>
  );
}
