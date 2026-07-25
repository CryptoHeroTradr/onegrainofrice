"use client";

import { AnimatedNumber } from "./AnimatedNumber";

/**
 * Live "<n> TOTAL GRAINS" counter. Purely presentational — the number is driven
 * by the WS hook in the parent and tweens on change. A small dot reflects the
 * live connection state.
 *
 * Sizes:
 *  - `sm` (default) — the compact chip.
 *  - `lg` — hero treatment at the very top of the game on mobile.
 *  - `xl` — the desktop header tally, pinned in the top-right corner: 3.75rem,
 *    i.e. 2× the mobile `lg` (1.875rem).
 */
export function GrainsCounter({
  total,
  connected,
  size = "sm",
}: {
  total: number;
  connected: boolean;
  size?: "sm" | "lg" | "xl";
}) {
  const shell =
    size === "xl" ? "gap-3 px-6 py-2.5" : size === "lg" ? "gap-2.5 px-5 py-2" : "gap-2 px-4 py-1.5";
  const dot = size === "xl" ? "h-3 w-3" : size === "lg" ? "h-2.5 w-2.5" : "h-2 w-2";
  const number =
    size === "xl"
      ? "text-6xl leading-none font-black"
      : size === "lg"
        ? "text-3xl font-black"
        : "text-sm font-bold sm:text-base";
  const label =
    size === "xl"
      ? "text-base font-bold"
      : size === "lg"
        ? "text-xs font-bold"
        : "text-[0.65rem] font-semibold";

  return (
    <div
      className={`flex items-center rounded-full border border-olive-deep/20 bg-bone/80 shadow-sm backdrop-blur ${shell}`}
    >
      <span
        aria-hidden="true"
        className={`rounded-full ${dot} ${connected ? "bg-bamboo" : "bg-tuna/70"}`}
        title={connected ? "Live" : "Reconnecting…"}
      />
      <AnimatedNumber value={total} className={`font-mono tabular-nums text-ink ${number}`} />
      <span
        className={`whitespace-nowrap font-mono uppercase tracking-widest text-olive-deep ${label}`}
      >
        Total Grains
      </span>
    </div>
  );
}
