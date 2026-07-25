"use client";

import { forwardRef, memo, useImperativeHandle, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export interface FloatingTextHandle {
  /** Emit a floating word at viewport coords (x, y). No-op if pool is full. */
  burst: (x: number, y: number) => void;
}

// Fixed pool of DOM nodes — recycled, so heavy clicking can never grow the DOM.
const POOL_SIZE = 24;
// Every click pops "$RICE".
const WORDS = ["$RICE"];

/**
 * meep.cat-style floating text: a click occasionally pops a "RICE"/🍚 that
 * drifts up and fades. Recycles a fixed pool of nodes (hard cap on concurrent
 * floaters) and skips entirely under prefers-reduced-motion.
 */
export const FloatingText = memo(
  forwardRef<FloatingTextHandle, unknown>(function FloatingText(_props, ref) {
    const reduced = usePrefersReducedMotion();
    const reducedRef = useRef(reduced);
    reducedRef.current = reduced;

    const slots = useRef<(HTMLSpanElement | null)[]>([]);
    const free = useRef<number[]>(Array.from({ length: POOL_SIZE }, (_, i) => i));

    useImperativeHandle(ref, () => ({
      burst: (x: number, y: number) => {
        if (reducedRef.current) return;
        const i = free.current.pop();
        if (i == null) return; // pool exhausted → cap reached, drop it
        const node = slots.current[i];
        if (!node) {
          free.current.push(i);
          return;
        }
        node.textContent = WORDS[Math.floor(Math.random() * WORDS.length)];
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.style.setProperty("--fx", `${(Math.random() - 0.5) * 46}px`);
        node.style.setProperty("--fr", `${(Math.random() - 0.5) * 24}deg`);
        // Restart the CSS animation (remove → reflow → add).
        node.classList.remove("active");
        void node.offsetWidth;
        node.classList.add("active");
      },
    }));

    const release = (i: number) => () => {
      const node = slots.current[i];
      if (node) node.classList.remove("active");
      if (!free.current.includes(i)) free.current.push(i);
    };

    return (
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        {Array.from({ length: POOL_SIZE }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              slots.current[i] = el;
            }}
            className="grain-floater"
            onAnimationEnd={release(i)}
          />
        ))}
      </div>
    );
  }),
);
