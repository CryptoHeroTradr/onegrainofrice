/**
 * GET /api/tetrice/leaderboard — the board, plus this player's own row.
 *
 * ONE board, top 50, by best single run, carrying score, level and lines (spec,
 * *Leaderboard*). HTTP, not a WebSocket: a score is one discrete event per run.
 *
 * `no-store`: a leaderboard is the one thing on this site that must not be a minute stale,
 * and the page fetches it on open and after a submit rather than on a timer.
 *
 * THIS ROUTE READS NO GEOIP HEADER. Country attribution happens once, on the WRITE.
 * Reading the header here would describe whoever is LOOKING at the board rather than
 * whoever set the score.
 */

import { getTopPlayers, getYou } from "@/lib/tetrice/db";
import type { LeaderboardResponse } from "@/lib/tetrice/wire";
import { readVidFromCookieHeader } from "@/lib/grains/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ONE board, the top 50 players by best single run. Only a LIMIT — see db.ts. */
const BOARD_LIMIT = 50;

export function GET(req: Request): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });

  const vid = readVidFromCookieHeader(req.headers.get("cookie"));

  try {
    const players = getTopPlayers(BOARD_LIMIT).map((p, i) => ({
      rank: i + 1,
      name: p.name ?? "—",
      code: p.country_code,
      score: p.best_score,
      level: p.best_level,
      lines: p.best_lines,
      engineVersion: p.best_engine_version,
    }));

    const row = vid ? getYou(vid) : null;
    const you: LeaderboardResponse["you"] = row
      ? {
          name: row.name,
          best: row.best,
          bestLevel: row.bestLevel,
          bestLines: row.bestLines,
          games: row.games,
          rank: row.rank,
        }
      : vid
        ? { name: null, best: 0, bestLevel: 0, bestLines: 0, games: 0, rank: 0 }
        : null;

    const body: LeaderboardResponse = { players, you };
    return new Response(JSON.stringify(body), { headers });
  } catch (err) {
    // A leaderboard that cannot load must not take the game down with it. The screen shows
    // an "unavailable" state and the run is still playable.
    console.error("[tetrice] leaderboard read failed", err);
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers });
  }
}
