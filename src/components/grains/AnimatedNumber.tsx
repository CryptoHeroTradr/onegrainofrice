"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/**
 * Renders an integer that tweens smoothly toward `value` (count-up ticks). Snaps
 * instantly under prefers-reduced-motion. Formatted with thousands separators.
 */
export function AnimatedNumber({
  value,
  className,
  durationMs = 400,
}: {
  value: number;
  className?: string;
  durationMs?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (from === to) return;

    // Reduced motion → 0ms duration (snaps on the first frame). All state
    // updates happen inside the rAF callback, never synchronously in the effect.
    const dur = reduced ? 0 : durationMs;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = dur <= 0 ? 1 : Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      const current = Math.round(from + (to - from) * eased);
      displayRef.current = current;
      setDisplay(current);
      rafRef.current = p < 1 ? requestAnimationFrame(tick) : null;
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [value, reduced, durationMs]);

  return <span className={className}>{display.toLocaleString("en-US")}</span>;
}
