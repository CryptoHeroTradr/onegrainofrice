/**
 * GET /api/grainsnake/leaderboard — the board, plus this player's own row.
 *
 * HTTP, not a WebSocket, for the same three reasons chomp's is: a score is one
 * discrete event per run rather than a stream; a second WS path would need an nginx
 * `location` block and therefore sudo; and joining the grains socket would put another
 * full leaderboard on the wire every 250 ms while the player is trying to hold 60 fps.
 * This costs nothing when nobody is looking at it.
 *
 * `no-store`: a leaderboard is the one thing on this site that must not be a minute
 * stale, and the page fetches it on open and after a submit rather than on a timer.
 *
 * THIS ROUTE READS NO GEOIP HEADER. Country attribution happens once, on the WRITE.
 * Reading the header here would describe whoever is LOOKING at the board rather than
 * whoever set the score.
 */

import { getTopPlayers, getYou } from "@/lib/grainsnake/db";
import type { LeaderboardResponse } from "@/lib/grainsnake/wire";
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
      score: p.best_score,
      length: p.best_length,
      goldens: p.best_goldens,
      code: p.country_code,
      filled: p.filled === 1,
      engineVersion: p.best_engine_version,
    }));

    const row = vid ? getYou(vid) : null;
    const you: LeaderboardResponse["you"] = row
      ? {
          name: row.name,
          best: row.best,
          bestLength: row.bestLength,
          bestGoldens: row.bestGoldens,
          games: row.games,
          rank: row.rank,
        }
      : vid
        ? { name: null, best: 0, bestLength: 0, bestGoldens: 0, games: 0, rank: 0 }
        : null;

    const body: LeaderboardResponse = { players, you };
    return new Response(JSON.stringify(body), { headers });
  } catch (err) {
    // A leaderboard that cannot load must not take the game down with it. The screen
    // shows an "unavailable" state and the run is still playable.
    console.error("[grainsnake] leaderboard read failed", err);
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers });
  }
}
