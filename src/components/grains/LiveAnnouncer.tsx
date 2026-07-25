"use client";

import { useEffect, useRef, useState } from "react";
import type { CountryTotal } from "@/hooks/useGrainsSocket";

/**
 * Screen-reader announcements for the live counters. The visible numbers tween
 * many times a second, which would flood a screen reader — so this renders a
 * single visually-hidden `aria-live="polite"` region that summarises state at
 * most once every few seconds. `aria-atomic` makes it read the whole summary.
 */
export function LiveAnnouncer({
  global,
  you,
  yourCountry,
  rank,
  intervalMs = 4000,
}: {
  global: number;
  you: number;
  yourCountry: CountryTotal | null;
  rank: number | null;
  intervalMs?: number;
}) {
  const [message, setMessage] = useState("");
  const latest = useRef({ global, you, yourCountry, rank });
  // Keep the ref current without writing during render (see react-hooks/refs).
  useEffect(() => {
    latest.current = { global, you, yourCountry, rank };
  }, [global, you, yourCountry, rank]);

  useEffect(() => {
    const build = () => {
      const { global: g, you: y, yourCountry: c, rank: r } = latest.current;
      const parts = [`${g.toLocaleString("en-US")} grains worldwide`];
      if (y > 0) parts.push(`your rice: ${y.toLocaleString("en-US")}`);
      if (c && r) parts.push(`${c.name} ranked number ${r}`);
      setMessage(parts.join(". ") + ".");
    };
    build();
    const id = setInterval(build, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}
