import Link from "next/link";
import { games } from "@/config/games";

/**
 * The three game cards, rendered identically wherever they appear.
 *
 * Two surfaces show them: the `/games` index (where they are the page) and the
 * home page's Games section (2026-08-05, added directly above the PFP section).
 * The brief for the second was "reuse the copy from the /games cards rather than
 * writing a second set that drifts" — so this shares the MARKUP as well as the
 * strings, because a second card component with the same words is the same
 * divergence one commit later: the index gains a badge, the home page does not,
 * and the two stop being the same product.
 *
 * The copy itself is one level further down still, in `src/config/games.ts` —
 * this file has none of it. A fourth game is an entry there and appears on both
 * surfaces and in the nav dropdown at once.
 */
export function GameCards({
  /**
   * Heading level for the card titles. The cards sit directly under the page's
   * `h1` on /games and under a section `h2` on the home page, so the level is
   * the caller's to state — hardcoding one skips a level on the other surface,
   * which is the kind of thing that only shows up in a screen reader.
   */
  headingLevel: Heading = "h3",
  className = "",
}: {
  headingLevel?: "h2" | "h3";
  className?: string;
}) {
  return (
    <ul className={`grid gap-6 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {games.map((game) => (
        <li key={game.slug} className="flex">
          <Link
            href={game.href}
            className="group flex w-full flex-col gap-3 border-2 border-nori/15 bg-bone p-6 text-left shadow-sticker transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bamboo"
          >
            <span aria-hidden="true" className="text-4xl leading-none">
              {game.emoji}
            </span>
            <Heading className="font-display-round text-2xl font-bold tracking-tight text-nori">
              {game.title}
            </Heading>
            <p className="font-display text-base font-bold text-olive">{game.tagline}</p>
            <p className="font-mono text-sm leading-relaxed text-nori/70">{game.blurb}</p>
            <span className="mt-auto pt-3 font-display-round text-base font-bold text-tuna">
              Play {game.title} →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
