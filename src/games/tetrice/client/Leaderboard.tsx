"use client";

/**
 * TETRICE — the board, and the card that submits to it.
 *
 * Presentation only. It holds no rule: the name is checked here for the player's benefit
 * with the SAME `checkName` the route runs (`@/lib/chomp/score` — pure text helpers, no
 * database, shared rather than duplicated), and the route checks it again whatever this
 * component did, because a client-side check is a courtesy and never a guarantee.
 *
 * The flag comes from `flagEmoji()`, the same helper the grains and chomp boards use, over
 * the country stored on the WRITE.
 */

import { useEffect, useState } from "react";
import { NAME_MAX_LEN, NAME_MIN_LEN, checkName } from "@/lib/chomp/score";
import { flagEmoji } from "@/lib/grains/flag";
import type { LeaderboardResponse } from "@/lib/tetrice/wire";
import { fetchLeaderboard } from "./leaderboard";

export function TetriceBoard({ refreshKey }: { refreshKey: number }) {
  // ONE state, set only from the fetch callback. A synchronous `setState` in the effect
  // body would be a cascading render, and it would also blank the board on every refresh —
  // this way the previous rows stay up until the new ones arrive.
  const [view, setView] = useState<
    { status: "loading" } | { status: "ok"; board: LeaderboardResponse } | { status: "failed" }
  >({ status: "loading" });

  useEffect(() => {
    let live = true;
    fetchLeaderboard().then((b) => {
      if (!live) return;
      setView(b ? { status: "ok", board: b } : { status: "failed" });
    });
    return () => {
      live = false;
    };
  }, [refreshKey]);

  const failed = view.status === "failed";
  const board = view.status === "ok" ? view.board : null;

  if (failed) {
    return <p className="font-mono text-[11px] opacity-60">Board unavailable — the run still counts locally.</p>;
  }
  if (!board) {
    return <p className="font-mono text-[11px] opacity-60">Loading the board…</p>;
  }
  if (board.players.length === 0) {
    return <p className="font-mono text-[11px] opacity-60">No runs yet. The board starts with yours.</p>;
  }

  return (
    <div className="max-h-64 overflow-y-auto">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead className="sticky top-0 bg-nori">
          <tr className="text-left opacity-50">
            <th className="py-1 pr-2 font-normal">#</th>
            <th className="py-1 pr-2 font-normal">Name</th>
            <th className="py-1 pr-2 text-right font-normal">Score</th>
            <th className="py-1 pr-2 text-right font-normal">Lvl</th>
            <th className="py-1 text-right font-normal">Lines</th>
          </tr>
        </thead>
        <tbody>
          {board.players.map((p) => (
            <tr key={`${p.rank}-${p.name}`} className="border-t border-khaki/15">
              <td className="py-1 pr-2 tabular-nums opacity-60">{p.rank}</td>
              <td className="py-1 pr-2">
                <span aria-hidden="true">{flagEmoji(p.code ?? "")}</span> {p.name}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">{p.score.toLocaleString()}</td>
              <td className="py-1 pr-2 text-right tabular-nums opacity-70">{p.level}</td>
              <td className="py-1 text-right tabular-nums opacity-70">{p.lines}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {board.you && board.you.games > 0 && (
        <p className="mt-2 font-mono text-[11px] opacity-60">
          You: best {board.you.best.toLocaleString()} · rank {board.you.rank || "—"} ·{" "}
          {board.you.games} run{board.you.games === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

/** The name field. Its only job is to say why a name will be refused before it is sent. */
export function NameField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const verdict = checkName(value);
  const complaint = value.length > 0 && !verdict.ok ? verdict.reason : null;
  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        value={value}
        disabled={disabled}
        maxLength={NAME_MAX_LEN}
        minLength={NAME_MIN_LEN}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Name (${NAME_MIN_LEN}–${NAME_MAX_LEN})`}
        aria-label="Your name for the leaderboard"
        className="w-full border border-khaki/40 bg-transparent px-2 py-1 font-mono text-sm text-paper placeholder:opacity-40"
      />
      {complaint && <span className="font-mono text-[11px] text-tuna">{complaint}</span>}
    </div>
  );
}
