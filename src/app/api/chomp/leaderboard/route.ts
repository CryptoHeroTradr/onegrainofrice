/**
 * GET /api/chomp/leaderboard — the board, plus this player's own row.
 *
 * HTTP, not a WebSocket, and that is the phase's central decision (plan §6). A score
 * is one discrete event per run rather than a stream; a second WS path would need an
 * nginx `location` block and therefore sudo; and joining the grains socket would put
 * two full leaderboards on the wire every 250 ms while the player is trying to hold
 * 60 fps. This costs nothing when nobody is looking at it.
 *
 * `no-store`: a leaderboard is the one thing on this site that must not be a minute
 * stale, and the page fetches it on open and after a submit rather than on a timer,
 * so there is nothing to amortise.
 *
 * THIS ROUTE READS NO GEOIP HEADER. Country attribution happens once, on the write —
 * `POST /api/chomp/score` takes nginx's `X-Country-Code` / `X-Country-Name` off the
 * submission and stores them, and this route serves the code back as the flag beside
 * the name. Reading the header here would describe whoever is LOOKING at the board
 * rather than whoever set the score, and with the country board gone there is nothing
 * left for it to say.
 */

import { getTopPlayers, getYou } from "@/lib/chomp/db";
import { grainsDisplayName } from "@/lib/chomp/grainsName";
import type { LeaderboardResponse } from "@/lib/chomp/wire";
import { readVidFromCookieHeader } from "@/lib/grains/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The spec's ask: ONE board, the top 50 players by best single run.
 *
 * It is only a LIMIT. `getTopPlayers()` is one indexed read with no filter and no
 * post-processing, so this number is the row count and changing it changes nothing
 * else — which was not true of the country board it replaced, where a GeoIP miss had
 * to be filtered out before ranking and the query therefore over-fetched by one.
 */
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
      level: p.best_level,
      code: p.country_code,
    }));

    const row = vid ? getYou(vid) : null;
    let you: LeaderboardResponse["you"] = null;
    if (vid && row) {
      you = { ...row, suggestedName: row.name ?? grainsDisplayName(vid) };
    } else if (vid) {
      // Never submitted here, but they may already have a name on the grains board —
      // which is the whole point of the prefill.
      you = {
        name: null,
        best: 0,
        bestLevel: 0,
        games: 0,
        rank: 0,
        suggestedName: grainsDisplayName(vid),
      };
    }

    const body: LeaderboardResponse = { players, you };
    return new Response(JSON.stringify(body), { headers });
  } catch (err) {
    // A leaderboard that cannot load must not take the game down with it. The screen
    // shows an "unavailable" state and the run is still playable.
    console.error("[chomp] leaderboard read failed", err);
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers });
  }
}
