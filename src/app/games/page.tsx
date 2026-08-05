import type { Metadata } from "next";
import Link from "next/link";
import { JourneyNav } from "@/components/journey/JourneyNav";
import { HomeFooter } from "@/components/journey/HomeFooter";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { games } from "@/config/games";

export const metadata: Metadata = {
  title: "Games — One Grain of Rice",
  description:
    "Three $RICE games: Rice Chomp, the Grains Game and Catch A Grain. All free, all in the browser, nothing to install.",
};

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
      <JourneyNav />
      <main className="grain-paper min-h-screen bg-steamed text-nori">
        {/* pt-24 clears the fixed nav (h-16, lg:h-24) — this page has no hero for
            it to float over, so the bar is solid from the first pixel. */}
        <div className="mx-auto max-w-[1180px] px-6 pt-28 pb-20 lg:pt-36">
          <div className="flex flex-col items-center text-center">
            <SectionHeading as="h1" lead="the $RICE" accent="arcade" tone="dark" />
            <p className="mt-5 max-w-xl font-mono text-sm text-nori/70 sm:text-base">
              Three games, no install, no wallet needed. Pick one.
            </p>
          </div>

          <ul className="mt-12 grid gap-6 sm:mt-16 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((game) => (
              <li key={game.slug} className="flex">
                <Link
                  href={game.href}
                  className="group flex w-full flex-col gap-3 border-2 border-nori/15 bg-bone p-6 text-left shadow-sticker transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bamboo"
                >
                  <span aria-hidden="true" className="text-4xl leading-none">
                    {game.emoji}
                  </span>
                  <h2 className="font-display-round text-2xl font-bold tracking-tight text-nori">
                    {game.title}
                  </h2>
                  <p className="font-display text-base font-bold text-olive">{game.tagline}</p>
                  <p className="font-mono text-sm leading-relaxed text-nori/70">{game.blurb}</p>
                  <span className="mt-auto pt-3 font-display-round text-base font-bold text-tuna">
                    Play {game.title} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <HomeFooter />
    </>
  );
}
