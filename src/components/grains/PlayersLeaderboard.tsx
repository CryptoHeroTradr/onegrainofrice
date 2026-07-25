"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Pencil, X } from "lucide-react";
import type { PlayerTotal } from "@/hooks/useGrainsSocket";
import { AnimatedNumber } from "./AnimatedNumber";
import { flagEmoji } from "./CountryLeaderboard";

const COLLAPSED_ROWS = 3;
/** Mirrors MAX_NAME_LEN in src/lib/grains/db.ts (the server re-clamps anyway). */
const MAX_NAME_LEN = 20;

/**
 * Top individual players, ranked by personal grain total — distinct from the
 * country board, which sums a whole country's players. Top 3 by default; the
 * rest live behind a dropdown.
 *
 * Players start as an anonymous rice handle ("Toasty Risotto 45") and can rename
 * themselves here. The server sanitizes and persists the name against their
 * session cookie, so it survives reloads and shows to everyone else.
 */
export function PlayersLeaderboard({
  topPlayers,
  youHandle,
  onRename,
  className,
  open,
  onToggle,
}: {
  topPlayers: PlayerTotal[];
  youHandle: string;
  /** Commit a new name (empty ⇒ revert to the generated handle). */
  onRename: (name: string) => void;
  className?: string;
  /** Controlled open state (lifted so the parent can stack it full-width). */
  open: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = topPlayers;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hiddenCount = rows.length - COLLAPSED_ROWS;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    setDraft(youHandle);
    setEditing(true);
  };
  const commit = () => {
    onRename(draft.trim());
    setEditing(false);
  };

  return (
    <section
      aria-label="Top players leaderboard"
      className={`rounded-2xl border border-olive-deep/15 bg-bone/70 p-3 shadow-lg backdrop-blur ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:text-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
      >
        <h2 className="font-mono text-[0.7rem] font-bold uppercase tracking-widest text-olive-deep">
          Top players
        </h2>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={`text-olive-deep/70 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-2">
          {rows.length === 0 ? (
            <div className="px-2 py-5 text-center">
              <p className="text-2xl" aria-hidden="true">
                🏆
              </p>
              <p className="mt-1 font-sans text-xs text-olive-deep/70">
                No players yet — start tapping to claim #1.
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-0.5">
                {visible.map((p, i) => {
                  const isYou = !!youHandle && p.handle === youHandle;
                  return (
                    <li
                      key={`${p.handle}-${i}`}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                        isYou ? "bg-khaki/30 ring-1 ring-olive/40" : ""
                      }`}
                    >
                      <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-olive-deep/60">
                        #{i + 1}
                      </span>
                      <span className="text-base leading-none" aria-hidden="true">
                        {flagEmoji(p.code)}
                      </span>
                      <span
                        className="min-w-0 flex-1 break-words font-sans text-sm text-ink"
                        title={p.handle}
                      >
                        {p.handle}
                        {isYou && (
                          <span className="ml-1 text-[0.6rem] font-bold uppercase text-olive-deep">
                            you
                          </span>
                        )}
                      </span>
                      <AnimatedNumber
                        value={p.total}
                        className="shrink-0 font-mono text-sm font-semibold tabular-nums text-olive-deep"
                      />
                    </li>
                  );
                })}
              </ul>

              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                  className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1.5 font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-olive-deep/70 transition-colors hover:bg-khaki/25 hover:text-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
                >
                  {expanded ? "Show less" : `Show all ${rows.length}`}
                  <ChevronDown
                    size={13}
                    aria-hidden="true"
                    className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
              )}
            </>
          )}

          {/* --- your name: shown even when you're not yet on the board --- */}
          <div className="mt-2 border-t border-dashed border-olive-deep/20 pt-2">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  commit();
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing(false);
                  }}
                  maxLength={MAX_NAME_LEN}
                  aria-label="Your player name"
                  placeholder="your name"
                  className="min-w-0 flex-1 rounded-lg border border-olive-deep/30 bg-bone px-2 py-1 font-sans text-sm text-ink outline-none focus:border-olive"
                />
                <button
                  type="submit"
                  aria-label="Save name"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-olive text-bone transition-colors hover:bg-olive-deep"
                >
                  <Check size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  aria-label="Cancel"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-olive-deep/30 text-olive-deep transition-colors hover:bg-khaki/25"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={startEdit}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-khaki/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
              >
                <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-widest text-olive-deep/60">
                  You
                </span>
                <span className="min-w-0 flex-1 truncate font-sans text-sm font-semibold text-ink">
                  {youHandle || "…"}
                </span>
                <Pencil size={13} aria-hidden="true" className="shrink-0 text-olive-deep/70" />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
