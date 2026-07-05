/**
 * Classic homepage — a preserved, verbatim copy of the original `/` homepage,
 * kept at /onegrainofrice/classic while the main homepage is rebuilt in later
 * phases. Renders the same section components (which must not be deleted).
 * Keep this in sync-by-freeze: it should stay as the "old" site.
 */
import { Header } from "@/components/Header";
import { Hero } from "@/components/sections/Hero";
import { MemeWall } from "@/components/sections/MemeWall";
import { About } from "@/components/sections/About";
import { Impact } from "@/components/sections/Impact";
import { Tokenomics } from "@/components/sections/Tokenomics";
import { Faq } from "@/components/sections/Faq";
import { Footer } from "@/components/sections/Footer";
import { TornDivider } from "@/components/primitives/TornDivider";

export default function ClassicHome() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <TornDivider from="bg-ink" to="bg-paper" edge="bottom" />
        <MemeWall />
        <TornDivider from="bg-paper" to="bg-ink" edge="bottom" />
        <About />
        {/* About → Impact are both ink: flow as one dark zone, no torn seam */}
        <Impact />
        <TornDivider from="bg-ink" to="bg-paper" edge="bottom" />
        <Tokenomics />
        <TornDivider from="bg-paper" to="bg-bone" edge="bottom" />
        <Faq />
        <TornDivider from="bg-bone" to="bg-ink" edge="bottom" />
      </main>
      <Footer />
    </>
  );
}
