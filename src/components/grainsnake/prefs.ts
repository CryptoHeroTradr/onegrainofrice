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
 * ── THE D-PAD DEFAULTS OFF ON EVERY POINTER TYPE. ───────────────────────────────
 * *Reverted 2026-08-12, Lito's call, and it puts the code back where the spec always
 * said it was — `docs/grainsnake-spec.md`, Controls: "the d-pad defaults OFF on every
 * pointer type". The 2026-08-07 coarse-pointer default was never written into the
 * spec, so this is drift being closed rather than a new rule.*
 *
 * The argument for defaulting it on was a latency one: a d-pad press costs nothing to
 * recognise where a swipe costs one touch sample, about a quarter of a cell at tier 7.
 * That is true and it is still why the d-pad exists. It is not worth what it costs,
 * because the cost is BOARD, and the board is the game.
 *
 * The cluster is 168–192px out of the controls column on the viewport with the least
 * height to give. On a 667px-tall phone that takes the board's slot under 345px — the
 * floor board — and the player meets a game whose top and bottom rows are off-screen.
 * A control that shaves a quarter-cell off one turn is not worth two rows of a torus
 * the player cannot see. Swipe is primary, always live, and the line under the board
 * says so.
 *
 * The clipping itself is fixed independently, in `GrainsnakeCanvas`: the board is now
 * scaled down to fit rather than overflowing, so turning the d-pad ON costs board size
 * and never board EDGES. Both halves are needed — this one is about what a new player
 * meets first, that one is about the game being honest at any size.
 *
 * An explicit choice still overrides the default forever after, in both directions,
 * which is what makes either default cheap.
 */
const DPAD_DEFAULT = false;

let dpad: boolean | null = null;

function dpadValue(): boolean {
  if (dpad === null) dpad = read(DPAD_KEY, DPAD_DEFAULT);
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
  // The server snapshot is `false`, which is now also the client default — so the
  // only pass that can differ is one where the player has previously turned the pad
  // ON, and `useSyncExternalStore` resolves that after hydration rather than during.
  return useSyncExternalStore(subscribe, dpadValue, () => DPAD_DEFAULT);
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
