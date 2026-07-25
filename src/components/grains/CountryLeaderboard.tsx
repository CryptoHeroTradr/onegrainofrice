"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CountryTotal } from "@/hooks/useGrainsSocket";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { flagEmoji, friendlyCountryName } from "@/lib/grains/flag";
import { AnimatedNumber } from "./AnimatedNumber";

// Re-exported so existing imports (`./CountryLeaderboard`) keep working; the
// definitions now live in the shared, server-safe @/lib/grains/flag module.
export { flagEmoji, friendlyCountryName };

const MAX_ROWS = 15;
/** Countries shown before the "show more" dropdown — always the global top 3. */
const COLLAPSED_ROWS = 3;

export interface LeaderboardRow extends CountryTotal {
  rank: number | null; // null = outside the visible top (pinned "you" row)
  isYou: boolean;
}

/**
 * Geo lookup failures all collapse into one bucket ("XX" / "Unknown"), which is
 * not a country and shouldn't compete on a country leaderboard — it was ranking
 * #2. Excluded from the board (and from the pinned self-row).
 */
function isUnknownCountry(c: { code: string; name?: string | null }): boolean {
  return c.code === "XX" || !c.code || c.name === "Unknown";
}

/** Pure: derive the ranked rows + a pinned self-row + empty flag from payloads. */
export function buildLeaderboard(
  topCountries: CountryTotal[],
  yourCountry: CountryTotal | null,
): { rows: LeaderboardRow[]; pinned: LeaderboardRow | null; empty: boolean } {
  const known = topCountries.filter((c) => !isUnknownCountry(c));
  // Rank AFTER filtering, so the numbering has no gaps.
  const rows: LeaderboardRow[] = known.slice(0, MAX_ROWS).map((c, i) => ({
    ...c,
    rank: i + 1,
    isYou: !!yourCountry && c.code === yourCountry.code,
  }));
  const inTop = rows.some((r) => r.isYou);
  const pinned: LeaderboardRow | null =
    yourCountry && yourCountry.total > 0 && !inTop && !isUnknownCountry(yourCountry)
      ? { ...yourCountry, rank: null, isYou: true }
      : null;
  return { rows, pinned, empty: known.length === 0 };
}

function Row({
  row,
  registerRef,
}: {
  row: LeaderboardRow;
  registerRef?: (code: string, node: HTMLLIElement | null) => void;
}) {
  const name = friendlyCountryName(row.code, row.name);
  return (
    <li
      ref={registerRef ? (n) => registerRef(row.code, n) : undefined}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
        row.isYou ? "bg-khaki/30 ring-1 ring-olive/40" : ""
      }`}
    >
      <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-olive-deep/60">
        {row.rank == null ? "·" : `#${row.rank}`}
      </span>
      <span className="text-base leading-none" aria-hidden="true">
        {flagEmoji(row.code)}
      </span>
      <span className="min-w-0 flex-1 break-words font-sans text-sm text-ink" title={name}>
        {name}
        {row.isYou && <span className="ml-1 text-[0.6rem] font-bold uppercase text-olive-deep">you</span>}
      </span>
      <AnimatedNumber
        value={row.total}
        className="shrink-0 font-mono text-sm font-semibold tabular-nums text-olive-deep"
      />
    </li>
  );
}

export function CountryLeaderboard({
  topCountries,
  yourCountry,
  className,
  open,
  onToggle,
}: {
  topCountries: CountryTotal[];
  yourCountry: CountryTotal | null;
  className?: string;
  /** Controlled open state (lifted so the parent can stack it full-width). */
  open: boolean;
  onToggle: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const { rows, pinned, empty } = buildLeaderboard(topCountries, yourCountry);

  // Show the global top 3 by default; the rest live behind a dropdown.
  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hiddenCount = rows.length - COLLAPSED_ROWS;

  // FLIP: animate rows sliding to new ranks.
  const nodes = useRef(new Map<string, HTMLLIElement>());
  const prevTop = useRef(new Map<string, number>());
  const registerRef = (code: string, node: HTMLLIElement | null) => {
    if (node) nodes.current.set(code, node);
    else nodes.current.delete(code);
  };

  useLayoutEffect(() => {
    if (reduced) return;
    nodes.current.forEach((node, code) => {
      const top = node.offsetTop;
      const prev = prevTop.current.get(code);
      if (prev != null && prev !== top) {
        node.style.transition = "transform 0s";
        node.style.transform = `translateY(${prev - top}px)`;
        requestAnimationFrame(() => {
          node.style.transition = "transform 320ms cubic-bezier(0.2,0.8,0.2,1)";
          node.style.transform = "";
        });
      }
      prevTop.current.set(code, top);
    });
    for (const code of [...prevTop.current.keys()]) {
      if (!nodes.current.has(code)) prevTop.current.delete(code);
    }
  });

  return (
    <section
      aria-label="Rice by country leaderboard"
      className={`rounded-2xl border border-olive-deep/15 bg-bone/70 p-3 shadow-lg backdrop-blur ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:text-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
      >
        <h2 className="font-mono text-[0.7rem] font-bold uppercase tracking-widest text-olive-deep">
          Rice by country
        </h2>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={`text-olive-deep/70 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        (empty && !pinned ? (
        <div className="mt-2 px-2 py-6 text-center">
          <p className="text-2xl" aria-hidden="true">
            🌱
          </p>
          <p className="mt-1 font-sans text-sm font-semibold text-ink">Be the first grain</p>
          <p className="mt-0.5 font-sans text-xs text-olive-deep/70">
            No rice yet — every click counts for your country.
          </p>
        </div>
      ) : (
        <div className="mt-2">
          <ul className="relative space-y-0.5">
            {visibleRows.map((row) => (
              <Row key={row.code} row={row} registerRef={registerRef} />
            ))}
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
          {pinned && (
            <>
              <div className="my-1 border-t border-dashed border-olive-deep/20" />
              <ul>
                <Row row={pinned} />
              </ul>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
