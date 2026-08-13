"use client";

/**
 * TETRICE's persisted preferences, in the shape RICE CHOMP and GRAINSNAKE already use: a
 * module-level value, a localStorage mirror, and a `subscribe` so React reads it through
 * `useSyncExternalStore` rather than through an effect that flashes the default first.
 *
 * Nothing here touches the simulation. The d-pad is a second way to reach the same
 * `InputState` the keyboard and the touch surface reach (*controls.ts*).
 *
 * ── THE D-PAD DEFAULTS **ON** FOR A COARSE POINTER, AND THAT IS THE OPPOSITE OF
 *    GRAINSNAKE'S DEFAULT ON PURPOSE ────────────────────────────────────────────────
 * GRAINSNAKE defaults its pad OFF on every pointer type, and the reason is written out in
 * `src/components/grainsnake/prefs.ts`: the cluster costs 168–192 px out of a column that
 * is also the board's, and on a 667 px phone that pushed a torus's top and bottom rows
 * off-screen. **The cost is board, and the board is the game.**
 *
 * That argument does not transfer, and the reason is the geometry:
 *
 *  - Tetrice's well is 10 × 20 and letterboxed inside whatever space it is given
 *    (*layout.ts*). Space taken by the cluster comes off the CELL SIZE, never off the
 *    edges, and the cell has a measured floor of 15 px below which nothing is legible.
 *    A pad that shrinks the cell from 19 px to 15 px costs legibility that was measured;
 *    a pad that clipped two rows of a torus cost information that did not exist anywhere
 *    else on screen.
 *  - Grainsnake's swipe is the primary control and needs no second one: it steers, and
 *    steering is one bit of information every few hundred ms. This game's controls are
 *    move, rotate, hold and two kinds of drop, and **rotate has no swipe** — it is a tap,
 *    which is the gesture most easily eaten by a mis-recognised drag. A player whose taps
 *    are being read as swipes has no way to rotate at all, and the pad is the answer that
 *    does not require them to diagnose it.
 *
 * The swipe surface stays live whether the pad is on or off, so this is a default about
 * what a new player MEETS, not about what the game supports.
 */

import { useSyncExternalStore } from "react";
import { CONTROLS } from "./controls";

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
 * The default, when the player has never chosen: on for a coarse pointer, off otherwise.
 *
 * `(pointer: coarse)` describes the PRIMARY pointer, so a laptop with a touchscreen and a
 * trackpad reports fine and gets no pad — which is right, because that machine has a
 * keyboard. An explicit choice overrides this for ever after in both directions, which is
 * what makes either default cheap.
 */
export function dpadDefault(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

let dpad: boolean | null = null;

function dpadValue(): boolean {
  if (dpad === null) dpad = read(CONTROLS.DPAD_STORAGE_KEY, dpadDefault());
  return dpad;
}

export function setDpad(on: boolean): void {
  dpad = on;
  write(CONTROLS.DPAD_STORAGE_KEY, on);
  listeners.forEach((l) => l());
}

export function toggleDpad(): void {
  setDpad(!dpadValue());
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * The SERVER snapshot is always `false`, and it has to be: the server cannot know the
 * pointer type or read localStorage, and a guess that disagrees with the client is a
 * hydration mismatch on an attribute React does not patch up. The pad therefore appears
 * just after hydration on a phone rather than in the server's output — which is the same
 * resolution the board sizing takes, for the same reason (*TetriceScreen*).
 */
export function useDpad(): boolean {
  return useSyncExternalStore(subscribe, dpadValue, () => false);
}
