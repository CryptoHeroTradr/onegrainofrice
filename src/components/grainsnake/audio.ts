"use client";

/**
 * GRAINSNAKE — audio, DERIVED from the simulation and never emitted by it.
 *
 * ── THE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────────────
 * The obvious wiring is `playEat()` inside the step function. That is exactly what
 * must not happen: **the run is replayed server-side by a Node process with no
 * speakers**, and a step function that reaches for an AudioContext cannot be the
 * replayer. So the engine makes no noise and knows nothing about audio; the host
 * OBSERVES state transitions between ticks and plays clips.
 *
 * Everything here is read-only over `GameState`. `test/grainsnake-audio.test.ts`
 * asserts that a run observed by this watcher is bit-identical to one that is not.
 *
 * ── AND THE GATE ORDER ──────────────────────────────────────────────────────────
 * Site sound switch → game sound switch → play. The game's own toggle can only make
 * this game quieter than the site setting, never louder, so a player who muted the
 * site hears nothing here. See `prefs.ts` for why the mute is game-local at all.
 */

import { tierIndexFor } from "@/lib/grainsnake/rules";
import type { GameState } from "@/lib/grainsnake/types";
import {
  isSoundOn,
  playSnakeDeath,
  playSnakeEat,
  playSnakeGolden,
  playSnakeTier,
  preloadSnake,
} from "@/lib/sound";
import { gameSoundOn } from "./prefs";

export { preloadSnake };

/**
 * What the watcher remembers between ticks. Counters only — never a reference to a
 * state object, which would make "did this change" a question about identity rather
 * than about the run.
 */
export interface CueWatch {
  foodEaten: number;
  goldens: number;
  tier: number;
  dead: boolean;
  filled: boolean;
}

/** What just happened. The host uses the same answer for audio AND for particles. */
export interface Cues {
  ate: boolean;
  golden: boolean;
  tierUp: boolean;
  died: boolean;
}

const NONE: Cues = { ate: false, golden: false, tierUp: false, died: false };

export function createCueWatch(s: GameState): CueWatch {
  return {
    foodEaten: s.foodEaten,
    goldens: s.goldensTaken,
    tier: tierIndexFor(s.foodEaten),
    dead: s.dead,
    filled: s.filled,
  };
}

/**
 * Diff the state against the watch and return what changed, updating the watch.
 *
 * READS `s`, WRITES ONLY `w`. That asymmetry is the whole safety property: a run
 * played with sound on is bit-identical to one played with it off, because this
 * function cannot reach the simulation even if it wanted to.
 */
export function observeCues(w: CueWatch, s: GameState): Cues {
  const tier = tierIndexFor(s.foodEaten);
  const grew = s.foodEaten > w.foodEaten;
  const goldenTaken = s.goldensTaken > w.goldens;
  const cues: Cues = {
    // A golden grain is also food, so an ordinary "ate" must exclude it — otherwise
    // taking one fires both clips on the same tick and they mask each other.
    ate: grew && !goldenTaken,
    golden: goldenTaken,
    tierUp: tier > w.tier,
    died: (s.dead && !w.dead) || (s.filled && !w.filled),
  };

  w.foodEaten = s.foodEaten;
  w.goldens = s.goldensTaken;
  w.tier = tier;
  w.dead = s.dead;
  w.filled = s.filled;

  return cues;
}

/** True when this game is allowed to make a sound at all. */
function audible(): boolean {
  return isSoundOn() && gameSoundOn();
}

/**
 * Play whatever the cues call for.
 *
 * Deliberately NOT gated on `prefers-reduced-motion`: that is a request for less
 * ANIMATION and says nothing about audio. Gating sound on it is a bug this repo has
 * already shipped once — anyone with the OS setting enabled got no sound at all, with
 * a toggle that said "on" and no explanation.
 */
export function playCues(cues: Cues, s: GameState): void {
  if (cues === NONE) return;
  if (!audible()) return;
  if (cues.died) playSnakeDeath();
  if (cues.golden) playSnakeGolden();
  else if (cues.ate) playSnakeEat(tierIndexFor(s.foodEaten) + 1);
  if (cues.tierUp) playSnakeTier();
}
