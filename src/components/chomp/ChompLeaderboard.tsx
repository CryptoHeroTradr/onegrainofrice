"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { flagEmoji } from "@/lib/grains/flag";
import type { LeaderboardResponse } from "@/lib/chomp/wire";
import { fetchBoard } from "./leaderboard";
import { bestScore } from "./scores";

/**
 * RICE CHOMP's board. ONE board: the top 50 players, ranked by best single run.
 *
 * There were two — top players and top countries, mirroring the grains game — until
 * 2026-08-05. The country board is gone and the flag is a COLUMN of this one, beside
 * the name, drawn from the GeoIP attributed to the run when it was submitted. A
 * player's country is a fact about them worth showing; it was not worth a second
 * board, a second query and a tab to hunt through.
 *
 * ── WHAT IS REUSED, AND WHAT IS DELIBERATELY NOT ────────────────────────────────
 * The grains game already has boards like this, and the brief is to reuse its
 * components and patterns rather than build parallel ones — but not its data. What
 * that came to in practice:
 *
 *  - REUSED VERBATIM: `flagEmoji` from `@/lib/grains/flag`, which is the whole of the
 *    flag treatment on both games — same helper, same ISO-2 → regional-indicator
 *    mapping, same globe for a code it does not recognise. A player whose GeoIP missed
 *    gets the globe and keeps their rank: the score is the real thing here, and unlike
 *    the country board this replaced, an unknown code is not a reason to leave a row
 *    out. The flag is `aria-hidden` — a decoration beside a name, not a label of it.
 *  - REUSED AS A PATTERN: the row shape (rank · flag · name · number), the "you"
 *    highlight, and the empty state that tells a first player what to do.
 *  - NOT REUSED: the components themselves, and `AnimatedNumber`. The grains boards
 *    are cream panels (`bg-bone`, `text-olive-deep`) built for a light page; this one
 *    sits on a black arcade cabinet, and rendering one inside the other would look
 *    exactly like what it was. `AnimatedNumber` tweens a number toward a new value,
 *    which is right for a counter that ticks up live and pointless for a board that
 *    is fetched whole on open — it would animate every row from zero on every fetch.
 *    Generalising the grains components to carry a palette would mean re-testing a
 *    shipped game's UI to save duplicating forty lines of list markup. Not worth it.
 *  - NOT REUSED, AND THIS IS THE POINT: the data. Separate database, separate
 *    routes, separate scores. The two games share an identity cookie and nothing else.
 *
 * ── IT COSTS THE SIMULATION NOTHING ─────────────────────────────────────────────
 * Fetching, rendering and scrolling this happen entirely on the host side. No engine
 * module imports it, it consumes no ticks, and it adds nothing to the input trace —
 * the same line the cutscenes, the audio and the pit video sit behind, asserted in
 * `test/chomp-audio.test.ts`. On a phone it is the HOST that pauses the run while the
 * overlay is up (see ChompScreen); pausing is "stop calling tick()", which the engine
 * cannot observe either.
 */

/**
 * `docked` is the desktop panel beside the board; `overlay` covers the board on a
 * tablet or a phone. Which one is used is decided by CSS, not by this component —
 * see ChompScreen, where both are rendered and the breakpoint picks one.
 */
export type BoardVariant = "docked" | "overlay";

const ROW = "flex items-center gap-2 px-2 py-1.5 font-mono text-chomp-body tabular-nums";
const YOU_ROW = "bg-khaki/15 ring-1 ring-khaki/40";

function Rank({ n }: { n: number }) {
  return (
    <span className="w-8 shrink-0 text-right text-chomp-note text-steamed/35">
      {n > 0 ? `#${n}` : "·"}
    </span>
  );
}

