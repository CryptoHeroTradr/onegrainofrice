"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart } from "lucide-react";
import { site } from "@/config/site";
import { gamesNavLinks } from "@/config/games";
import { asset } from "@/lib/asset";
import { isPlaySurface } from "@/lib/playSurfaces";
import { SiteMenu } from "@/components/journey/SiteMenu";
import { useRice } from "@/components/rice/RiceParticles";
import { playPour } from "@/lib/sound";
import { SoundToggle } from "@/components/eggs/SoundToggle";
import { SocialLinks } from "@/components/primitives/SocialLinks";
import { ContractChip } from "@/components/grains/ContractChip";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

// Compact social pill for the nav — readable over the hero image and the solid
// bar alike (self-contained bone background, olive glyph).
const NAV_SOCIAL_CLASS =
  "flex h-9 w-9 items-center justify-center rounded-full border border-olive-deep/30 bg-bone/80 text-olive-deep shadow-sm backdrop-blur transition-colors hover:bg-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive";

/**
 * Sticky nav: a solid paper bar, or — on a page that opts in — transparent over
 * its dark hero until you scroll past it.
 *
 * **SOLID IS THE DEFAULT, AND `overHero` IS OPT-IN.** *2026-08-05, fixing /games.*
 * This used to be the other way round: every page got the transparent state and
 * resolved it on scroll. That is only ever correct over something DARK, because
 * the transparent state paints the bar's text in `bone` (#f4efe2) — and nothing
 * in the component asked whether there was anything dark behind it. /games has a
 * `bg-steamed` (#fbf7ee) top, so its logo, wordmark and Charity label rendered at
 * a measured 1.03:1 against their own background: present, focusable, readable by
 * a screen reader, and invisible.
 *
 * Scroll did not save it, for a reason worth writing down because it is not the
 * obvious one. /games IS scrollable — 1321px of content in a 900px viewport — but
 * the solid state needs `scrollY > innerHeight * 0.6` = 540px and the page only
 * has 421px of scroll range. "Short enough to never scroll" and "short enough to
 * never scroll ENOUGH" fail identically and the second is much easier to ship.
 *
 * So the question the component now asks is the real one — *is there a dark hero
 * behind me?* — and it asks the page, which is the only thing that knows. The
 * default is the safe answer: a page that says nothing gets a bar that is legible
 * on any background. The failure mode of forgetting to opt IN is an ugly solid bar
 * over a hero; the failure mode of the old default was an invisible nav.
 *
 * The four pages that pass `overHero` (`/`, `/pfp`, `/charity`, `/memes`) were all
 * measured dark behind the bar at the time of the change.
 *
 * Every route link lives in the "🌾 Menu" dropdown (see SiteMenu) at ALL
 * breakpoints — there is no row of inline links any more, and no mobile-only
 * hamburger. The bar itself is: logo · 🌾 Menu | socials · contract · language ·
 * mute · Buy, with the last four collapsing into the menu's footer on mobile.
 *
 * The bar carries one route link of its own — ❤️ Charity — because that page is
 * the site's whole point and a dropdown made it the hardest thing to reach. Every
 * other route lives in the menu.
 *
 * *Phase 7, 2026-08-05:* the note that used to sit here explained that the menu's
 * "🍚 Grains Game" pointed at "/" because the landing page WAS the clicker game.
 * It no longer is — "/" is the home page, the games are under `/games`, and the
 * menu has a single 🎮 Games entry. The Grains Game renders no nav of its own, so
 * this bar still never appears on it.
 *
 * ON A PLAY SURFACE IT IS A DIFFERENT BAR, and the differences are all forced
 * rather than styled (added Phase 5.6, when /chomp got the nav):
 *
 *  - **It is IN FLOW, not `fixed`.** A game page is one viewport tall and owns
 *    every pixel of it; a fixed bar would float over the board's own header and
 *    the board would still be sized as though the bar were not there.
 *  - **It is solid immediately.** The transparent-over-hero state resolves on
 *    scroll, and a page that never scrolls would sit in it forever — a bar with
 *    no ground, over a black game.
 *  - **It is shorter** — a flat 56px — because the row it costs comes off the maze.
 *    Measured in the plan's §9.1: on a 1080p desktop the board goes from 27px tiles
 *    to 24px. On a portrait phone it costs nothing, because portrait is width-bound.
 *  - **It is gone below 520px of viewport height.** On a landscape phone the bar is
 *    a fifth of what is left for the board, and hiding it puts the board back to
 *    exactly its pre-nav size.
 *  - **No `<LanguageSwitcher>`.** Translation is scoped off play surfaces
 *    (`src/lib/playSurfaces.ts`), so the context there is inert by design and a
 *    language control would be a switch wired to nothing. The spec says this in
 *    as many words; see its Acceptance criteria.
 *
 * The scroll listener is skipped there too — not for cost, but because binding a
 * handler that can never fire is how a reader concludes the state means something.
 */
