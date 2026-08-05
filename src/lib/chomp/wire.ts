/**
 * RICE CHOMP leaderboard — the shapes that cross the wire.
 *
 * Types only, so it is free at runtime and safe on both sides. The route handler and
 * the board component both import from here rather than each declaring their own
 * idea of the payload: two hand-written copies of a JSON shape agree right up until
 * one of them changes.
 *
 * ISOMORPHIC AND PURE — no imports at all, deliberately. A client component pulling
 * this in must not drag `better-sqlite3` behind it.
 */

/** One row of the Top Players board. */
export interface WirePlayer {
  rank: number;
  name: string;
  score: number;
  level: number;
  /** ISO-2 country code for the flag, or null. */
  code: string | null;
}

/** One row of the Top Countries board. */
export interface WireCountry {
  rank: number;
  code: string;
  name: string | null;
  /** The country's BEST run, not the sum of its runs. See lib/chomp/db.ts. */
  score: number;
  /** Who set it. */
  best: string | null;
}

/** The submitting player's own standing, whether or not they are on the board. */
export interface WireYou {
  name: string | null;
  best: number;
  bestLevel: number;
  games: number;
  /** 1-based global rank, or 0 if they have never submitted. */
  rank: number;
  countryCode: string | null;
  countryRank: number;
  /**
   * What to prefill the name box with: their RICE CHOMP name if they have one, else
   * the name they chose on the grains board, else null. See lib/chomp/grainsName.ts.
   */
  suggestedName: string | null;
}

export interface LeaderboardResponse {
  players: WirePlayer[];
  countries: WireCountry[];
  you: WireYou | null;
  /** The country nginx attributes to THIS request, for the "you" highlight. */
  yourCode: string | null;
}

/** What POST /api/chomp/score answers with on success. */
export interface SubmitResponse {
  ok: true;
  runId: number;
  best: number;
  improved: boolean;
  rank: number;
  countryRank: number;
  /** True when this exact run was already stored; the call changed nothing. */
  duplicate: boolean;
}

/** The body of a submission. Every field is re-checked server-side. */
export interface SubmitBody {
  name: string;
  score: number;
  level: number;
  startLevel: number;
  ticks: number;
  grains: number;
  golden: number;
  pests: number;
  bonuses: number;
  seed: number;
  /** The compressed input trace. See lib/chomp/trace.ts. */
  trace: string;
}
