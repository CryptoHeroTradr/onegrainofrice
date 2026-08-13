/**
 * TETRICE — the shapes on the wire, shared by the routes and the client.
 *
 * Types only, no runtime, no imports from either side's internals. Kept in step with
 * `src/lib/grainsnake/wire.ts`'s shape so the two boards read the same way.
 *
 * **THERE IS NO `score` FIELD IN `SubmitBody`, AND THAT IS THE ANTI-FORGERY POSITION.**
 * Not "the server checks the score" — there is nothing to check, because there is nothing
 * to send. The score comes out of the replay or the submission is refused.
 */

export interface StartResponse {
  runId: string;
  /** THE SERVER'S SEED. The client cannot choose or influence it (spec, *The randomizer*). */
  seed: number;
  issuedAt: number;
  engineVersion: number;
}

/** `[frame, actionBitmask]` — the format from `client/inputLog.ts`, unchanged. */
export type WireLogEntry = readonly [number, number];

export interface WireRunLog {
  seed: number;
  engineVersion: number;
  ticks: number;
  entries: readonly WireLogEntry[];
}

export interface SubmitBody {
  runId: string;
  engineVersion: number;
  inputLog: WireRunLog;
  name: string;
}

export interface SubmitResponse {
  ok: true;
  /** Computed by the server's replay. The client sent no number to compare it against. */
  score: number;
  level: number;
  lines: number;
  durationMs: number;
  best: number;
  improved: boolean;
  rank: number;
  duplicate: boolean;
}

export interface BoardRow {
  rank: number;
  name: string;
  /** ISO-2, for `flagEmoji()`. Attributed on the WRITE, never from the reader's headers. */
  code: string | null;
  score: number;
  level: number;
  lines: number;
  engineVersion: number | null;
}

export interface LeaderboardResponse {
  players: BoardRow[];
  you: {
    name: string | null;
    best: number;
    bestLevel: number;
    bestLines: number;
    games: number;
    rank: number;
  } | null;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}
