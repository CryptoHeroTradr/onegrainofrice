"use client";

import { DOWN, LEFT, RIGHT, UP, type Dir } from "./engine/types";

/**
 * The optional on-screen d-pad.
 *
 * Swipe is always live and needs no chrome; this exists because a swipe surface
 * gives no feedback and nothing to aim at, and some players want a button. The
 * spec asks for both, always available, with this one toggleable — so this is an
 * ADDITION to swipe and never a replacement, and turning it off can never leave
 * anyone unable to play.
 *
 * ONE-THUMBED IS THE REQUIREMENT, so:
 *  - it sits under the board, not over it, and never covers the maze;
 *  - it is centred, because a phone is held in either hand;
 *  - the keys are 60px with no gaps between them, which is comfortably over the
 *    44px minimum and, more to the point, means a thumb sliding from UP to RIGHT
 *    crosses no dead space and does not have to be lifted;
 *  - it fires on POINTERDOWN, not on click. Waiting for the release costs a whole
 *    corner in a game where a corner is worth a third of a tile.
 *
 * The only engine call it makes is steer(), which is setWanted() — the same call
 * the arrow keys make and already part of the input trace. See engine/cues.ts.
 */

const KEYS: ReadonlyArray<{ dir: Dir; label: string; glyph: string; col: number; row: number }> = [
  { dir: UP, label: "Up", glyph: "▲", col: 2, row: 1 },
  { dir: LEFT, label: "Left", glyph: "◀", col: 1, row: 2 },
  { dir: RIGHT, label: "Right", glyph: "▶", col: 3, row: 2 },
  { dir: DOWN, label: "Down", glyph: "▼", col: 2, row: 3 },
];

export function TouchControls({ onSteer }: { onSteer: (dir: Dir) => void }) {
  return (
    <div
      className="grid touch-none select-none"
      style={{
        gridTemplateColumns: "repeat(3, 60px)",
        gridTemplateRows: "repeat(3, 60px)",
      }}
    >
      {KEYS.map(({ dir, label, glyph, col, row }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          style={{ gridColumn: col, gridRow: row }}
          onPointerDown={(e) => {
            // preventDefault stops the browser turning the press into a synthetic
            // tap/scroll gesture; stopPropagation keeps it out of the swipe surface
            // should this ever be moved over the board rather than under it.
            e.preventDefault();
            e.stopPropagation();
            onSteer(dir);
          }}
          // Keyboard users get the same buttons for free; the window-level handler
          // in ChompCanvas would otherwise be their only route.
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") onSteer(dir);
          }}
          className="flex items-center justify-center border border-steamed/25 bg-steamed/5 text-lg text-steamed/70 transition-colors active:border-khaki active:bg-khaki/20 active:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
        >
          <span aria-hidden>{glyph}</span>
        </button>
      ))}
    </div>
  );
}
