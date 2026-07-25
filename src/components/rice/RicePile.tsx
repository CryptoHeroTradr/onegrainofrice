"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useRice } from "./RiceParticles";

/**
 * The rice bowl — a self-contained, always-satisfying VISUAL. No network calls,
 * no external data of any kind. One blue-and-white porcelain bowl that fills
 * with grains, driven by three "alive" sources:
 *
 *   a) Auto-accrual — grains drip in on a timer until the bowl is heaped, then
 *      it idles with a gentle settling shimmer.
 *   b) Scroll-reactive — fill also advances as the section scrolls through view
 *      (0.4 → heaped → slight overflow), so scrolling visibly piles rice.
 *   c) Interaction — tapping / pinch-grabbing the bowl tosses in a handful.
 *
 * The pile only ever grows (drivers combine monotonically), starts ~40% full so
 * it always reads as a pile, and the "grains and counting" number is purely
 * decorative flavor — NOT a donation metric.
 *
 * Reduced motion: a static heaped bowl — no drips, no shimmer, no counter.
 */

// Fill level (0 = empty, 1 = level with the rim, >1 = heaped/overflow).
const REST = 0.4; // visible non-empty resting state on first paint
const FULL = 1; // rim
const HEAP_MAX = 1.2; // most the heap can overflow
const IDLE_AT = 0.98; // stop dripping once effectively full (idle shimmer takes over)

export function RicePile() {
  const reduced = usePrefersReducedMotion();
  const { pour } = useRice();
  const rootRef = useRef<HTMLDivElement>(null);
  const bowlRef = useRef<HTMLDivElement>(null);

  const [level, setLevel] = useState(REST);
  const [grains, setGrains] = useState(4321);

  // Mirror level into a ref so the accrual timer can read it without resubscribing.
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  // Pour a small burst of grains into the bowl (if it's on screen).
  const dripIntoBowl = (count: number) => {
    const el = bowlRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= window.innerHeight) return;
    pour({
      x: r.left + r.width / 2 + (Math.random() - 0.5) * r.width * 0.4,
      y: r.top + r.height * 0.08,
      count,
    });
  };

  // (a) Auto-accrual: drip toward full, then idle. The decorative counter keeps
  // ticking ("and counting") even after the bowl is heaped.
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setLevel((l) => (l < FULL ? Math.min(FULL, l + 0.035) : l));
      setGrains((g) => g + 36 + Math.floor(Math.random() * 40));
      if (levelRef.current < IDLE_AT) dripIntoBowl(4);
    }, 700);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // (b) Scroll-reactive: map the section's pass through the viewport to fill.
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = rootRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const p = Math.max(0, Math.min(1, (vh - rect.top) / (vh + rect.height)));
        const scrollLevel = REST + p * (HEAP_MAX - REST);
        setLevel((l) => Math.max(l, scrollLevel));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  // (c) Interaction: toss in a handful. No-op under reduced motion (static bowl).
  const onPinch = (e: React.PointerEvent) => {
    if (reduced) return;
    setLevel((l) => Math.min(HEAP_MAX, l + 0.08));
    setGrains((g) => g + 180 + Math.floor(Math.random() * 80));
    pour({ x: e.clientX, y: e.clientY, count: 18 });
  };

  // Reduced motion → static heaped bowl regardless of the (unused) level state.
  const displayLevel = reduced ? FULL : level;
  const inBowl = Math.min(displayLevel, 1); // fill can't clip above the rim
  const heapScale = Math.min(displayLevel, HEAP_MAX); // heap overflows past the rim
  const fillTranslate = (1 - inBowl) * 150;
  const transition = reduced ? "none" : "transform 420ms cubic-bezier(0.22,0.61,0.36,1)";

  return (
    <div ref={rootRef} className="mx-auto flex max-w-xl flex-col items-center gap-6 text-center">
      {/* Meme/token-native copy — the "one grain becomes many" thesis */}
      <div>
        <h2 className="font-display-round text-4xl font-bold text-nori sm:text-5xl">
          one grain <span className="text-bamboo">becomes many.</span>
        </h2>
        <p className="mx-auto mt-3 max-w-md font-mono text-sm text-nori/70">
          scroll to pile it higher — or tap the bowl to toss in a handful.
        </p>
      </div>

      {/* Bowl + growing rice pile */}
      <div
        ref={bowlRef}
        data-grab
        onPointerDown={onPinch}
        className="relative w-full max-w-sm cursor-pointer select-none"
        aria-label="A heaping bowl of rice"
      >
        <svg viewBox="0 0 360 300" className="w-full" role="img" aria-hidden="true">
          <defs>
            <linearGradient id="riceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-steamed)" />
              <stop offset="100%" stopColor="var(--color-khaki)" />
            </linearGradient>
            <clipPath id="bowlInterior">
              <path d="M42 166 L318 166 Q312 262 180 284 Q48 262 42 166 Z" />
            </clipPath>
          </defs>

          {/* Back rim */}
          <ellipse cx="180" cy="166" rx="138" ry="30" fill="#e7edf6" stroke="var(--color-porcelain)" strokeWidth="2.5" />

          {/* In-bowl fill, clipped, rising with the fill level */}
          <g clipPath="url(#bowlInterior)">
            <g style={{ transform: `translateY(${fillTranslate}px)`, transition }}>
              <rect x="30" y="150" width="300" height="170" fill="url(#riceGrad)" />
              <ellipse cx="180" cy="150" rx="150" ry="26" fill="var(--color-steamed)" />
            </g>
          </g>

          {/* Heap above the rim, scaling with the fill level (overflows past 1) */}
          <g
            style={{
              transform: `scaleY(${heapScale})`,
              transformOrigin: "180px 168px",
              transition,
            }}
          >
            <path d="M70 168 Q180 60 290 168 Q180 150 70 168 Z" fill="url(#riceGrad)" />
            {/* Idle settling shimmer (motion only) */}
            {!reduced && (
              <g className="rice-shimmer">
                <ellipse cx="150" cy="120" rx="4" ry="1.8" fill="var(--color-steamed)" transform="rotate(20 150 120)" />
                <ellipse cx="196" cy="108" rx="4" ry="1.8" fill="var(--color-steamed)" transform="rotate(-15 196 108)" />
                <ellipse cx="176" cy="132" rx="4" ry="1.8" fill="var(--color-steamed)" transform="rotate(35 176 132)" />
                <ellipse cx="214" cy="128" rx="4" ry="1.8" fill="var(--color-bone)" transform="rotate(-25 214 128)" />
              </g>
            )}
          </g>

          {/* Front bowl body (porcelain) over the fill */}
          <path
            d="M42 166 Q48 262 180 284 Q312 262 318 166"
            fill="none"
            stroke="var(--color-porcelain)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path d="M42 166 Q180 196 318 166" fill="none" stroke="var(--color-porcelain)" strokeWidth="1.4" opacity="0.5" />
          {/* willow dots */}
          <g fill="var(--color-porcelain)" opacity="0.8">
            <circle cx="96" cy="222" r="3" />
            <circle cx="180" cy="238" r="3" />
            <circle cx="264" cy="222" r="3" />
          </g>
        </svg>
      </div>

      {/* Decorative flavor counter — NOT a donation metric. Motion only. */}
      {!reduced && (
        <div>
          <div className="font-display-round text-3xl font-bold text-bamboo sm:text-4xl">
            {grains.toLocaleString("en-US")}
          </div>
          <div className="font-mono text-[0.65rem] font-bold tracking-widest text-nori/50 uppercase">
            grains and counting
          </div>
        </div>
      )}
    </div>
  );
}
