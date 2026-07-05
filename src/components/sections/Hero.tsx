import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";
import { resolveAsset } from "@/lib/resolveAsset";
import { BrushUnderline } from "@/components/primitives/SectionHeading";
import { Tape } from "@/components/primitives/Tape";

export function Hero() {
  const heroImg = resolveAsset("/hero-grain.png", "/hero-grain.svg");

  return (
    <section id="top" className="grain-paper bg-bone pt-24 pb-10 sm:pt-28 sm:pb-12">
      <div className="mx-auto max-w-[1180px] px-3 sm:px-5">
        {/* Dark hero block framed as a torn cream photo */}
        <div className="torn-block grain vignette-dark bg-ink px-6 py-12 sm:px-12 sm:py-14">
          <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <h1 className="font-display text-6xl leading-[0.9] font-bold tracking-tight text-bone sm:text-7xl">
                {site.heroTitle.pre} <span className="text-khaki">{site.heroTitle.accent}</span>
              </h1>
              <div className="mt-2 ml-1 w-[58%] max-w-[15rem]">
                <BrushUnderline />
              </div>

              <p className="mt-6 max-w-md font-mono text-base text-paper/85 sm:text-lg">
                {site.tagline}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a
                  href={site.buyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="torn-frame flex min-h-12 items-center bg-olive px-7 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
                >
                  BUY {site.ticker}
                </a>
                <a
                  href="#about"
                  className="flex min-h-12 items-center gap-2 border-2 border-paper/40 px-6 font-mono text-sm font-bold tracking-widest text-paper transition-colors hover:border-khaki hover:text-khaki focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
                >
                  LEARN MORE <ArrowRight size={16} aria-hidden="true" />
                </a>
              </div>
            </div>

            {/* Image slot: single luminous grain above an open palm */}
            <div className="relative mx-auto w-full max-w-md">
              <div className="relative aspect-[4/5] w-full">
                <Image
                  src={asset(heroImg)}
                  alt="A single glowing grain of rice hovering above an open upturned palm"
                  fill
                  priority
                  sizes="(min-width: 1024px) 30rem, 85vw"
                  className="object-contain"
                />
              </div>
            </div>
          </div>

          {/* Taped tagline, bottom-right */}
          <div className="relative mt-6 flex justify-end">
            <div className="relative inline-block rotate-[-2deg]">
              <Tape className="absolute -top-3 left-1/2 w-16 -translate-x-1/2 rotate-2" variant="paper" />
              <p className="font-display text-2xl italic text-paper">
                just hold <span className="text-khaki not-italic">ONE</span>{" "}
                <span className="italic">grain.</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
