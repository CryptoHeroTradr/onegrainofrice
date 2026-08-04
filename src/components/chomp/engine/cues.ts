/**
 * RICE CHOMP — audio cues, DERIVED from the simulation and never fed back into it.
 *
 * ── WHY THIS MODULE EXISTS, AND WHY IT LOOKS LIKE THIS ──────────────────────────
 * The obvious way to get sound out of a game engine is to have the engine push
 * events: `state.events.push("chomp")` inside consume(), and the host drains the
 * queue. That is exactly what must not happen here.
 *
 * The run is replayed server-side from (seed, inputLog). Anything the simulation
 * writes has to be reproduced identically by a Node process with no speakers, and
 * anything the HOST can influence must not be able to reach the simulation at all.
 * An event queue is state: it is allocated, appended to, and drained by whoever is
 * listening — so a headless replay and a browser run would differ in what they
 * allocated, and a bug in the drain path would be a bug in the run.
 *
 * So sound is not an output of the simulation. It is an OBSERVATION of it. This
 * module diffs two consecutive snapshots of counters the engine already keeps —
 * grainsEaten, pestsEaten, phase — and infers what must have just happened. It
 * takes a readonly view, writes nothing, allocates nothing per tick, and can be
 * deleted entirely without changing a single tick of any run. `test/chomp-audio.
 * test.ts` proves all three by freezing the state and observing it anyway.
 *
 * The same argument covers the rest of Phase 5: the attract screen, the pause
 * menu, the mute and contrast toggles, the d-pad and the swipe surface are all
 * host-side. The only engine call any of them makes is setWanted(), which is the
 * same call the keyboard makes and is already part of the trace. See the CUTSCENE
 * note in game.ts — this is that argument applied to everything else.
 *
 * Pure module: no React, no DOM, no imports outside ./. Runs under the DOM-free
 * vitest setup.
 */

import { CLEARED, DYING, GAMEOVER } from "./game";

/**
 * The readonly slice of the game state a cue can be inferred from. Typed as its
 * own interface rather than as GameState so that this module is structurally
 * incapable of reaching anything it should not — there is no grid here, no
 * player, no inputLog, nothing writable.
 */
export interface CueSource {
  readonly phase: number;
  readonly grainsEaten: number;
  readonly powerEaten: number;
  readonly pestsEaten: number;
  readonly chain: number;
  readonly level: number;
  readonly extraLifeGiven: boolean;
  readonly bonus: { readonly taken: number };
}

// Cues are bit flags rather than objects because observe() runs inside the fixed
// timestep loop, up to ten times a frame, and the acceptance criteria say no
// per-frame allocation in the hot loop. A number allocates nothing.
export const CUE_CHOMP = 1 << 0;
export const CUE_GOLDEN = 1 << 1;
export const CUE_PEST = 1 << 2;
export const CUE_DEATH = 1 << 3;
export const CUE_BONUS = 1 << 4;
export const CUE_EXTRA_LIFE = 1 << 5;
export const CUE_LEVEL_CLEAR = 1 << 6;
export const CUE_GAME_OVER = 1 << 7;

/** The previous snapshot, plus the one payload a cue carries. Mutated in place. */
export interface CueWatch {
  phase: number;
  grainsEaten: number;
  powerEaten: number;
  pestsEaten: number;
  bonusTaken: number;
  extraLifeGiven: boolean;
  level: number;
  /** Chain length of the last CUE_PEST, 1-based. Only meaningful when that bit is set. */
  chain: number;
}

export function createCueWatch(): CueWatch {
  return {
    phase: -1,
    grainsEaten: 0,
    powerEaten: 0,
    pestsEaten: 0,
    bonusTaken: 0,
    extraLifeGiven: false,
    level: 0,
    chain: 0,
  };
}

/**
 * Point the watcher at a state without emitting anything. Called when a run
 * starts or restarts, so the first observe() of a fresh game does not fire seven
 * cues for the difference between "no game" and "a game".
 */
export function syncCueWatch(w: CueWatch, s: CueSource): void {
  w.phase = s.phase;
  w.grainsEaten = s.grainsEaten;
  w.powerEaten = s.powerEaten;
  w.pestsEaten = s.pestsEaten;
  w.bonusTaken = s.bonus.taken;
  w.extraLifeGiven = s.extraLifeGiven;
  w.level = s.level;
  w.chain = 0;
}

/**
 * What happened between the last call and now, as a bitmask. Call once per
 * simulated tick, immediately after tick().
 *
 * Counters are compared with `>` rather than `!==` so that a level rollover or a
 * restart — which resets some of them — can never be read as an event.
 */
export function observeCues(w: CueWatch, s: CueSource): number {
  let cues = 0;

  if (s.grainsEaten > w.grainsEaten) cues |= CUE_CHOMP;
  if (s.powerEaten > w.powerEaten) cues |= CUE_GOLDEN;
  if (s.pestsEaten > w.pestsEaten) {
    cues |= CUE_PEST;
    // state.chain is incremented as the pest is eaten, so it is already the
    // 1-based link number by the time the tick has finished.
    w.chain = s.chain;
  }
  if (s.bonus.taken > w.bonusTaken) cues |= CUE_BONUS;
  if (s.extraLifeGiven && !w.extraLifeGiven) cues |= CUE_EXTRA_LIFE;

  // Phase EDGES, not phase states — a phase lasts many ticks and its sound does not.
  if (s.phase !== w.phase) {
    if (s.phase === DYING) cues |= CUE_DEATH;
    if (s.phase === CLEARED) cues |= CUE_LEVEL_CLEAR;
    if (s.phase === GAMEOVER) cues |= CUE_GAME_OVER;
  }

  w.phase = s.phase;
  w.grainsEaten = s.grainsEaten;
  w.powerEaten = s.powerEaten;
  w.pestsEaten = s.pestsEaten;
  w.bonusTaken = s.bonus.taken;
  w.extraLifeGiven = s.extraLifeGiven;
  w.level = s.level;

  return cues;
}
