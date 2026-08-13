import Link from "next/link";
import { games } from "@/config/games";

/**
 * The game cards, rendered identically wherever they appear.
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
 * this file has none of it. A fifth game is an entry there and appears on both
 * surfaces and in the nav dropdown at once.
 *
 * ── FLEX, NOT GRID, AND THE REASON IS THE FIFTH CARD ──────────────────────────
 * *Changed 2026-08-13, when TETRICE made it five.* This was
 * `grid sm:grid-cols-2 lg:grid-cols-3`, which is correct for any count divisible
 * by the column count and leaves a stranded card for every count that is not:
 *
 * | cards | 2-up (`sm`) | 3-up (`lg`) |
 * |---|---|---|
 * | 4 (before) | 2 + 2 | **3 + 1 — already stranded** |
 * | 5 (now) | **2 + 2 + 1** | 3 + 2 |
 *
 * A grid's trailing row is left-aligned, so the odd card sits under the first
 * column with a hole beside it — it reads as a layout that broke rather than as a
 * row with two cards in it. `flex-wrap` + `justify-center` centres the trailing
 * row instead, which is right for **every** count at **every** breakpoint,
 * including the sixth game nobody has written yet. The widths are the same
 * fractions the grid columns were, minus their share of the gap.
 *
 * `items-stretch` (the flex default) keeps the cards equal height within a row,
 * which is what `grid` was giving for free and is the one thing worth not losing.
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
    <ul className={`flex flex-wrap justify-center gap-6 ${className}`}>
      {games.map((game) => (
        <li
          key={game.slug}
          // `basis` rather than `w-`, so `flex-grow: 0` keeps a lone trailing card
          // the same width as the ones above it instead of stretching across the row.
          //
          // The `_` are SPACES — Tailwind's arbitrary-value escape. Written without
          // them the source reads `calc((100%-1.5rem)/2)`, and `100%-1.5rem` with no
          // whitespace around the minus is not valid CSS: today's Tailwind happens to
          // parse and re-serialise it correctly, so the bug would be invisible until a
          // version that does not, at which point the declaration is dropped and every
          // card silently falls back to full width.
          //
          // The subtracted amount is the row's share of `gap-6` (1.5rem): one gap
          // across two columns, two across three.
          className="flex grow-0 basis-full sm:basis-[calc((100%_-_1.5rem)/2)] lg:basis-[calc((100%_-_3rem)/3)]"
        >
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

            {/* ── THE CONTROLS LINE NAMES THE CONTROL THE READER ACTUALLY HAS ──
                Both are rendered and one is hidden in CSS, which is the same
                idiom `GrainsnakeScreen` already uses for its in-game hint. It has
                to be CSS rather than a `matchMedia` read: this is a server
                component on two prerendered pages, so a pointer-type branch in JS
                would either not exist at build time or arrive as a hydration
                mismatch on the half of visitors the server guessed wrong.

                `aria-hidden` on neither: a screen-reader user gets both lines,
                which is two short sentences and strictly more useful than a
                confident guess about their input device. */}
            <p className="font-mono text-xs leading-relaxed text-nori/50">
              <span className="[@media(pointer:fine)]:hidden">{game.controls.touch}</span>
              <span className="hidden [@media(pointer:fine)]:inline">{game.controls.keyboard}</span>
            </p>

            <span className="mt-auto flex items-center justify-between gap-3 pt-3">
              <span className="font-display-round text-base font-bold text-tuna">
                Play {game.title} →
              </span>
              {game.leaderboard && (
                <span className="shrink-0 border border-nori/15 px-2 py-0.5 font-mono text-[0.65rem] tracking-wide text-nori/50 uppercase">
                  Leaderboard
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
