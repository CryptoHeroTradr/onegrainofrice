"use client";

/**
 * GRAINSNAKE's persisted preferences, in the same shape as the site's sound toggle
 * and RICE CHOMP's `prefs.ts`: a module-level value, a localStorage mirror, and a
 * subscribe function so React can read it with `useSyncExternalStore`.
 *
 * None of them touches the simulation. The d-pad is a second way to call `steer()`,
 * and sound and music are derived from state transitions the host observes.
 *
 * ── THE MUTE IS GAME-LOCAL, AND THAT SUPERSEDES THE SPEC ────────────────────────
 * *Changed 2026-08-07, Lito's call. `docs/grainsnake-spec.md` said the opposite and
 * has been amended in the same commit.*
 *
 * The spec's rule was "there is ONE sound switch on this site and every game answers
 * to it", because a game-local mute means a player who muted the site still gets
 * chirped at. That failure is real, so the toggle is game-local **and the site switch
 * is still a master gate**: `grainsnake:sound` can only ever make this game quieter
 * than the site setting, never louder. A player who muted the site hears nothing here.
 *
 * That keeps the property the spec was protecting while giving this game its own
 * switch — which it needs, because it is the first game with MUSIC, and music is a
 * thing you turn off without wanting the effects off too.
 *
 * MUSIC DEFAULTS OFF. Sound defaults on. A loop that starts itself on a page you
 * opened to look at is the single most reliable way to make someone close the tab.
 */

import { useSyncExternalStore } from "react";

const DPAD_KEY = "grainsnake:dpad";
const SOUND_KEY = "grainsnake:sound";
const MUSIC_KEY = "grainsnake:music";

type Listener = () => void;
const listeners = new Set<Listener>();

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
 * ── THE D-PAD DEFAULTS ON FOR A COARSE POINTER. ─────────────────────────────────
 * *Decided 2026-08-07, and it is the opposite of RICE CHOMP's default — which is why
 * it is argued rather than copied.*
 *
 * Chomp defaults its d-pad OFF because swipe is unambiguously its primary control and
 * a control cluster costs board height on the viewport with the least of it. That
 * reasoning does not survive the latency measurement here.
 *
 * At tier 7 a cell is 67 ms. Swipe recognition costs one touch sample at any real
 * finger speed — a quarter of a cell — and a d-pad press costs nothing at all, because
 * a tap has no distance to accumulate before its direction is known. The gap is small
 * but it is in one direction, and it widens exactly where the game is hardest. Both
 * controls are live at once regardless, so the default is only a question of what a
 * new player meets first, and on a phone that should be the control with no
 * recognition step in it.
 *
 * An explicit choice still overrides the default forever after, in both directions,
 * which is what makes either default cheap.
 */
function coarsePointerDefault(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

let dpad: boolean | null = null;

function dpadValue(): boolean {
  if (dpad === null) dpad = read(DPAD_KEY, coarsePointerDefault());
  return dpad;
}

export function setDpad(on: boolean): void {
  dpad = on;
  write(DPAD_KEY, on);
  listeners.forEach((l) => l());
}

export function toggleDpad(): void {
  setDpad(!dpadValue());
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDpad(): boolean {
  // The server snapshot is `false`: the default depends on `matchMedia`, which does
  // not exist there, and rendering a control cluster on the server that the client
  // then removes is a hydration mismatch rather than a preference.
  return useSyncExternalStore(subscribe, dpadValue, () => false);
}

// ---------------------------------------------------------------------------
// Sound and music
// ---------------------------------------------------------------------------

let snd: boolean | null = null;
let mus: boolean | null = null;

function soundValue(): boolean {
  if (snd === null) snd = read(SOUND_KEY, true);
  return snd;
}
function musicValue(): boolean {
  if (mus === null) mus = read(MUSIC_KEY, false);
  return mus;
}

export function setGameSound(on: boolean): void {
  snd = on;
  write(SOUND_KEY, on);
  listeners.forEach((l) => l());
}
export function toggleGameSound(): void {
  setGameSound(!soundValue());
}
export function setMusic(on: boolean): void {
  mus = on;
  write(MUSIC_KEY, on);
  listeners.forEach((l) => l());
}
export function toggleMusic(): void {
  setMusic(!musicValue());
}

/** Read outside React (the audio layer needs it every tick, not every render). */
export function gameSoundOn(): boolean {
  return soundValue();
}
export function musicOn(): boolean {
  return musicValue();
}

export function useGameSound(): boolean {
  return useSyncExternalStore(subscribe, soundValue, () => true);
}
export function useMusic(): boolean {
  return useSyncExternalStore(subscribe, musicValue, () => false);
}
