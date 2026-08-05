"use client";

import { useEffect, useRef, useState } from "react";
import { NAME_MAX_LEN, checkName } from "@/lib/chomp/score";
import { fetchBoards, submitScore, type RunSummary } from "./leaderboard";

/**
 * Name entry and submission, on the game-over card.
 *
 * The spec's flow is "game over → name entry → submission → leaderboard", and the
 * order matters: the score is on screen and read BEFORE anything asks the player to
 * type. This block sits under it and never takes the card over.
 *
 * ── THE NAME ────────────────────────────────────────────────────────────────────
 * A name is entered PER SUBMISSION rather than owned by the account, because there
 * is no account — there is a cookie. Three things fill the box, in order:
 *
 *   1. the name this device used last time (`chomp:name` in localStorage — no
 *      network, so it is already in the box before the fetch below returns);
 *   2. failing that, whatever the server suggests: this player's previous RICE CHOMP
 *      name, or the name they chose on the GRAINS board, which is the spec's ask and
 *      the only reason the leaderboard reads grains.db at all (read-only — see
 *      lib/chomp/grainsName.ts);
 *   3. failing that, nothing, and the player types one.
 *
 * The rules — 3–12 characters, sanitized, profanity-filtered — live in
 * `@/lib/chomp/score` and are enforced on the SERVER. They are checked here too, so
 * the player learns the name is too short while typing instead of after a round
 * trip. One implementation, imported by both; a client-side copy of a server rule is
 * a rule that drifts.
 *
 * ── DEBUG RUNS NEVER GET HERE ───────────────────────────────────────────────────
 * The card does not render this block at all when `run.submittable` is false, and
 * the server rejects `startLevel !== 1` regardless, and a level-7 trace fails replay
 * from level 1. Three independent stops.
 */

const NAME_KEY = "chomp:name";

function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage blocked — they will type it again next time */
  }
}

function recallName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

type Stage = "entry" | "sending" | "done";

export function ChompSubmit({ run, onOpenBoard }: { run: RunSummary; onOpenBoard: () => void }) {
  // The remembered name is a LAZY INITIAL VALUE, so it is in the box on the first
  // paint rather than one render later. Only the server's suggestion — which arrives
  // over the network — is allowed to set state, and only if the player has neither a
  // remembered name nor started typing.
  const [name, setName] = useState(recallName);
  const [stage, setStage] = useState<Stage>("entry");
  const [error, setError] = useState<string | null>(null);
  const [rank, setRank] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set once the player types, so a late server suggestion cannot overwrite them. */
  const touchedRef = useRef(false);

  useEffect(() => {
    const hadStored = recallName() !== "";

    // The server's suggestion is a nice-to-have on a screen that is already useful,
    // so it is fetched without blocking anything and dropped on any failure.
    const ac = new AbortController();
    fetchBoards(ac.signal)
      .then((d) => {
        const suggested = d.you?.suggestedName;
        if (!ac.signal.aborted && suggested && !touchedRef.current && !hadStored) {
          setName(suggested);
        }
      })
      .catch(() => {
        /* no suggestion; the box is still usable */
      });
    return () => ac.abort();
  }, []);

  const verdict = checkName(name);

  const send = async () => {
    if (!verdict.ok) {
      setError(verdict.reason);
      inputRef.current?.focus();
      return;
    }
    setStage("sending");
    setError(null);
    const outcome = await submitScore(verdict.name, run);
    if (!outcome.ok) {
      setError(outcome.error);
      setStage("entry");
      return;
    }
    rememberName(verdict.name);
    setRank(outcome.result.rank);
    setStage("done");
  };

  if (stage === "done") {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="font-mono text-chomp-body tracking-[0.15em] text-khaki uppercase">
          {rank > 0 ? `Filed at #${rank} in the world` : "Filed"}
        </p>
        <button
          type="button"
          onClick={onOpenBoard}
          className="min-h-9 border border-steamed/25 px-4 font-mono text-chomp-chip tracking-[0.15em] text-steamed/70 uppercase transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
        >
          See the board
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="flex w-full max-w-xs flex-col items-center gap-2"
    >
      <label
        htmlFor="chomp-name"
        className="font-mono text-chomp-micro tracking-[0.18em] text-steamed/40 uppercase"
      >
        Put it on the board
      </label>
      <div className="flex w-full items-stretch gap-2">
        <input
          id="chomp-name"
          ref={inputRef}
          value={name}
          onChange={(e) => {
            touchedRef.current = true;
            setName(e.target.value);
            setError(null);
          }}
          maxLength={NAME_MAX_LEN}
          placeholder="your name"
          autoComplete="off"
          spellCheck={false}
          disabled={stage === "sending"}
          className="min-h-11 min-w-0 flex-1 border border-steamed/25 bg-transparent px-3 font-mono text-chomp-lead text-steamed placeholder:text-steamed/25 focus:border-khaki focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={stage === "sending"}
          className="min-h-11 shrink-0 border-2 border-khaki px-4 font-mono text-chomp-lead tracking-[0.15em] text-khaki uppercase transition-colors hover:bg-khaki hover:text-nori focus-visible:bg-khaki focus-visible:text-nori focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steamed disabled:opacity-40"
        >
          {stage === "sending" ? "…" : "Submit"}
        </button>
      </div>
      {error && (
        <p role="alert" className="font-mono text-chomp-note text-salmon">
          {error}
        </p>
      )}
    </form>
  );
}
