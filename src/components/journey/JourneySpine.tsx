"use client";

import { useCallback, useEffect, useRef } from "react";
import { site } from "@/config/site";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useRice } from "@/components/rice/RiceParticles";
import { RicePile } from "@/components/rice/RicePile";
import { JourneyHero } from "./JourneyHero";
import { JourneySection } from "./JourneySection";
import { useJourneyBowl } from "./useJourneyBowl";

/**
 * The full scroll-snap journey: HERO (single grain over palm) → SEED → GROW →
 * HARVEST → DONATE (climaxes in the RicePile). A shared bowl-fill rises behind
 * the four beats (0→25→50→100→overflow). Scroll-snap is enabled on the window
 * only while this spine is mounted (so useBowlFill/scroll math stays window-based).
 */
export function JourneySpine() {
  const reduced = usePrefersReducedMotion();
  const { pour } = useRice();
  const blockRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef<HTMLDivElement>(null);

  // Enable window-level scroll-snap only for this route.
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("journey-snap");
    return () => el.classList.remove("journey-snap");
  }, []);

  const onDrip = useCallback(() => {
    // A little grain rain at each milestone (centre-top of the viewport).
    pour({ x: window.innerWidth / 2, y: window.innerHeight * 0.3, count: 8 });
  }, [pour]);

  useJourneyBowl(blockRef, levelRef, reduced, onDrip);

  const { seed, grow, harvest, donate } = site.journey;

  return (
    <>
      <JourneyHero />

      {/* Four beats over a shared rising bowl-fill */}
      <div ref={blockRef} className="relative bg-steamed">
          {/* Sticky fill layer behind the sections (negative margin overlaps them) */}
          <div
            aria-hidden="true"
            className="pointer-events-none sticky top-0 -mb-[100vh] h-screen overflow-hidden"
          >
            <div
              ref={levelRef}
              className="bowl-fill absolute inset-0"
              style={{ ["--bowl-color" as string]: "var(--color-khaki)", ["--bowl-level" as string]: "0%" }}
            />
            <div className="grain absolute inset-0 opacity-60" />
          </div>

          <JourneySection id="seed" step="Seed" lead={seed.heading.lead} accent={seed.heading.accent} body={seed.body} />
          <JourneySection id="grow" step="Grow" lead={grow.heading.lead} accent={grow.heading.accent} body={grow.body} />
          <JourneySection id="harvest" step="Harvest" lead={harvest.heading.lead} accent={harvest.heading.accent} body={harvest.body} />

          {/* DONATE — climaxes into the live RicePile */}
          <section
            id="donate"
            className="journey-section relative flex flex-col items-center justify-center gap-8 px-6 py-24"
          >
            <div className="relative z-10 mx-auto w-full max-w-2xl rounded-sm bg-steamed/85 px-8 py-8 text-center backdrop-blur-sm">
              <p className="mb-3 font-mono text-xs font-bold tracking-[0.3em] text-tuna uppercase">
                Donate
              </p>
              <div className="flex justify-center">
                <div className="font-display-round text-4xl font-bold text-nori sm:text-5xl">
                  {donate.heading.lead} <span className="text-bamboo">{donate.heading.accent}</span>
                </div>
              </div>
              <p className="mx-auto mt-5 max-w-xl font-mono text-base leading-relaxed text-nori/75">
                {donate.body}
              </p>
            </div>
            <div className="relative z-10 w-full">
              <RicePile />
            </div>
          </section>
      </div>
    </>
  );
}
