import Link from "next/link";
import { JourneyNav } from "@/components/journey/JourneyNav";
import { Hero } from "@/components/home/Hero";
import { HomeFooter } from "@/components/journey/HomeFooter";
import { SushiBeltSection } from "@/components/memes/SushiBeltSection";
import { TokenInfo } from "@/components/content/TokenInfo";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { SimplePfpGen } from "@/components/home/SimplePfpGen";

/**
 * The $RICE home — a scrubbed, non-game/non-charity site: palm/single-grain
 * hero, the rice bowl as a pure visual, the meme belt, tokenomics, the
 * client-only PFP compositor, the roadmap, and a curated FAQ. The journey spine
 * (SEED→GROW→HARVEST→DONATE), Lore, CharitySection, EarnSteps, and VoteBowls
 * were removed at the composition level. Curated subsets come from
 * `src/config/home.ts`; the shared `site.ts` data is untouched (and /classic
 * still renders the original site in full). RiceProvider + ChopstickCursor +
 * KonamiRice live in the layout.
 *
 * THIS IS THE SITE'S LANDING PAGE as of Phase 7 (2026-08-05). It lived at `/home`
 * and the Grains Game held `/`; the two swapped, and the games moved under
 * `/games`. `/home` keeps a 308 to here rather than a second copy of this page —
 * it was linked from the nav, the footer and every `#tokenomics` anchor, so it
 * had to keep resolving, but two URLs serving one page is how the anchors and the
 * canonical drift apart. The route's metadata is the layout's; nothing overrides
 * it here, because the layout's title/description/OG now describe the site rather
 * than the game that used to be at `/`.
 */
export default function Home() {
  return (
    <>
      <JourneyNav />
      <main>
        {/* Palm / single-grain hero */}
        <Hero />

        {/* Meme belt — sits flush under the hero (no section padding), so the
            dark conveyor leads straight out of the hero with no empty band. */}
        <section id="memes" className="grain-paper bg-nori">
          <SushiBeltSection />
        </section>

        {/* PFP & Meme generator — the one-shot version (photo + a few words),
            with the full studio at /pfp one click away. Placed BEFORE tokenomics
            (swapped with Token). */}
        <section id="pfp" className="section grain-paper bg-steamed text-nori">
          <div className="mx-auto max-w-[1180px] px-6 text-center">
            <div className="flex justify-center">
              <SectionHeading lead="make your" accent="$Rice Villager PFP or Rice Meme" tone="dark" />
            </div>
            <p className="mx-auto mt-4 max-w-xl font-mono text-sm text-nori/70 sm:text-base">
              Drop in a photo and we&apos;ll hand your character a rice farmer hat and a steaming
              bowl — same art style, nothing else touched. Add a few words to steer it.
            </p>

            <SimplePfpGen />

            <div className="mt-8 flex justify-center">
              <Link
                href="/pfp"
                className="inline-flex min-h-11 items-center gap-2 bg-tuna px-7 font-display-round text-base font-bold text-steamed transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bamboo"
              >
                🌾 Full PFP &amp; Meme Generator →
              </Link>
            </div>
          </div>
        </section>

        <TokenInfo />
      </main>
      <HomeFooter />
    </>
  );
}
