/**
 * RICE CHOMP — server-side run validation and the name rules.
 *
 * ISOMORPHIC AND PURE. No React, no DOM, no node builtins, no database. The route
 * handler is the authority and calls every function here; the browser calls the
 * name half of it too, so a player finds out their name is too short while they are
 * typing rather than after a submit round-trip. There is ONE implementation of each
 * rule and both sides import it — a client-side copy of a server rule is a client-
 * side rule that drifts.
 *
 * Every scoring constant is imported from `engine/levels.ts` rather than restated.
 * A validator with its own copy of "a grain is 10 points" is a validator that starts
 * rejecting real runs the day someone retunes the game.
 *
 * ═══ WHAT THIS DOES NOT CATCH ═══════════════════════════════════════════════════
 * This is arithmetic plausibility, not verification, and the difference is the whole
 * honest summary of the anti-cheat position. It rejects a submission whose numbers
 * cannot describe any run of this game. It does NOT reject a submission whose numbers
 * describe a run that never happened. Specifically, and by name:
 *
 *  1. **A hand-crafted consistent submission passes.** `{grains: 282, golden: 4,
 *     pests: 8, score: 6420, ticks: 5000}` is arithmetically perfect and can be
 *     written by anyone who reads this file. Nothing here re-derives the score from
 *     the trace, so an internally consistent lie is indistinguishable from a run.
 *  2. **The trace is stored UNVERIFIED.** It is parsed for shape and length and then
 *     written to the `trace` column untouched. Replay verification — re-simulating
 *     `(seed, trace)` with the same deterministic engine and computing the score
 *     ourselves — is deliberately left as a LATER, SERVER-ONLY change: the engine is
 *     already integer-exact and replayable (`engine/game.ts`, `replay()`), so the
 *     day it lands, no client ships. Every submission stored from today is verifiable
 *     retroactively. That is the reason the column exists before the checker does.
 *  3. **A real run played by a bot is a real run.** A headless client can play
 *     genuinely, at a thousand times real speed, and submit a trace that would pass
 *     replay verification too. Neither this file nor the eventual replay checker sees
 *     any difference; only a trusted server-side clock could, and there is no such
 *     thing on a submission the client controls end to end.
 *  4. **Identities are cheap.** `/grains/session` mints a signed `grain_vid` for
 *     anyone who asks, with no captcha and no proof of work (see the plan, §2.5). The
 *     per-vid rate limit is therefore a speed bump; the per-IP-hash limit in `db.ts`
 *     is the real bound, and a proxy pool defeats that too.
 *  5. **The bounds are LOOSE on purpose.** Cornering, the eating freeze and the
 *     pest-chain ordering all make the exact minimum duration and the exact score
 *     hard to state, so both are computed with slack. A cheat that stays inside the
 *     envelope is not detected. Tightening them would start rejecting real runs,
 *     which is a worse failure than admitting an implausible one.
 *
 * What it does buy: `curl -d '{"score":999999999}'` does not land on the board, and
 * neither does any of the obvious variations on it.
 */

import {
  BONUS_BY_LEVEL,
  BONUS_DOT_TRIGGERS,
  GRAIN_FREEZE_TICKS,
  PLAYER_SPEED,
  POWER_FREEZE_TICKS,
  SCORE_GRAIN,
  SCORE_PEST_CHAIN,
  SCORE_POWER,
  bonusForLevel,
} from "@/components/chomp/engine/levels";
import { MAZE, parseMaze } from "@/components/chomp/engine/maze";
import { SPEED_SCALE, SUB, TICK_HZ } from "@/components/chomp/engine/types";

// --- the board's own numbers, derived once ----------------------------------

const parsed = parseMaze(MAZE);
/** Ordinary grains in one board. */
export const GRAINS_PER_LEVEL = parsed.totalGrains;
/** Golden grains in one board. */
export const POWER_PER_LEVEL = parsed.totalPower;
/** Bonus items that can appear in one level. */
const BONUS_PER_LEVEL = BONUS_DOT_TRIGGERS.length;
/** Pests eatable inside a single power window. */
const PESTS_PER_WINDOW = SCORE_PEST_CHAIN.length;

/**
 * Ticks the player needs to cross one tile at full speed, from the engine's own
 * speed constant rather than a restated "8 tiles per second".
 */
const TICKS_PER_TILE = (SUB * SPEED_SCALE) / PLAYER_SPEED;

