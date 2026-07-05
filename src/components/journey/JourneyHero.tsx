"use client";

import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";
import { RiceButton } from "@/components/rice/RiceButton";
import { AmbientFarm } from "./AmbientFarm";

/**
 * Journey hero — PRESERVES the single luminous grain over an open, upturned
 * palm (never a bowl). Ambient farm backdrop + glowing grain + drifting grains.
 * Primary CTA pours rice and goes to the buy link; secondary enters the village.
 */
export function JourneyHero() {
  return (
    <section
      id="top"
      className="journey-section relative flex items-center justify-center overflow-hidden bg-nori text-bone"
    >
      <AmbientFarm />

      <div className="relative z-10 mx-auto grid max-w-[1180px] items-center gap-8 px-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <h1 className="font-display-round text-6xl leading-[0.92] font-bold tracking-tight sm:text-7xl">
            {site.heroTitle.pre} <span className="text-khaki">{site.heroTitle.accent}</span>
          </h1>
          <p className="mt-6 max-w-md font-mono text-base text-bone/85 sm:text-lg">
            {site.tagline}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <RiceButton
              pourCount={36}
              aria-label={`${site.hero.ctaPrimary} — pours rice`}
              onClick={() => window.open(site.buyUrl, "_blank", "noopener,noreferrer")}
              className="bg-tuna px-7 py-3 font-display-round text-lg font-bold text-steamed transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
            >
              {site.hero.ctaPrimary}
            </RiceButton>
            <a
              href={site.villageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 border-2 border-bone/40 px-6 py-3 font-mono text-sm font-bold tracking-widest transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
            >
              {site.hero.ctaSecondary} <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>

          <p className="mt-8 font-display text-2xl italic text-bone">
            just hold <span className="text-khaki not-italic">ONE</span>{" "}
            <span className="italic">grain.</span>
          </p>
        </div>

        {/* Single glowing grain over an upturned palm — the brand thesis */}
        <div className="relative mx-auto w-full max-w-md">
          <div className="grain-glow relative aspect-[4/5] w-full">
            <Image
              src={asset("/hero-grain.svg")}
              alt="A single glowing grain of rice hovering above an open upturned palm"
              fill
              priority
              sizes="(min-width: 1024px) 30rem, 85vw"
              className="object-contain"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
