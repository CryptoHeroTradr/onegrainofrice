"use client";

import { DOWN, LEFT, RIGHT, UP, type Dir } from "@/lib/grainsnake/types";

/**
 * The d-pad. Four buttons, one call each, and no rule of its own.
 *
 * Every button ends at the same `steer()` the keyboard and the swipe surface reach.
 * There is no reversal check here, no buffering, no started flag — a second entry
 * point into the engine is a second thing the server-side replayer would have to know
 * about, and the whole input design is that there is exactly one.
 *
 * ── WHY IT FIRES ON `pointerdown`, NOT ON `click` ───────────────────────────────
 * At tier 7 a cell is 67 ms. `click` does not fire until the pointer is released, and
 * a browser may additionally hold it back waiting to see whether the gesture becomes
 * a double-tap. Both are longer than a step. `pointerdown` is the earliest moment the
 * direction is known, which is the same standard the swipe recogniser is held to.
 *
 * `touch-action: none` on each button stops the press from being interpreted as a
 * scroll or a double-tap zoom, scoped to the button rather than to the document.
 */

const PAD = "flex items-center justify-center border border-steamed/25 bg-steamed/5 text-steamed/80 active:bg-steamed/20 select-none";

export function TouchControls({
  onSteer,
  className = "",
}: {
  onSteer: (d: Dir) => void;
  className?: string;
}) {
  const button = (dir: Dir, label: string, glyph: string, extra: string) => (
    <button
      type="button"
      aria-label={label}
      className={`${PAD} ${extra}`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        // Fire on press, and keep the press from also becoming a scroll or a
        // focus change that steals the keyboard.
        e.preventDefault();
        onSteer(dir);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span aria-hidden="true" className="font-display-round text-2xl leading-none">
        {glyph}
      </span>
    </button>
  );

  return (
    <div
      className={`grid grid-cols-3 grid-rows-3 gap-1.5 ${className}`}
      style={{ touchAction: "none" }}
    >
      <div />
      {button(UP, "Steer up", "↑", "")}
      <div />
      {button(LEFT, "Steer left", "←", "")}
      <div />
      {button(RIGHT, "Steer right", "→", "")}
      <div />
      {button(DOWN, "Steer down", "↓", "")}
      <div />
    </div>
  );
}
