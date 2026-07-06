import { JourneyNav } from "@/components/journey/JourneyNav";
import { JourneySpine } from "@/components/journey/JourneySpine";
import { HomeFooter } from "@/components/journey/HomeFooter";
import { SushiBeltSection } from "@/components/memes/SushiBeltSection";
import { TokenomicsBowls } from "@/components/content/TokenomicsBowls";
import { EarnSteps } from "@/components/content/EarnSteps";
import { CharitySection } from "@/components/content/CharitySection";
import { Lore } from "@/components/content/Lore";
import { RiceifyPFP } from "@/components/pfp/RiceifyPFP";
import { VoteBowls } from "@/components/dao/VoteBowls";
import { PaddyTerraces } from "@/components/roadmap/PaddyTerraces";
import { Faq } from "@/components/sections/Faq";
import { site } from "@/config/site";
import { SectionHeading } from "@/components/primitives/SectionHeading";

/**
 * The new $RICE home — the Phase 7 journey spine (single grain over palm → SEED
 * → GROW → HARVEST → DONATE/RicePile) followed by the meme belt and the
 * config-driven content sections. RiceProvider + ChopstickCursor + KonamiRice
 * live in the layout. /classic still renders the original site untouched.
 */
export default function Home() {
  return (
    <>
      <JourneyNav />
      <main>
        {/* Hero + scroll-snap journey, ending in the live RicePile (DONATE) */}
        <JourneySpine />

        {/* Meme belt */}
        <section id="memes" className="grain-paper vignette-paper bg-paper py-16 text-ink sm:py-20">
          <div className="mx-auto mb-8 max-w-[1180px] px-6">
            <SectionHeading lead={site.memeWall.heading.lead} accent={site.memeWall.heading.accent} tone="dark" />
            <p className="mt-3 font-mono text-sm text-ink/70">{site.memeWall.sub}</p>
          </div>
          <SushiBeltSection />
        </section>

        <Lore />
        <TokenomicsBowls />
        <EarnSteps />
        <CharitySection />
        <RiceifyPFP />
        <VoteBowls />
        <PaddyTerraces />
        <Faq />
      </main>
      <HomeFooter />
    </>
  );
}
