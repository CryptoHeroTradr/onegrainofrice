"use client";

import { useEffect, useRef, useState } from "react";
import { playClack } from "@/lib/sound";

/**
 * Chopstick cursor: two thin chopstick SVGs that follow the pointer and pinch
 * closed on mousedown or over grabbable/interactive targets. Purely decorative
 * and pointer-events-none — it never blocks interaction.
 *
 * Guardrails:
 *  - Only active on (pointer: fine) AND not prefers-reduced-motion. Otherwise
 *    renders nothing and leaves the native cursor alone.
 *  - Native cursor is hidden site-wide (via the `chopsticks-active` body class)
 *    ONLY while active, and restored over text fields so typing is unaffected.
 *
 * Grabbable convention: mark any element (or ancestor) with `data-grab` to make
 * the sticks pinch when hovering it (used by the rice pile / conveyor / DAO
 * grains in later phases). Native interactive elements also trigger the pinch.
 */

const GRAB_SELECTOR =
  '[data-grab], a[href], button, summary, label, select, [role="button"], [tabindex]:not([tabindex="-1"])';
const TEXT_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

// Tip anchor inside the 80×80 pair box (where the sticks meet = cursor point).
const TIP_X = 39;
const TIP_Y = 72;

function Stick({ side }: { side: "left" | "right" }) {
  return (
    <svg
      width="12"
      height="66"
      viewBox="0 0 12 66"
      className={`stick stick-${side}`}
      aria-hidden="true"
    >
      {/* Tapered chopstick, tip at bottom-center (6,66). */}
      <path
        d="M6 66 L8.6 6 Q8.9 1.5 6 1.5 Q3.1 1.5 3.4 6 Z"
        fill="var(--color-nori, #14110d)"
        stroke="var(--color-steamed, #fbf7ee)"
        strokeWidth="0.7"
      />
    </svg>
  );
}

export function ChopstickCursor() {
  const [enabled, setEnabled] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pairRef = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const overGrab = useRef(false);
  const pinchApplied = useRef(false);

  // Eligibility: fine pointer + motion allowed. Reactive to changes.
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(fine.matches && !reduce.matches);
    update();
    fine.addEventListener("change", update);
    reduce.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      reduce.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const wrap = wrapRef.current;
    const pair = pairRef.current;
    if (!wrap || !pair) return;

    document.body.classList.add("chopsticks-active");

    const applyPinch = () => {
      const pinch = pressed.current || overGrab.current;
      if (pinch !== pinchApplied.current) {
        pinchApplied.current = pinch;
        pair.dataset.pinch = pinch ? "true" : "false";
      }
    };

    const onMove = (e: PointerEvent) => {
      wrap.style.transform = `translate3d(${e.clientX - TIP_X}px, ${e.clientY - TIP_Y}px, 0)`;

      const target = e.target instanceof Element ? e.target : null;
      const overText = !!target?.closest(TEXT_SELECTOR);
      // Show sticks (and hide native cursor via body class) unless over a text
      // field, where the native caret must show for typing.
      wrap.dataset.show = overText ? "false" : "true";
      overGrab.current = !overText && !!target?.closest(GRAB_SELECTOR);
      applyPinch();
    };

    const onDown = () => {
      pressed.current = true;
      applyPinch();
      playClack();
    };
    const onUp = () => {
      pressed.current = false;
      applyPinch();
    };
    const onLeave = () => {
      wrap.dataset.show = "false";
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    return () => {
      document.body.classList.remove("chopsticks-active");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div ref={wrapRef} className="chopstick-cursor" data-show="false" aria-hidden="true">
      <div ref={pairRef} className="chopstick-pair" data-pinch="false">
        <Stick side="left" />
        <Stick side="right" />
      </div>
    </div>
  );
}
