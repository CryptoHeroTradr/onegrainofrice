"use client";

import { BonusIcons } from "./BonusIcons";

/**
 * The game-over card.
 *
 * It has to do four things and it is worth being explicit about the fourth: say
 * what the run was worth, say whether that was any good, offer a way back in — and
 * REFUSE TO FLATTER A DEBUG RUN. A run started from `?level=N` skipped the levels
 * below it and can never be a score; the spec asks for that to be visible rather
 * than merely enforced, so it is said here in words as well as being kept off the
 * local board and out of Phase 7's submission path.
 */
export function ChompGameOver({
  score,
  level,
  place,
  best,
  debugFrom,
  onPlayAgain,
  onQuit,
}: {
  score: number;
  level: number;
  /** 1-based position on the local board, or 0 if it did not make it. */
  place: number;
  best: number;
  /** The level a debug run started on, or 0 for an ordinary run. */
  debugFrom: number;
  onPlayAgain: () => void;
  onQuit: () => void;
}) {
  const debug = debugFrom > 0;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-nori/85 px-5 py-6 text-center">
      <p className="font-display-round text-chomp-head font-semibold text-khaki">Game over</p>

      <div translate="no" className="notranslate flex flex-col items-center gap-1.5">
        <p className="font-display-round text-chomp-hero leading-none font-semibold text-steamed tabular-nums">
          {score.toLocaleString()}
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-chomp-micro tracking-[0.18em] text-steamed/40 uppercase">
            Level {level}
          </span>
          <BonusIcons level={level} />
        </div>
      </div>

      {debug ? (
        <p className="max-w-xs border border-salmon/40 px-3 py-2 font-mono text-chomp-note leading-snug text-salmon">
          Debug run, started on level {debugFrom}. It skipped the levels below it, so
          it is not a score and has not been recorded.
        </p>
      ) : place === 1 ? (
        <p className="font-mono text-chomp-body tracking-[0.15em] text-khaki uppercase">
          New best on this device
        </p>
      ) : place > 0 ? (
        <p className="font-mono text-chomp-body text-steamed/50">
          Number {place} on this device · best {best.toLocaleString()}
        </p>
      ) : (
        <p className="font-mono text-chomp-body text-steamed/50">
          Best on this device is {best.toLocaleString()}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {/* Focused on appearance, so Space and Enter reach it natively — and so a
            keyboard player is never left on a screen with nothing focused. The
            window handler in ChompCanvas covers the case where focus is elsewhere. */}
        <button
          type="button"
          autoFocus
          onClick={onPlayAgain}
          className="min-h-11 border-2 border-khaki px-5 font-mono text-chomp-lead tracking-[0.15em] text-khaki uppercase transition-colors hover:bg-khaki hover:text-nori focus-visible:bg-khaki focus-visible:text-nori focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steamed"
        >
          Play again
        </button>
        <button
          type="button"
          onClick={onQuit}
          className="min-h-11 border border-steamed/25 px-5 font-mono text-chomp-lead tracking-[0.15em] text-steamed/60 uppercase transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
        >
          Title screen
        </button>
      </div>

      {/* No tap-anywhere here, unlike the attract screen. A stray thumb landing a
          moment after the death that caused it would wipe the score off the screen
          before it had been read. */}
      <p className="font-mono text-chomp-note text-steamed/35">or press Space</p>
    </div>
  );
}
