"use client";

import { useEffect, useState } from "react";
import { ENGINE_RULE_LABELS, ENGINE_VERSION } from "@/lib/grainsnake/rules";
import type { LeaderboardResponse } from "@/lib/grainsnake/wire";
import { fetchBoard } from "./board";

/**
 * The board: one panel, top 50 by best single run.
 *
 * ── FOUR COLUMNS, AND THE THIRD ONE IS THE ARGUMENT ─────────────────────────────
 * Rank, name, score, LENGTH, GOLDENS. The spec's *Scoring* is explicit: the base score
 * is a strictly increasing function of length, so sorting by it is sorting by length
 * with extra steps. Goldens are the only quantity a player controls independently of
 * how long they survived — the board's only real second axis — so they get a column
 * rather than being folded invisibly into the total.
 *
 * `filled` is a mark, not a number. Nobody has filled the board; when somebody does it
 * should be recognisable rather than merely a large score.
 */

const HEAD = "font-mono text-[0.6rem] uppercase tracking-[0.14em] text-steamed/40";
const CELL = "font-mono text-xs tabular-nums text-steamed/80";

/**
 * ── THE VERSION MARKER ──────────────────────────────────────────────────────────
 * *Added 2026-08-08, when the board started wrapping and `ENGINE_VERSION` went to 2.*
 * The spec's deferred escape hatch, taken: the board holds rows from several engine
 * versions at once and a row has to be able to say which rules it was played under.
 *
 * Four rules, and each of them is a decision rather than an implementation detail:
 *
 * 1. **Marked off `version !== ENGINE_VERSION`, NEVER off a literal.** "Old" is
 *    relative to what this build implements. A `=== 1` test is correct exactly once
 *    and then silently stops marking anything the day version 3 ships — the failure
 *    would be invisible, which is the worst kind.
 * 2. **The default view is EVERY row, marked. It is not filtered.** Filtering to the
 *    current version would show an empty board on the day the version changes, and an
 *    empty board reads as broken rather than as new.
 * 3. **The label says what rules they played under — "walled rules" — not that the row
 *    is doubtful.** Those runs were verified when they were submitted and their scores
 *    are final. The marker is a fact about the rules, not a caveat about the player.
 * 4. **Nothing here recomputes, migrates, or changes a row.** This is presentation over
 *    data that was already stored correctly, which is the entire reason
 *    `engine_version` has been on the row since day one.
 */
function ruleLabel(version: number | null): string | null {
  if (version === null || version === ENGINE_VERSION) return null;
  // A version with no phrase recorded beside the constant still gets marked — knowing
  // the rules differed is the useful part, and naming them is the bonus.
  return ENGINE_RULE_LABELS[version] ?? `version ${version} rules`;
}

/** ISO-2 → flag emoji. Pure arithmetic on code points; no image, no request. */
function flagOf(code: string | null): string {
  if (!code || code.length !== 2) return "";
  const A = 0x1f1e6;
  const a = code.toUpperCase().charCodeAt(0) - 65;
  const b = code.toUpperCase().charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return "";
  return String.fromCodePoint(A + a, A + b);
}

export function Leaderboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let live = true;
    // No `setState("loading")` here. The initial state is already "loading", and on a
    // REFRESH the previous board stays on screen until the new one arrives — which is
    // both better to look at than a flash of "Loading…" and one fewer render.
    fetchBoard().then((d) => {
      if (!live) return;
      if (!d) {
        setState("error");
        return;
      }
      setData(d);
      setState("ready");
    });
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (state === "loading") {
    return <p className="py-6 text-center font-mono text-xs text-steamed/40">Loading the board…</p>;
  }
  if (state === "error") {
    // A board that cannot load must not take the game down with it.
    return (
      <p className="py-6 text-center font-mono text-xs text-steamed/40">
        The board is unavailable. The game still works.
      </p>
    );
  }

  const players = data?.players ?? [];
  const you = data?.you ?? null;

  return (
    <div className="w-full">
      {players.length === 0 ? (
        <p className="py-6 text-center font-mono text-xs text-steamed/50">
          Nobody has submitted a run yet. Be first.
        </p>
      ) : (
        <div className="max-h-[46vh] overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-nori">
              <tr className="text-left">
                <th className={`${HEAD} py-1 pr-2`}>#</th>
                <th className={`${HEAD} py-1 pr-2`}>Name</th>
                <th className={`${HEAD} py-1 pr-2 text-right`}>Score</th>
                <th className={`${HEAD} py-1 pr-2 text-right`}>Len</th>
                <th className={`${HEAD} py-1 text-right`}>Gold</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const rules = ruleLabel(p.engineVersion);
                return (
                <tr key={`${p.rank}-${p.name}`} className="border-t border-steamed/10">
                  <td className={`${CELL} py-1 pr-2 text-steamed/40`}>{p.rank}</td>
                  <td className={`${CELL} py-1 pr-2 text-steamed`}>
                    <span aria-hidden="true">{flagOf(p.code)}</span> {p.name}
                    {p.filled && (
                      <span className="ml-1 text-salmon" title="Filled the board">
                        ★
                      </span>
                    )}
                    {rules && (
                      // Set in the row, not as a tooltip: a mark you have to hover to
                      // read is a mark a phone cannot read at all.
                      <span
                        className="ml-1.5 border border-steamed/25 px-1 align-middle text-[0.6rem] tracking-[0.08em] text-steamed/45 uppercase"
                        title={`Played under the ${rules} — score unchanged`}
                      >
                        {rules}
                      </span>
                    )}
                  </td>
                  <td className={`${CELL} py-1 pr-2 text-right`}>{p.score.toLocaleString()}</td>
                  <td className={`${CELL} py-1 pr-2 text-right`}>{p.length}</td>
                  <td className={`${CELL} py-1 text-right text-salmon`}>{p.goldens}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {you && you.games > 0 && (
        <p className="mt-3 border-t border-steamed/10 pt-2 font-mono text-[0.7rem] text-steamed/50">
          You: rank {you.rank} · {you.best.toLocaleString()} pts · length {you.bestLength} ·{" "}
          {you.bestGoldens} golden · {you.games} run{you.games === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
