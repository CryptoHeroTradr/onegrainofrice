"use client";

import { useEffect, useRef, useState } from "react";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";
import { CHARITY_FALLBACK, type CharityDTO } from "@/lib/charity";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useRice } from "./RiceParticles";
import { Odometer } from "./Odometer";
import { CopyAddress } from "@/components/primitives/CopyAddress";

/**
 * rAF count-up from the previous value to `target`, ease-out. Under reduced
 * motion the duration is 0 so it jumps straight to the final number. State is
 * only updated inside the rAF callback (never synchronously in the effect).
 */
function useCountUp(target: number, reduced: boolean): number {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const dur = reduced ? 0 : 1200;
    const tick = (now: number) => {
      const t = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, reduced]);

  return val;
}

function StatChip({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-2 border-porcelain/60 bg-steamed px-4 py-2 text-center">
      <div className="font-display-round text-2xl font-bold text-bamboo">
        {value.toLocaleString("en-US")}
      </div>
      <div className="font-mono text-[0.65rem] font-bold tracking-widest text-nori/60 uppercase">
        {label}
      </div>
    </div>
  );
}

export function RicePile() {
  const reduced = usePrefersReducedMotion();
  const { pour } = useRice();
  const [dto, setDto] = useState<CharityDTO>(CHARITY_FALLBACK);

  // Poll the same-origin proxy; keep last-good on failure, never break.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(asset("/api/charity"), { cache: "no-store" });
        if (!res.ok) throw new Error("bad status");
        const data = (await res.json()) as CharityDTO;
        if (alive) setDto(data);
      } catch {
        /* keep last-good dto */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const progress = Math.max(0, Math.min(1, dto.progressPercent / 100));
  const grains = useCountUp(dto.grainsDonated, reduced);

  // Pile fill transforms (transition-driven; instant under reduced motion).
  const fillTranslate = (1 - progress) * 150;
  const transition = reduced ? "none" : "transform 850ms cubic-bezier(0.22,0.61,0.36,1)";

  const onPinch = (e: React.PointerEvent) => {
    // Delight only — no state change. Reduced motion: pour() self-no-ops.
    pour({ x: e.clientX, y: e.clientY, count: 16 });
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 text-center">
      {/* Ticker */}
      <div>
        <div className="flex items-baseline justify-center gap-2">
          <Odometer
            value={grains}
            reducedMotion={reduced}
            className="text-4xl font-bold text-khaki sm:text-5xl"
          />
          <span className="font-mono text-xs font-bold tracking-widest text-nori/60 uppercase">
            {site.charity.grainsLabel}
          </span>
        </div>
      </div>

      {/* Bowl + growing rice pile */}
      <div
        data-grab
        onPointerDown={onPinch}
        className="relative w-full max-w-sm cursor-pointer select-none"
        aria-label="Rice bowl — the pile grows with donations"
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

          {/* In-bowl fill, clipped, rising with progress */}
          <g clipPath="url(#bowlInterior)">
            <g style={{ transform: `translateY(${fillTranslate}px)`, transition }}>
              <rect x="30" y="150" width="300" height="170" fill="url(#riceGrad)" />
              <ellipse cx="180" cy="150" rx="150" ry="26" fill="var(--color-steamed)" />
            </g>
          </g>

          {/* Heap above the rim, scaling with progress */}
          <g
            style={{
              transform: `scaleY(${progress})`,
              transformOrigin: "180px 168px",
              transition,
            }}
          >
            <path d="M70 168 Q180 60 290 168 Q180 150 70 168 Z" fill="url(#riceGrad)" />
            {/* Idle shimmer grains (motion only) */}
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

      {/* Stat chips */}
      <div className="grid grid-cols-3 gap-3">
        <StatChip value={dto.totalKg} label={site.charity.stats.totalKg} />
        <StatChip value={dto.fedToday} label={site.charity.stats.fedToday} />
        <StatChip value={dto.fedAllTime} label={site.charity.stats.fedAllTime} />
      </div>

      {/* Charity wallet */}
      <div>
        <p className="mb-2 font-mono text-xs font-bold tracking-widest text-nori/60 uppercase">
          {site.charity.walletLabel}
        </p>
        <CopyAddress address={site.charityWallet} />
      </div>

      {dto.fallback && (
        <p className="font-mono text-[0.7rem] text-nori/40">
          live data unavailable — showing recent totals
        </p>
      )}
    </div>
  );
}
