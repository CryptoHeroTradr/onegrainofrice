"use client";

import { useEffect, type RefObject } from "react";
import { useRice } from "./RiceParticles";

/**
 * Drives a section's `.bowl-fill` background from 0→100% as it scrolls through
 * the viewport, and (via fillBowl) drips grains into it. rAF-throttled scroll
 * handling; the fill itself is a static reflection of scroll position so it's
 * safe under reduced motion (grain drips are motion-gated inside fillBowl).
 *
 * Fill mapping: 0% when the section's top is at the bottom of the viewport,
 * 100% once the section has fully passed the top.
 */
export function useBowlFill(ref: RefObject<HTMLElement | null>) {
  const { fillBowl } = useRice();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let ticking = false;

    const compute = () => {
      ticking = false;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const total = rect.height + vh;
      const progressed = vh - rect.top;
      const pct = Math.max(0, Math.min(100, (progressed / total) * 100));
      fillBowl(el, pct);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(compute);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    compute(); // initial

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref, fillBowl]);
}
