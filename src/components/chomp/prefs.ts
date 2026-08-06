"use client";

/**
 * RICE CHOMP's two persisted display preferences, in the same shape as the site's
 * sound toggle (`src/lib/sound.ts`): a module-level value, a localStorage mirror,
 * and a subscribe function so React can read them with useSyncExternalStore.
 *
 * MUTE IS DELIBERATELY NOT HERE. The site already has one persisted sound switch
 * and it is the one the chopstick cursor, the grains clicker and this game all
 * answer to. A second, game-local mute would mean a player who muted the site
 * still gets chomped at, which is the opposite of what muting means. `M` on
 * /chomp drives `toggleSound()`, and the pause menu says so.
 *
 * Neither preference touches the simulation. Contrast changes which colours the
 * static layers are baked in; the d-pad is a second way to call `steer()`, which
 * is the same entry point the keyboard uses. See engine/cues.ts for the full
 * argument.
 */

import { useSyncExternalStore } from "react";

const DPAD_KEY = "chomp:dpad";
const CONTRAST_KEY = "chomp:contrast";

function read(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === "on") return true;
    if (v === "off") return false;
  } catch {
    /* storage blocked — the default stands and simply will not persist */
  }
  return fallback;
}

function write(key: string, on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, on ? "on" : "off");
  } catch {
    /* storage blocked — the choice just won't survive a reload */
  }
}

/**
 * THE D-PAD DEFAULTS OFF, EVERYWHERE. *Changed 2026-08-06, Lito's call.*
 *
 * It used to default ON for a coarse pointer, via
 * `matchMedia("(pointer: coarse)")` — which is to say it defaulted on for every
 * phone, the viewport with the least room, and put a control cluster under a
 * board that was already fighting for height. Swipe is the primary control, it is
 * always live, and the instruction line under the board says so in as many words
 * ("Swipe the board to steer"), so the buttons are an addition a player can ask
 * for rather than the thing they meet first.
 *
 * The toggle is unchanged and an explicit choice still overrides this forever
 * after, in both directions — which is the part that makes an off default cheap:
 * a player who wants buttons is one tap from them, and that tap persists.
 */
const DPAD_DEFAULT = false;

let dpadOn = false;
let contrastOn = false;
let hydrated = false;

/** Read storage once, lazily — the module is imported during SSR too. */
function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  dpadOn = read(DPAD_KEY, DPAD_DEFAULT);
  contrastOn = read(CONTRAST_KEY, false);
}

const listeners = new Set<() => void>();

function announce(): void {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function isDpadOn(): boolean {
  hydrate();
  return dpadOn;
}

export function setDpadOn(on: boolean): void {
  hydrate();
  dpadOn = on;
  write(DPAD_KEY, on);
  announce();
}

export function isContrastOn(): boolean {
  hydrate();
  return contrastOn;
}

export function setContrastOn(on: boolean): void {
  hydrate();
  contrastOn = on;
  write(CONTRAST_KEY, on);
  announce();
}

/**
 * Both hooks render `false` on the server and flip to the stored choice on
 * hydration — the same compromise `soundServerSnapshot()` makes. The cost is one
 * frame of the default, which for a canvas that re-bakes on the next paint is
 * invisible.
 */
export function useDpad(): boolean {
  return useSyncExternalStore(subscribe, isDpadOn, () => false);
}

export function useContrast(): boolean {
  return useSyncExternalStore(subscribe, isContrastOn, () => false);
}
