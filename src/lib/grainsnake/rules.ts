/**
 * GRAINSNAKE — every number the simulation reads.
 *
 * PURE AND ISOMORPHIC. No React, no DOM, no `window`, no `Date`, no `performance`,
 * no node builtins. This module is imported by the engine, by the vitest suite, and
 * — the whole point — by the server-side replayer in a route handler. If anything
 * here ever needs a browser, the replay design is broken.
 *
 * ── WHY EVERY TUNABLE IS IN ONE FILE ────────────────────────────────────────────
 * `docs/grainsnake-spec.md` (*Scoring*) requires it: "Every tuning number ... lives
 * in one `engine/rules.ts`. No magic numbers in engine code." The reason is
 * `ENGINE_VERSION` below — a version constant only works if the things it versions
 * are all in front of you when you change one.
 *
 * Durations are authored in TICKS and distances in STEPS, because those are the
 * units the simulation advances in. Seconds appear in comments only. See the spec's
 * *Speed* and *Food*: a value the replayer cannot reconstruct from
 * `(seed, inputs, tick index)` cannot be a rule.
 */

/**
 * THE ENGINE VERSION. An integer, and it lives HERE — beside the tunables rather
 * than in the database layer — because this is the file you are already editing when
 * you change a number the simulation reads.
 *
 * **Bump it on ANY change to a value in this file.** The board size, the tier table,
 * the thresholds, the golden budget, the queue depth, the starting length, the score
 * values. Every accepted run stores the version it was verified under; the replayer
 * refuses a version it does not implement rather than rescoring the run under today's
 * rules. See the spec's *Anti-cheat* — without this, the first tuning pass silently
 * rescores history.
 *
 * Stored rows are NEVER re-verified or rescored on a bump. Verification happened once,
 * at submit time, and a bump invalidates nothing.
 */
export const ENGINE_VERSION = 1;

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * 23 × 23, walled on all four sides, no interior obstacles.
 *
 * Odd on both axes so there is a true centre cell to start on and a true centre
 * column to start pointing along. Settled 2026-08-06 by the size gate: 13 adjacent
 * grains read as 13 grains at the ~15px cell this implies on a 390px phone, through
 * a straight run and around a corner, at true CSS pixels on a DPR-3 device. 19×19 was
 * costed and rejected — see the spec's *The board*.
 */
export const COLS = 23;
export const ROWS = 23;

/** Every cell on the board. Also the ring buffer's capacity and the maximum length. */
export const CELL_COUNT = COLS * ROWS;

/** The centre cell — odd dimensions mean this is exact, not rounded. */
export const START_CELL = ((ROWS - 1) / 2) * COLS + (COLS - 1) / 2;

// ---------------------------------------------------------------------------
// The snake
// ---------------------------------------------------------------------------

/** Starting length, in segments. Head included. */
export const START_LENGTH = 3;

/**
 * Simulation rate. Wall-clock is converted to whole ticks by the HOST and never
 * reaches the rules; see `drainTicks()` in engine.ts and the spec's *Speed*.
 */
export const TICK_HZ = 60;

/**
 * Turns a player may have buffered at once.
 *
 * TWO, deliberately. At tier 7 a step is 67 ms and a player entering a corner has to
 * be allowed to key both halves of it before the first lands; one slot is enough at
 * 6 cells/sec and demonstrably not at 15. Three would let a player queue a route
 * whose consequences they can no longer see.
 */
export const TURN_QUEUE_DEPTH = 2;

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------

/** Ordinary grains eaten between golden-grain appearances. A counter, never a timer. */
export const GOLDEN_EVERY = 8;

/**
 * The golden grain's travel budget, in STEPS — not seconds, and the distinction is
 * both a correctness and a design fix (spec, *Food*).
 *
 * Correctness: a wall-clock expiry cannot be reproduced by a replayer that has no
 * client clock. Design: 40 cells sits just under this board's 44-cell maximum
 * Manhattan distance at EVERY tier, so "can I get there and back into space?" stays a
 * real geometry question for the whole run instead of dissolving exactly when the
 * game is hardest.
 */
export const GOLDEN_STEPS = 40;

/** Base value of one ordinary grain, before the tier multiplier. */
export const SCORE_GRAIN = 10;
/** Base value of one golden grain, before the tier multiplier. */
export const SCORE_GOLDEN = 50;

// ---------------------------------------------------------------------------
// The speed / scoring curve
// ---------------------------------------------------------------------------

export interface Tier {
  /** Total food eaten at which this tier begins. Inclusive lower bound. */
  fromFood: number;
  /** Ticks between steps. INTEGER — see below. */
  ticksPerStep: number;
  /** Score multiplier applied to a grain eaten while in this tier. */
  multiplier: number;
}