/**
 * How much of the theoretical minimum duration a run must actually have spent.
 *
 * The minimum is "one tile of travel per collectable, plus the eating freeze", and
 * cornering can shave up to `CORNER_LEAD` off a tile at a junction — so the true
 * floor is genuinely below the naive one. 0.6 is well under any achievable route and
 * still rejects the whole class of submissions this check exists for: a full board
 * cleared in under a second.
 */
const DURATION_SLACK = 0.6;

/** Nothing real is over before this. Two seconds of READY alone is 120 ticks. */
const MIN_TICKS = 120;

/** A level nobody will ever legitimately reach. Guards the per-level loops below. */
export const MAX_LEVEL = 256;

// --- names ------------------------------------------------------------------

export const NAME_MIN_LEN = 3;
export const NAME_MAX_LEN = 12;

/**
 * Strip a player-supplied name down to something safe to render.
 *
 * Removes control and bidi-override characters (a right-to-left override can make a
 * leaderboard row render as something entirely different from what is stored),
 * collapses whitespace, and drops the punctuation that turns up in injection
 * attempts. It deliberately does NOT restrict to ASCII letters: a player writing
 * their name in their own script is the normal case, not the attack.
 *
 * Returns null if nothing usable survives. The caller then rejects — this game asks
 * for a name per submission, so there is no generated-handle fallback to slide into.
 */
export function sanitizeChompName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    // Written as \u escapes rather than literal control characters, which is also
    // why there is no `no-control-regex` disable here: the rule fires on the literal
    // form, and a disable comment for a rule that is not firing outlives its reason.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    // Bidi overrides / embedding + the zero-width family: invisible, and every one
    // of them exists to make text render as something other than what it is.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[<>&"'`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX_LEN)
    .trim();
  return cleaned.length >= NAME_MIN_LEN ? cleaned : null;
}

/**
 * The profanity list, matched against a leet-folded, punctuation-stripped copy of the
 * name. Small and blunt on purpose.
 *
 * TWO KNOWN AND ACCEPTED FAULTS, so nobody "fixes" them into something worse:
 *  - It is a SUBSTRING match, so it has the Scunthorpe problem: legitimate names
 *    containing one of these as a fragment are refused. The cost of a false positive
 *    here is "pick another name"; the cost of a false negative is a slur at the top
 *    of a leaderboard on a public site. The trade is deliberate.
 *  - It is English-only and trivially evaded by anyone trying. It is a decency filter
 *    for a game, not a moderation system.
 */
const PROFANITY = [
  "anal", "anus", "arse", "bastard", "bitch", "bollock", "boner", "clit",
  "cock", "coon", "cum", "cunt", "dick", "dildo", "dyke", "fag", "fuck",
  "jizz", "kike", "nigg", "paki", "penis", "piss", "prick", "pussy", "rape",
  "retard", "semen", "shit", "slut", "spic", "twat", "vagina", "wank", "whore",
] as const;

const LEET: Record<string, string> = {
  "4": "a", "@": "a", "8": "b", "(": "c", "3": "e", "6": "g", "1": "i",
  "!": "i", "|": "i", "0": "o", "5": "s", "$": "s", "7": "t", "+": "t",
  "2": "z",
};

/** True if the name reads as one of the words above once the disguises are undone. */
export function containsProfanity(name: string): boolean {
  let folded = "";
  for (const ch of name.toLowerCase()) {
    const mapped = LEET[ch] ?? ch;
    // Everything that is not a letter is dropped, so "f.u.c.k" and "f u c k" fold
    // to the same string as the word itself.
    if (mapped >= "a" && mapped <= "z") folded += mapped;
  }
  // Collapse runs ("fuuuck"), which is the other cheap disguise.
  const squashed = folded.replace(/(.)\1+/g, "$1");
  return PROFANITY.some((w) => folded.includes(w) || squashed.includes(w));
}

export type NameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/** The one place a name is judged. The route calls this; so does the game-over card. */
export function checkName(raw: unknown): NameCheck {
  const name = sanitizeChompName(raw);
  if (!name) {
    return { ok: false, reason: `Names are ${NAME_MIN_LEN}–${NAME_MAX_LEN} characters.` };
  }
  if (containsProfanity(name)) return { ok: false, reason: "Pick another name." };
  return { ok: true, name };
}

// --- runs -------------------------------------------------------------------

/**
 * The numbers a client claims about a finished run. The trace travels beside this
 * and is parsed separately (see `trace.ts`); everything here is arithmetic.
 */
