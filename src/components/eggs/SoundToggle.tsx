"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { isSoundOn, soundServerSnapshot, subscribeSound, toggleSound } from "@/lib/sound";

/** Single global sound on/off toggle (muted by default). SSR-safe. */
export function SoundToggle({ className = "" }: { className?: string }) {
  const on = useSyncExternalStore(subscribeSound, isSoundOn, soundServerSnapshot);

  return (
    <button
      type="button"
      onClick={() => toggleSound()}
      aria-pressed={on}
      aria-label={on ? "Mute sound" : "Enable sound"}
      className={`flex min-h-9 min-w-9 items-center justify-center ${className}`}
    >
      {on ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
    </button>
  );
}
