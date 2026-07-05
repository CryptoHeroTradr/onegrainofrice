"use client";

import { useEffect, type RefObject } from "react";

/**
 * Drives ONE shared `.bowl-fill` element across the four journey beats:
 * SEED 0→25, GROW 25→50, HARVEST 50→100, DONATE 100→overflow. The level tracks
 * scroll position through the block (continuous when motion is allowed). Under
 * reduced motion it snaps to the current section's target so the bowl shows its
 * final state on enter rather than animating. `onDrip` fires on milestone
 * crossings (grain drips), skipped under reduced motion.
 */
const MILESTONES = [0, 25, 50, 100, 115];

export function useJourneyBowl(
  blockRef: RefObject<HTMLElement | null>,
  levelRef: RefObject<HTMLElement | null>,
  reduced: boolean,
  onDrip?: () => void,
) {
  useEffect(() => {
    const block = blockRef.current;
    const lvl = levelRef.current;
    if (!block || !lvl) return;

    let ticking = false;
    let lastMile = -1;

    const compute = () => {
      ticking = false;
      const rect = block.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const total = rect.height - vh;
      const p = total > 0 ? Math.max(0, Math.min(1, -rect.top / total)) : 0;

      const idx = p * 4;
      const seg = Math.min(3, Math.floor(idx));
      const frac = idx - seg;

      const level = reduced
        ? MILESTONES[Math.min(4, seg + 1)]
        : MILESTONES[seg] + (MILESTONES[seg + 1] - MILESTONES[seg]) * frac;

      lvl.style.setProperty("--bowl-level", `${level.toFixed(1)}%`);

      const mile = Math.floor(level / 25);
      if (!reduced && onDrip && mile > lastMile) {
        lastMile = mile;
        onDrip();
      }
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(compute);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    compute();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [blockRef, levelRef, reduced, onDrip]);
}
