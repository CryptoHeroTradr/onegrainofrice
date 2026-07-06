/**
 * Phase 8 demo harness for the config-driven content sections. Visit
 * /onegrainofrice/content-demo. Server component; the existing Faq reads the
 * (now extended) site.faq.items. Removable once wired into the home in Phase 12.
 */
import { Lore } from "@/components/content/Lore";
import { TokenomicsBowls } from "@/components/content/TokenomicsBowls";
import { EarnSteps } from "@/components/content/EarnSteps";
import { CharitySection } from "@/components/content/CharitySection";
import { Faq } from "@/components/sections/Faq";

export default function ContentDemo() {
  return (
    <main>
      <Lore />
      <TokenomicsBowls />
      <EarnSteps />
      <CharitySection />
      <Faq />
    </main>
  );
}