export function JourneyNav({
  /**
   * This page paints something DARK behind the bar (a hero image or a dark
   * section) for at least the first screenful, so the bar may start transparent
   * and resolve to solid on scroll. Leave it off unless that is true — see the
   * note above for what the wrong answer costs in each direction.
   */
  overHero = false,
}: {
  overHero?: boolean;
} = {}) {
  const [scrolled, setScrolled] = useState(false);
  const { pour } = useRice();
  // usePathname() is basePath-stripped, so it compares directly against the
  // plain routes in PLAY_SURFACE_ROUTES.
  const onPlaySurface = isPlaySurface(usePathname());
  // A play surface is solid for its own reasons (see above) and never floats over
  // a hero, so it wins regardless of what the page asked for.
  const canBeTransparent = overHero && !onPlaySurface;

  useEffect(() => {
    // Same argument as the play surface: with no transparent state to leave,
    // there is nothing for a scroll handler to decide.
    if (!canBeTransparent) return;
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [canBeTransparent]);

  const solid = !canBeTransparent || scrolled;

  return (
    <header
      className={
        onPlaySurface
          ? // Gone below 520px of viewport height — a landscape phone. There the bar
            // is a fifth of the board's remaining height and the game is already
            // fighting for every row; the page's own header link still leaves.
            "relative border-b border-ink/15 bg-steamed/95 text-ink [@media(max-height:520px)]:hidden"
          : `fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
              solid
                ? "translate-y-0 border-b border-ink/15 bg-steamed/95 text-ink backdrop-blur-sm"
                : "-translate-y-1 border-b border-transparent bg-transparent text-bone"
            }`
      }
    >
      <div
        className={`mx-auto flex max-w-[1180px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6 ${
          // Flat 56px on a play surface at every width — the `lg` step exists on the
          // marketing pages to give the Buy art room, and here every one of those
          // pixels comes off the maze.
          onPlaySurface ? "h-14" : "h-16 lg:h-24"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-4 lg:gap-6">
          {/* The wordmark goes home, and home is now `/`. A <Link> rather than the
              `asset("/home")` anchor this used to be: asset() exists to prefix and
              CACHE-STAMP static files, so it was minting `/home?v=<build>` for a
              page navigation — a fresh URL for the home page on every deploy. Link
              applies the basePath by itself and stamps nothing. */}
          <Link
            href="/"
            className="whitespace-nowrap font-display-round text-sm font-bold tracking-tight sm:text-base lg:text-lg"
          >
            {site.nav.logo}
          </Link>
          {/* Every nav link lives here, at every breakpoint. The footer slot
              carries the items the bar drops below lg (socials, language, Buy). */}
          <SiteMenu
            id="site-menu"
            footerClassName="lg:hidden"
            footer={
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <SocialLinks className="flex items-center gap-2" linkClassName={NAV_SOCIAL_CLASS} />
                  {!onPlaySurface && <LanguageSwitcher />}
                </div>
                <a
                  href={site.buyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center bg-olive px-5 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep"
                >
                  BUY {site.ticker}
                </a>
              </div>
            }
          />
          {/* A second dropdown, the SAME component with different props (2026-08-05).
              The 🌾 Menu's one "🎮 Games" row reached the /games index and the three
              games were a further click in; this puts them in the bar. The index is
              still one row up in 🌾 Menu, so nothing lost a route.

              It sits next to the menu rather than in the right-hand cluster because
              that cluster is where the site's non-route controls live (contract,
              language, mute, Buy) and this is navigation.

              Dropped below `sm`: on a phone the bar is already carrying the logo,
              🌾 Menu, Charity, the contract chip and the mute toggle, and 🌾 Menu's
              own Games row still reaches all three from there. */}
          <SiteMenu
            id="games-menu"
            emoji="🎮"
            label="Games"
            items={gamesNavLinks}
            className="hidden sm:block"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Charity — a real link in the BAR, not only a row in the 🌾 Menu.
              Added Phase 7 (2026-08-05): the charity page is the one thing on this
              site that is not a meme or a game, and burying it one click into a
              dropdown made it the hardest page to reach. The heart is the site's
              own charity mark (the /classic header uses the same lucide Heart).

              It keeps its label from `sm:` up and collapses to the heart alone on a
              phone, where the bar is already carrying the logo, the menu, the
              contract chip and the mute toggle. The label is what makes it a link
              to a page rather than a mystery glyph, so it is dropped last and only
              where there is genuinely no room. */}
          <Link
            href="/charity"
            aria-label="Charity"
            className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap px-2 font-display text-sm font-bold tracking-wide uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive ${
              solid ? "text-ink/80 hover:text-tuna" : "text-bone/90 hover:text-bone"
            }`}
          >
            <Heart size={16} fill="currentColor" aria-hidden="true" className="text-tuna" />
            <span className="hidden sm:inline">Charity</span>
          </Link>
          {/* Socials — desktop only (in the hamburger on mobile). */}
          <SocialLinks className="hidden items-center gap-2 lg:flex" linkClassName={NAV_SOCIAL_CLASS} />
          {/* Contract + copy — shown on every breakpoint. */}
          <ContractChip
            address={site.tokenAddress}
            label={site.ticker}
            chain={site.token.chain}
            variant="compact"
            className="inline-flex"
          />
          {!onPlaySurface && <LanguageSwitcher className="hidden lg:block" />}
          <SoundToggle className={solid ? "text-ink/70 hover:text-ink" : "text-bone/80 hover:text-bone"} />
          {/* Buy — desktop only (in the 🌾 Menu footer on mobile). A real anchor to
              the Jupiter swap (site.buyUrl), matching the hero's Buy image, with
              the same decorative rice pour on click. */}
          <a
            href={site.buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${site.hero.ctaPrimary} on Jupiter`}
            onClick={(e) => {
              pour({ x: e.clientX, y: e.clientY, count: 20 });
              playPour();
            }}
            className="hidden items-center transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep lg:inline-flex"
          >
            <Image
              src={asset("/buyrice.png")}
              alt={site.hero.ctaPrimary}
              width={1536}
              height={1024}
              className={onPlaySurface ? "h-10 w-auto lg:h-12" : "h-16 w-auto sm:h-20"}
            />
          </a>
        </div>
      </div>
    </header>
  );
}
