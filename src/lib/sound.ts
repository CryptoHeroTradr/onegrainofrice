import { asset } from "@/lib/asset";

/**
 * Tiny sound manager. MUTED by default. The on/off state lives in a module
 * variable — session-only, no storage (SSR-safe). Audio elements are created
 * lazily on first enable, and sounds ONLY play on explicit calls (user
 * gestures) — never autoplay — and never under reduced motion.
 */

let soundOn = false;
let pourEl: HTMLAudioElement | null = null;
let clackEl: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

function ensureAudio() {
  if (typeof window === "undefined") return;
  if (!pourEl) {
    pourEl = new Audio(asset("/sfx/rice-pour.wav"));
    pourEl.volume = 0.4;
  }
  if (!clackEl) {
    clackEl = new Audio(asset("/sfx/chopstick-clack.wav"));
    clackEl.volume = 0.5;
  }
}

function reduced() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function isSoundOn() {
  return soundOn;
}

export function setSoundOn(on: boolean) {
  soundOn = on;
  if (on) ensureAudio();
  listeners.forEach((l) => l());
}

export function toggleSound() {
  setSoundOn(!soundOn);
}

export function subscribeSound(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function play(el: HTMLAudioElement | null) {
  if (!soundOn || !el || reduced()) return;
  try {
    el.currentTime = 0;
    void el.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

export function playPour() {
  play(pourEl);
}
export function playClack() {
  play(clackEl);
}
