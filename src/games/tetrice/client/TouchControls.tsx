"use client";

/**
 * TETRICE — the on-screen cluster. Five controls, no rule of its own.
 *
 * Every button ends at the same `InputState` the keyboard and the swipe surface reach
 * (*controls.ts*), so the pad has no repeat logic, no threshold and no idea what a piece
 * is. Left and right are HELD — press and release, so DAS and ARR run exactly as they do
 * for an arrow key. Rotate, hold and drop are edges.
 *
 * ── WHY IT FIRES ON `pointerdown`, NOT ON `click` ──────────────────────────────────
 * `click` does not fire until release, and a browser may hold it back further while it
 * decides whether the gesture is a double-tap. At level 12 a row is 4 frames — 67 ms —
 * and both delays exceed it. `pointerdown` is the earliest moment the input is known,
 * which is the same standard the swipe recogniser is held to. GRAINSNAKE's pad made this
 * decision first; this is that decision applied, not re-derived.
 *
 * `touch-action: none` is scoped to the buttons so a press cannot become a page scroll or
 * a double-tap zoom, and `onPointerUp`/`onPointerCancel`/`onPointerLeave` all release —
 * **a held button whose release event goes to another element is a piece that walks into
 * the wall on its own**, and a finger sliding off a button is the ordinary way that
 * happens.
 */

import type { PointerEvent as ReactPointerEvent } from "react";
import type { HeldButton, PulseAction } from "./controls";

const FACE =
  "flex select-none items-center justify-center border border-khaki/40 bg-paper/5 " +
  "font-display-round leading-none text-paper/85 active:bg-paper/20";

function Hold({
  button,
  label,
  glyph,
  onPress,
  onRelease,
  className = "",
}: {
  button: HeldButton;
  label: string;
  glyph: string;
  onPress: (b: HeldButton) => void;
  onRelease: (b: HeldButton) => void;
  className?: string;
}) {
  const up = (e: ReactPointerEvent) => {
    e.preventDefault();
    onRelease(button);
  };
  return (
    <button
      type="button"
      aria-label={label}
      className={`${FACE} ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.preventDefault();
        // Keeps every later event for this pointer coming here even if the finger slides
        // off, so the release is ours to receive rather than the document's.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onPress(button);
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span aria-hidden="true" className="text-2xl">
        {glyph}
      </span>
    </button>
  );
}

function Pulse({
  action,
  label,
  glyph,
  onPulse,
  className = "",
}: {
  action: PulseAction;
  label: string;
  glyph: string;
  onPulse: (a: PulseAction) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`${FACE} ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.preventDefault();
        onPulse(action);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span aria-hidden="true" className="text-xl">
        {glyph}
      </span>
    </button>
  );
}

export function TouchControls({
  onPress,
  onRelease,
  onPulse,
  className = "",
}: {
  onPress: (b: HeldButton) => void;
  onRelease: (b: HeldButton) => void;
  onPulse: (a: PulseAction) => void;
  className?: string;
}) {
  return (
    // The two movement keys sit under the thumb that holds the phone and the three
    // one-shots under the other; rotate is the largest face because it is the most
    // pressed control in the game and the only one with no swipe of its own.
    <div
      className={`grid grid-cols-5 gap-1.5 ${className}`}
      style={{ touchAction: "none" }}
      aria-label="TETRICE touch controls"
    >
      <Hold button="Left" label="Move left" glyph="←" onPress={onPress} onRelease={onRelease} className="h-14" />
      <Hold button="Right" label="Move right" glyph="→" onPress={onPress} onRelease={onRelease} className="h-14" />
      <Pulse action="RotateCW" label="Rotate clockwise" glyph="↻" onPulse={onPulse} className="h-14" />
      <Pulse action="Hold" label="Hold piece" glyph="⇧" onPulse={onPulse} className="h-14" />
      <Pulse action="HardDrop" label="Hard drop" glyph="⤓" onPulse={onPulse} className="h-14" />
    </div>
  );
}