/**
 * ── THE TICKS/STEP COLUMN IS NOT TUNABLE. THE `fromFood` COLUMN IS. ──────────────
 *
 * Only an integer number of ticks can elapse between two steps in a fixed-timestep
 * simulation, so any cells-per-second figure that is not `60 / n` for integer `n` is
 * a number this engine cannot produce. 10 down to 4 is every value there is in the
 * playable range: 6.0, 6.7, 7.5, 8.6, 10.0, 12.0, 15.0 cells/sec. 3 ticks/step
 * (20 cells/sec) is deliberately unreachable — at 50 ms a mistimed turn is input lag,
 * not difficulty.
 *
 * ═══ THE `fromFood` THRESHOLDS ARE PLACEHOLDERS. THEY ARE NOT TUNED. ═════════════
 *
 * Everything tunable about the difficulty curve is this column, and these seven
 * numbers have never been measured against a player. They are a shape — roughly equal
 * wall-clock per tier (~20 s), with tier 6 widened to 30 items so the largest speed
 * jump in the table (5→4, a 25% increase) does not land on a player with no room to
 * absorb it.
 *
 * **What resolves them: the death-length distribution — where runs actually end.**
 * The spec (*Speed*) requires the thresholds be tuned against that and not against the
 * full-board case, because tier 7 opens at 81 food (length 84) and most runs end well
 * before it; the 445-of-526 arithmetic in *Scoring* describes a run almost nobody has.
 *
 * **Why the leaderboard cannot supply it, which is the part that is easy to miss.**
 * The board stores `best_score` and `best_length` — the BEST run per player, one row
 * each. A distribution of where runs end needs every run, including the bad ones, and
 * a best-per-player table is precisely the shape that throws those away. It is also
 * survivorship-biased twice over: only players good enough to submit appear at all,
 * and only their best appearance survives. `grainsnake_runs` is append-only and does
 * hold every accepted run, so the data can be gathered — but not before the game has
 * shipped and been played, and not from the board.
 *
 * The difficulty bot is NOT the instrument either: it plays to fill the board, which
 * is the distribution being argued against.
 *
 * So: ship these, gather runs, then tune. Changing any of them is an `ENGINE_VERSION`
 * bump.
 */
export const TIERS: readonly Tier[] = [
  { fromFood: 0, ticksPerStep: 10, multiplier: 1 }, // ~6.0 cells/sec
  { fromFood: 8, ticksPerStep: 9, multiplier: 2 }, // ~6.7
  { fromFood: 17, ticksPerStep: 8, multiplier: 3 }, // ~7.5
  { fromFood: 27, ticksPerStep: 7, multiplier: 4 }, // ~8.6
  { fromFood: 38, ticksPerStep: 6, multiplier: 5 }, // ~10.0
  { fromFood: 51, ticksPerStep: 5, multiplier: 6 }, // ~12.0  (widened: 30 items)
  { fromFood: 81, ticksPerStep: 4, multiplier: 7 }, // ~15.0
] as const;

/**
 * The tier index for a given amount of food eaten. Linear scan of seven entries —
 * the table is tiny and a scan cannot disagree with the table the way a formula can.
 */
export function tierIndexFor(foodEaten: number): number {
  let i = 0;
  for (let t = 0; t < TIERS.length; t++) {
    if (foodEaten >= TIERS[t].fromFood) i = t;
    else break;
  }
  return i;
}

/** Ticks between steps at this much food eaten. */
export function ticksPerStepFor(foodEaten: number): number {
  return TIERS[tierIndexFor(foodEaten)].ticksPerStep;
}

/** Score multiplier at this much food eaten. Tier 1 is ×1, so this is 1-based. */
export function multiplierFor(foodEaten: number): number {
  return TIERS[tierIndexFor(foodEaten)].multiplier;
}

// ---------------------------------------------------------------------------
// Replay bounds
// ---------------------------------------------------------------------------

/**
 * Hard ceilings on what the replayer will simulate, checked BEFORE it starts —
 * a trace is an input to a loop and that loop runs on the web process.
 *
 * **PROVISIONAL, and knowingly generous.** The spec requires these be measured from a
 * real board-filling run plus headroom, and that bot does not exist yet. The naive
 * estimate for a full board is ~35,000 ticks, but it ignores late-game routing
 * detours entirely and is wrong in the direction that matters, so these are set well
 * above it rather than near it. Tighten once measured; do not tighten by guessing.
 */
export const MAX_REPLAY_TICKS = 600_000;
/** Ceiling on entries in an input log. One turn per step is the theoretical maximum. */
export const MAX_INPUT_EVENTS = 60_000;
