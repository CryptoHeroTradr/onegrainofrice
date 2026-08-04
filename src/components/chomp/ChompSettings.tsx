"use client";

import { useSyncExternalStore } from "react";
import { isSoundOn, soundServerSnapshot, subscribeSound, toggleSound } from "@/lib/sound";
import { isContrastOn, isDpadOn, setContrastOn, setDpadOn, useContrast, useDpad } from "./prefs";

/**
 * The three persisted switches: sound, high contrast, d-pad.
 *
 * All three are reachable WITHOUT STARTING A GAME — they sit in the screen's
 * control bar, which is on screen behind the attract overlay and inside the pause
 * menu. The spec asks for that explicitly about contrast, and it is the right rule
 * for all three: a player who needs the high-contrast board needs it in order to
 * read the attract screen's maze too, and a player looking for the mute button is
 * usually already annoyed.
 *
 * None of them touches the simulation. Sound is derived from state and discarded
 * (engine/cues.ts); contrast changes which colours the static layers bake in; the
 * d-pad is a second caller of setWanted().
 */

/** The site's one sound switch, read the React way. */
export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribeSound, isSoundOn, soundServerSnapshot);
}

function Toggle({
  on,
  onClick,
  label,
  hint,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={hint}
      className={`min-h-9 border px-3 font-mono text-[0.65rem] tracking-[0.15em] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki ${
        on
          ? "border-khaki text-khaki"
          : "border-steamed/25 text-steamed/45 hover:border-steamed/50 hover:text-steamed/70"
      }`}
    >
      {label}
    </button>
  );
}

export function ChompSettings() {
  const sound = useSoundOn();
  const contrast = useContrast();
  const dpad = useDpad();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle
        on={sound}
        onClick={toggleSound}
        label={sound ? "Sound on" : "Muted"}
        hint="M — this is the site's sound switch, shared with the rest of the page"
      />
      <Toggle
        on={contrast}
        onClick={() => setContrastOn(!isContrastOn())}
        label="High contrast"
        hint="Plain black walls with a bright keyline, and brighter grains"
      />
      <Toggle
        on={dpad}
        onClick={() => setDpadOn(!isDpadOn())}
        label="D-pad"
        hint="Swipe works either way; this adds buttons under the board"
      />
    </div>
  );
}
