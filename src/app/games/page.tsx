import type { Metadata } from "next";
import { JourneyNav } from "@/components/journey/JourneyNav";
import { HomeFooter } from "@/components/journey/HomeFooter";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { GameCards } from "@/components/games/GameCards";
import { gamesIntro, gamesMeta } from "@/config/games";

export const metadata: Metadata = gamesMeta;

/**
 * /games — the arcade index, added in Phase 7 (2026-08-05).
 *
 * Before this the three games were at `/`, `/chomp` and `/play` and there was no
 * page that knew all three existed: the Grains Game was reachable only by being
 * the landing page and Catch A Grain was reachable only if you already knew the
 * URL. This is the page the 🎮 Games menu entry points at.
 *
 * A server component — three links and no state. The cards are read from
 * `src/config/games.ts` so a fourth game is one entry there, not a fourth card
 * hand-copied here.
 */
export default function GamesIndex() {
  return (
    <>
      {/* No `overHero`: this page is `bg-steamed` from its first pixel, and the
          transparent bar paints its text in bone. */}
      <JourneyNav />
      <main className="grain-paper min-h-screen bg-steamed text-nori">
        {/* Top padding clears the fixed nav (h-16, lg:h-24). */}
        <div className="mx-auto max-w-[1180px] px-6 pt-28 pb-20 lg:pt-36">
          <div className="flex flex-col items-center text-center">
            <SectionHeading
              as="h1"
              lead={gamesIntro.headingLead}
              accent={gamesIntro.headingAccent}
              tone="dark"
            />
            <p className="mt-5 max-w-xl font-mono text-sm text-nori/70 sm:text-base">
              {gamesIntro.lede}
            </p>
          </div>

          {/* The cards themselves are shared with the home page's Games section —
              see components/games/GameCards. Directly under this page's h1. */}
          <GameCards headingLevel="h2" className="mt-12 sm:mt-16" />
        </div>
      </main>
      <HomeFooter />
    </>
  );
}