export interface RunClaim {
  score: number;
  /** The level the run ended on. */
  level: number;
  /** The level it STARTED on. Anything but 1 is a debug run and is never rankable. */
  startLevel: number;
  /** Simulation ticks elapsed. The engine's own clock, not wall time. */
  ticks: number;
  /** Ordinary grains eaten across the whole run. */
  grains: number;
  /** Golden grains eaten across the whole run. */
  golden: number;
  pests: number;
  bonuses: number;
}

export type RunCheck = { ok: true } | { ok: false; reason: string };

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1e9;
}

/**
 * The most the pest chain can be worth for `pests` pests eaten: fill power windows
 * to the top, because 200+400+800+1600 beats any two shorter chains holding the
 * same number of pests between them.
 */
function chainMax(pests: number): number {
  const prefix = [0];
  for (const v of SCORE_PEST_CHAIN) prefix.push(prefix[prefix.length - 1] + v);
  const full = Math.floor(pests / PESTS_PER_WINDOW);
  const rem = pests % PESTS_PER_WINDOW;
  return full * prefix[PESTS_PER_WINDOW] + prefix[rem];
}

/** The least it can be worth: every pest eaten first in its own window. */
function chainMin(pests: number): number {
  return pests * SCORE_PEST_CHAIN[0];
}

/** Cheapest and dearest a bonus item can be, over the levels this run saw. */
function bonusRange(level: number): { min: number; max: number } {
  let min = Infinity;
  let max = 0;
  const top = Math.min(level, BONUS_BY_LEVEL.length + 1);
  for (let l = 1; l <= top; l++) {
    const v = bonusForLevel(l).value;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min: min === Infinity ? 0 : min, max };
}

/**
 * Is this claim arithmetically possible? See the header for what "possible" is worth.
 *
 * The order matters only for the error message the player sees; every check is
 * independent.
 */
export function checkRun(claim: RunClaim): RunCheck {
  const { score, level, startLevel, ticks, grains, golden, pests, bonuses } = claim;

  if (![score, level, startLevel, ticks, grains, golden, pests, bonuses].every(isCount)) {
    return { ok: false, reason: "malformed run" };
  }
  if (level < 1 || level > MAX_LEVEL) return { ok: false, reason: "impossible level" };

  // THE DEBUG GATE, server side. The client refuses to offer submission for a
  // ?level=N run (isScoreSubmittable), and this is the other end of the same rule —
  // one guard on a cheat path is not a guard. A trace recorded from level 7 also
  // fails replay from level 1, which is the third.
  if (startLevel !== 1) return { ok: false, reason: "debug runs cannot be submitted" };

  if (score <= 0) return { ok: false, reason: "a run with no score is not a score" };

  // Reaching level L means clearing L-1 whole boards, and a board cannot be cleared
  // with a grain still on it.
  const cleared = level - 1;
  if (grains < cleared * GRAINS_PER_LEVEL || golden < cleared * POWER_PER_LEVEL) {
    return { ok: false, reason: "not enough grains eaten to have reached that level" };
  }
  if (grains > level * GRAINS_PER_LEVEL || golden > level * POWER_PER_LEVEL) {
    return { ok: false, reason: "more grains eaten than the maze holds" };
  }
  if (bonuses > level * BONUS_PER_LEVEL) {
    return { ok: false, reason: "more bonus items than could have appeared" };
  }
  // A pest is only edible inside a power window, and a window holds four of them.
  if (pests > golden * PESTS_PER_WINDOW) {
    return { ok: false, reason: "more pests eaten than the power windows allow" };
  }

  // Score against the event counts. Both bounds are exact given the counts; the
  // slack is in the counts themselves, not here.
  const { min: bonusMin, max: bonusMax } = bonusRange(level);
  const base = grains * SCORE_GRAIN + golden * SCORE_POWER;
  const lo = base + chainMin(pests) + bonuses * bonusMin;
  const hi = base + chainMax(pests) + bonuses * bonusMax;
  if (score < lo || score > hi) {
    return { ok: false, reason: "score does not match what the run says it did" };
  }

  // Duration. Every collectable costs at least a tile of travel plus its freeze.
  if (ticks < MIN_TICKS) return { ok: false, reason: "run is too short to be a run" };
  const floorTicks = Math.floor(
    DURATION_SLACK *
      ((grains + golden) * TICKS_PER_TILE +
        grains * GRAIN_FREEZE_TICKS +
        golden * POWER_FREEZE_TICKS),
  );
  if (ticks < floorTicks) {
    return { ok: false, reason: "run is too short for what it claims to have eaten" };
  }
  if (ticks > MAX_LEVEL * 60 * TICK_HZ) return { ok: false, reason: "run is impossibly long" };

  return { ok: true };
}