export function ChompLeaderboard({
  onClose,
  variant,
}: {
  onClose: () => void;
  variant: BoardVariant;
}) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * The local top score — the only board a first-time player is ever on, and the one
   * thing this panel can still say when the network cannot.
   *
   * Read as a LAZY INITIAL VALUE rather than in an effect. The panel is mounted fresh
   * every time it opens and localStorage is synchronous, so there is nothing to
   * synchronise and an effect would only buy a second render.
   */
  const [local] = useState(bestScore);
  /**
   * Refresh is a COUNTER, not a function that fetches.
   *
   * The obvious shape — a `load()` callback called from the effect and from the
   * button — sets state synchronously inside the effect body, which is the cascading
   * render React now warns about. Bumping a nonce instead means the effect is the
   * only thing that fetches, the button is an ordinary event handler, and the only
   * setState the effect performs is in a promise callback where it belongs.
   */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    fetchBoard(ac.signal)
      .then((d) => {
        if (ac.signal.aborted) return;
        setData(d);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        // A board that will not load must never take the game with it. The panel
        // says so and offers to try again; the run behind it is untouched.
        setError("Board unavailable.");
        setLoading(false);
      });
    return () => ac.abort();
  }, [nonce]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  const you = data?.you ?? null;
  const rows = data?.players ?? [];

  const body = (
    <>
      {/* --- header ------------------------------------------------------- */}
      <div className="flex items-center gap-2 border-b border-steamed/10 px-3 py-2">
        <h2 className="font-mono text-chomp-micro tracking-[0.18em] text-steamed/45 uppercase">
          Leaderboard
        </h2>
        <button
          type="button"
          onClick={reload}
          aria-label="Refresh the leaderboard"
          className="ml-auto flex min-h-8 min-w-8 items-center justify-center border border-steamed/20 text-steamed/50 transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
        >
          <RefreshCw size={13} aria-hidden="true" className={loading ? "animate-spin" : ""} />
        </button>
        <button
          type="button"
          onClick={onClose}
          // Autofocused in the overlay only: it is a dialog over the board and a
          // keyboard player needs a way out of it. The docked panel is not modal —
          // stealing focus from a live game to a side panel would be worse than
          // useless, and the game is still running behind it.
          autoFocus={variant === "overlay"}
          aria-label="Close the leaderboard"
          className="flex min-h-8 min-w-8 items-center justify-center border border-steamed/20 text-steamed/50 transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {/* --- rows --------------------------------------------------------- */}
      <div translate="no" className="notranslate min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="px-4 py-8 text-center">
            <p className="font-mono text-chomp-body text-steamed/50">{error}</p>
            <button
              type="button"
              onClick={reload}
              className="mt-3 min-h-9 border border-steamed/25 px-4 font-mono text-chomp-chip tracking-[0.15em] text-steamed/70 uppercase transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
            >
              Try again
            </button>
          </div>
        ) : loading && !data ? (
          <p className="px-4 py-8 text-center font-mono text-chomp-body text-steamed/35">
            Reading the paddy…
          </p>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="font-mono text-chomp-body text-steamed/50">
              Nobody has cleared a paddy yet.
            </p>
            <p className="mt-1 font-mono text-chomp-note text-steamed/30">Go first.</p>
          </div>
        ) : (
          <ol>
            {rows.map((p) => {
              // Matched on RANK rather than on name: names are not unique, and the
              // server is the only thing that knows which row is this player's.
              const isYou = !!you && you.rank > 0 && you.rank === p.rank;
              return (
                <li key={p.rank} className={`${ROW} ${isYou ? YOU_ROW : ""}`}>
                  <Rank n={p.rank} />
                  <span className="text-base leading-none" aria-hidden="true">
                    {flagEmoji(p.code ?? "")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-steamed" title={p.name}>
                    {p.name}
                    {isYou && (
                      <span className="ml-1.5 text-chomp-note text-khaki uppercase">you</span>
                    )}
                  </span>
                  <span className="w-10 shrink-0 text-right text-chomp-note text-steamed/30">
                    L{p.level}
                  </span>
                  <span className="shrink-0 text-khaki">{p.score.toLocaleString()}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* --- your standing ------------------------------------------------ */}
      {/* Always shown, even at rank 0: "you are not on this board yet" is the most
          useful thing it can say to the player most likely to be reading it. The
          local best comes from localStorage and needs no network at all, so this
          strip still says something true when the board itself is down. */}
      <div
        translate="no"
        className="notranslate border-t border-steamed/10 px-3 py-2 font-mono text-chomp-note text-steamed/45"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="tracking-[0.18em] uppercase">This device</span>
          <span className="tabular-nums text-steamed/70">{local.toLocaleString()}</span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-3">
          <span className="tracking-[0.18em] uppercase">On the board</span>
          <span className="tabular-nums text-steamed/70">
            {you && you.rank > 0
              ? `#${you.rank} · ${you.best.toLocaleString()}`
              : "not yet"}
          </span>
        </div>
      </div>
    </>
  );

  if (variant === "docked") {
    return (
      <aside
        aria-label="RICE CHOMP leaderboard"
        className="flex h-full min-h-0 flex-col border border-steamed/15 bg-nori"
      >
        {body}
      </aside>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="RICE CHOMP leaderboard"
      // ESCAPE CLOSES IT, AND STOPS THERE. The window-level key handler in
      // ChompCanvas also listens for Escape (it toggles pause), and this overlay is
      // inside its bubble path — so without stopPropagation, closing the board would
      // also flip the pause the host had just set for us, and the player would come
      // back to a running game they cannot see. Only Escape is stopped: the steering
      // keys must keep reaching the window handler at all times, which is the rule
      // the spec sets out under Controls.
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
      className="absolute inset-0 flex flex-col bg-nori/95"
    >
      {body}
    </div>
  );
}
