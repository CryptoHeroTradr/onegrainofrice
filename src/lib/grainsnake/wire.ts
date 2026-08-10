/**
 * GRAINSNAKE leaderboard — the shapes that cross the wire.
 *
 * Types only, so it is free at runtime and safe on both sides. The route handlers and
 * the board component import from here rather than each declaring their own idea of
 * the payload: two hand-written copies of a JSON shape agree right up until one of
 * them changes.
 *
 * ISOMORPHIC AND PURE — imports only from `./types`, deliberately. A client component
 * pulling this in must not drag `better-sqlite3` behind it.
 *
 * ── NOTHING HERE IS TIME-TYPED ──────────────────────────────────────────────────
 * No timestamp, no duration, no elapsed-ms in either direction of a submission. The
 * host's accumulator clamp drops wall-clock the replayer never sees, so a
 * client-measured duration is a different quantity from the tick count rather than a
 * second view of it. Duration is DERIVED server-side as `ticks * 1000 / 60`.
 */

import type { InputEvent } from "./types";

/** One row of the board. */
export interface WirePlayer {
  rank: number;
  name: string;
  score: number;
  length: number;
  /** Its own number, never folded into the score. See the spec's *Scoring*. */
  goldens: number;
  /** ISO-2 country code for the flag beside the name, or null. */
  code: string | null;
  /** True once this player has ever filled the board. */
  filled: boolean;
  /**
   * The `ENGINE_VERSION` this player's best run was played under, or null when it is
   * not known.
   *
   * DISPLAY ONLY. The board marks a row whose version differs from the one this build
   * implements — never a row equal to some literal, because "old" is relative to today
   * and hardcoding `=== 1` means the marker silently stops working at version 3. The
   * score is untouched by this in every sense: nothing recomputes, nothing migrates,
   * and the row is not in doubt. It says which rules were in force, and that is all.
   */
  engineVersion: number | null;
}

/** The submitting player's own standing, whether or not they are on the board. */
export interface WireYou {
  name: string | null;
  best: number;
  bestLength: number;
  bestGoldens: number;
  games: number;
  /** 1-based global rank, or 0 if they have never submitted. */
  rank: number;
}

export interface LeaderboardResponse {
  players: WirePlayer[];
  you: WireYou | null;
}

/** What POST /api/grainsnake/score answers with on success. */
export interface SubmitResponse {
  ok: true;
  runId: number;
  /** The VERIFIED score — what the replay computed and what was stored. */
  score: number;
  best: number;
  improved: boolean;
  rank: number;
  /** True when this exact run was already stored; the call changed nothing. */
  duplicate: boolean;
}

/**
 * The body of a submission.
 *
 * **THERE IS NO `score` FIELD, AND THAT IS THE DESIGN.** The server re-simulates
 * `(seed, inputs, ticks)` with the same step function the browser ran and computes the
 * score itself; a client-supplied score would be a number with nothing to check it
 * against and no reason to exist. What cannot be forged cannot be validated — it can
 * only be recomputed.
 */
export interface SubmitBody {
  name: string;
  seed: number;
  /** The recorded input log: (tick, dir) pairs, strictly ascending by tick. */
  inputs: InputEvent[];
  /** Ticks the run lasted. The authoritative clock, and the only one. */
  ticks: number;
  /** The rules the run was played under. Refused, never rescored, on mismatch. */
  engineVersion: number;
}
