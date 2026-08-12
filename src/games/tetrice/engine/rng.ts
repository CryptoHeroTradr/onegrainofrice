/**
 * TETRICE — the only source of randomness in the game.
 *
 * One 32-bit generator, one state word, seeded from the server (spec: *The randomizer*).
 * `Math.random()` appears nowhere in the engine and nowhere in its tests — a single stray
 * call is enough to make a run unreplayable, and it would not fail loudly.
 *
 * Pure: every function here takes the state and returns the next one. Nothing is stored
 * in module scope, so two simulations can run side by side in one process — which is
 * exactly what the score route does while a player is mid-run.
 */

import { SHAPES, type Shape } from "./rules";

/** The generator's entire state: one non-zero uint32. */
export type RngState = number;

/** 0 is a fixed point of xorshift, so it is never a usable state. */
export function seedRng(seed: number): RngState {
  const s = seed >>> 0;
  return s === 0 ? 0x9e3779b9 : s;
}

/** xorshift32. Returns the next state; the state IS the random value. */
export function nextState(state: RngState): RngState {
  let s = state >>> 0;
  s ^= (s << 13) >>> 0;
  s >>>= 0;
  s ^= s >>> 17;
  s ^= (s << 5) >>> 0;
  return s >>> 0;
}

/** An integer in [0, bound), from the state after advancing it. */
export function nextInt(state: RngState, bound: number): { state: RngState; value: number } {
  const s = nextState(state);
  return { state: s, value: s % bound };
}

/**
 * A 7-bag: all seven shapes, shuffled, dealt, then reshuffled. A shape is never more than
 * twelve pieces away and the player can count.
 *
 * **THE SHUFFLE IS PART OF `ENGINE_VERSION`.** Fisher–Yates walking DOWNWARD, taking the
 * swap index from `nextInt(i + 1)`. Reversing the loop or changing the modulus produces a
 * different — equally valid, equally uniform — permutation from the same seed, and every
 * stored replay silently rescores. If this function changes, the constant changes.
 */
export function nextBag(state: RngState): { state: RngState; bag: Shape[] } {
  const bag = [...SHAPES];
  let s = state;
  for (let i = bag.length - 1; i > 0; i--) {
    const roll = nextInt(s, i + 1);
    s = roll.state;
    const j = roll.value;
    const tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
  }
  return { state: s, bag };
}
