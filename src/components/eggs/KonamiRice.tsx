"use client";

import { useEffect } from "react";
import { useRice } from "@/components/rice/RiceParticles";
import { playPour } from "@/lib/sound";

/**
 * Konami code (↑↑↓↓←→←→ B A) → a heavy rice dump across the whole viewport. The
 * Phase 2 engine caps live particles and clears itself as grains fall, so it
 * settles cleanly. Listens passively and never preventDefaults, so arrow keys
 * keep scrolling and keyboard nav is unaffected. No-ops under reduced motion
 * (pour() is inert there).
 */
const SEQUENCE = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
];

export function KonamiRice() {
  const { pour } = useRice();

  useEffect(() => {
    let idx = 0;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      idx = key === SEQUENCE[idx] ? idx + 1 : key === SEQUENCE[0] ? 1 : 0;
      if (idx < SEQUENCE.length) return;
      idx = 0;
      // Dump grains across the full width from the top.
      const w = window.innerWidth;
      const cols = 32;
      for (let i = 0; i < cols; i++) {
        pour({ x: ((i + 0.5) / cols) * w, y: 30, count: 14 });
      }
      playPour();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pour]);

  return null;
}
