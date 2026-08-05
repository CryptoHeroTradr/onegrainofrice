/**
 * GET /api/chomp/leaderboard — both boards, plus this player's own row.
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
 * Country attribution reuses nginx's existing GeoIP headers verbatim — the
 * `X-Country-Code` / `X-Country-Name` pair is already injected on the `location /`
 * block that proxies this route. No nginx change, which is just as well: nginx needs
 * sudo and there is none here.
 */

import { getTopCountries, getTopPlayers, getYou } from "@/lib/chomp/db";
import { grainsDisplayName } from "@/lib/chomp/grainsName";
import type { LeaderboardResponse } from "@/lib/chomp/wire";
import { readVidFromCookieHeader } from "@/lib/grains/cookie";
import { isUnknownCountry } from "@/lib/grains/flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The spec's ask: global top 100, per-country top 100. */
const BOARD_LIMIT = 100;

export function GET(req: Request): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });

  const vid = readVidFromCookieHeader(req.headers.get("cookie"));
  const yourCode = req.headers.get("x-country-code")?.trim() || null;

  try {
    const players = getTopPlayers(BOARD_LIMIT).map((p, i) => ({
      rank: i + 1,
      name: p.name ?? "—",
      score: p.best_score,
      level: p.best_level,
      code: p.country_code,
    }));
    // Filter BEFORE ranking, so the numbering has no gaps — the same rule and the
    // same predicate the grains country board uses. A GeoIP miss is not a country.
    const countries = getTopCountries(BOARD_LIMIT + 1)
      .filter((c) => !isUnknownCountry({ code: c.code, name: c.name }))
      .slice(0, BOARD_LIMIT)
      .map((c, i) => ({
        rank: i + 1,
        code: c.code,
        name: c.name,
        score: c.best_score,
        best: c.best_name,
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
        countryCode: yourCode,
        countryRank: 0,
        suggestedName: grainsDisplayName(vid),
      };
    }

    const body: LeaderboardResponse = { players, countries, you, yourCode };
    return new Response(JSON.stringify(body), { headers });
  } catch (err) {
    // A leaderboard that cannot load must not take the game down with it. The screen
    // shows an "unavailable" state and the run is still playable.
    console.error("[chomp] leaderboard read failed", err);
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers });
  }
}
