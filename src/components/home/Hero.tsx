"use client";

import Image from "next/image";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";
import { useRice } from "@/components/rice/RiceParticles";
import { playPour } from "@/lib/sound";
import { AmbientFarm } from "@/components/journey/AmbientFarm";
import { useMealsDonated } from "@/hooks/useCharityImpact";

/** Width of the Buy CTA art on desktop — the meals box is centred on it. */
const BUY_W_LG = "lg:w-[18rem]";

/**
 * Live count of meals funded by real USD leaving the charity wallet ($1 = 10
 * meals). Desktop: sits between the wordmark and the Buy CTA in column one.
 * Mobile: directly above the "just hold ONE grain" line.
 */
function MealsDonated() {
  const meals = useMealsDonated();
  return (
    <div className="inline-flex flex-col items-center border border-khaki/40 bg-black/45 px-10 py-5 text-center backdrop-blur-sm sm:px-5 sm:py-2.5">
      <span className="flex flex-col font-mono text-[1.8rem] leading-tight font-bold tracking-[0.2em] text-khaki uppercase [-webkit-text-stroke:0.03em_currentColor] sm:text-[0.9rem]">
        <span>Meals</span>
        <span>Donated</span>
      </span>
      <span className="gold-shimmer font-display-round text-5xl font-bold tabular-nums sm:text-3xl">
        {meals ?? "…"}
      </span>
    </div>
  );
}

/**
 * New-home hero — the single luminous grain over an open, upturned palm (never
 * a bowl), the brand thesis. Extracted from JourneyHero so the new page no
 * longer mounts the SEED→GROW→HARVEST→DONATE journey spine. The old secondary
 * "Enter the Village" CTA is intentionally gone (game/village link removed);
 * only the primary "Get $RICE" CTA remains. Condensed ~40% vertically.
 */
export function Hero() {
  const { pour } = useRice();
  return (
    <section
      id="top"
      className="relative flex min-h-[24vh] flex-col overflow-hidden bg-black px-6 pb-2 pt-16 text-bone lg:min-h-0 lg:pb-1 lg:pt-24"
    >
      <AmbientFarm />

      {/* Mobile: single-column flex, ordered so the Buy CTA drops BELOW the blurb
          (order-4). Desktop: 2-col grid — wordmark + Buy stacked left, grain
          right (spanning), and a full-width bottom row (just hold → tagline →
          blurb). Image sizes kept; -mt-* pulls items up into transparent padding. */}
      <div className="relative z-10 flex flex-1 flex-col justify-start">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center gap-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:gap-y-2">
          {/* Wordmark */}
          <h1 className="order-1 m-0 w-full max-w-[30rem] sm:max-w-[34rem] lg:order-none lg:col-start-1 lg:row-start-1 lg:max-w-[25.5rem] lg:justify-self-start">
            <Image
              src={asset("/onegrainofrice.png")}
              alt={`${site.heroTitle.pre} ${site.heroTitle.accent}`}
              width={1536}
              height={1024}
              priority
              className="h-auto w-full"
            />
          </h1>

          {/* Grain — spans the wordmark / meals / Buy stack in column one. */}
          <div className="order-2 flex w-full flex-col items-center lg:order-none lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:-mt-8">
            <div className="relative w-full max-w-[24rem] lg:max-w-[28rem]">
              <div className="grain-glow relative aspect-[4/5] w-full">
                <Image
                  src={asset("/hero-grain.png")}
                  alt="A single glowing grain of rice hovering above an open upturned palm"
                  fill
                  priority
                  sizes="(min-width: 1024px) 28rem, 70vw"
                  className="object-contain"
                />
              </div>
            </div>
          </div>

          {/* Meals donated — desktop: column one, between the wordmark and the
              Buy art (both keep their columns). The wrapper takes the Buy art's
              width so the box centres on the button rather than hugging the
              column's left edge. Mobile: above "just hold". */}
          <div
            className={`order-3 flex justify-center lg:order-none lg:col-start-1 lg:row-start-2 lg:-mt-16 lg:justify-self-start ${BUY_W_LG}`}
          >
            <MealsDonated />
          </div>

          {/* Bottom row: "just hold" line, then the tagline + blurb. */}
          <div className="order-4 mx-auto w-full max-w-3xl text-center lg:order-none lg:col-span-2 lg:row-start-4 lg:-mt-20">
            <p className="font-display text-xl italic text-bone">
              just hold <span className="text-khaki not-italic">ONE</span>{" "}
              <span className="italic">grain.</span>
            </p>
            <p className="mt-2 font-display text-lg font-bold italic text-khaki sm:text-xl">
              Digital. Decentralized. Delicious.
            </p>
            <p className="mt-1 font-mono text-sm text-bone/85 sm:text-base">
              {
                "$RICE is the operating system of value. Rice feeds 4 billion people daily. $1 buys 10 meals. One grain. Endless harvest. The most edible, scrumptious, impactful morsel ever created."
              }
            </p>
          </div>

          {/* Buy CTA — desktop: under the wordmark (col 1, row 2); mobile: last,
              below the blurb. */}
          <a
            href={site.buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${site.hero.ctaPrimary} on Jupiter`}
            onClick={(e) => {
              pour({ x: e.clientX, y: e.clientY, count: 36 });
              playPour();
            }}
            className="order-5 mt-1 inline-block transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki lg:order-none lg:col-start-1 lg:row-start-3 lg:-mt-14 lg:justify-self-start"
          >
            <Image
              src={asset("/buyrice.png")}
              alt={site.hero.ctaPrimary}
              width={1536}
              height={1024}
              priority
              className={`h-auto w-[22rem] sm:w-[24rem] ${BUY_W_LG}`}
            />
          </a>
        </div>
      </div>
    </section>
  );
}
