"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";
import { homeNavLinks } from "@/config/home";
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
 * Sticky nav: transparent over the hero, then a solid paper bar once scrolled.
 *
 * Desktop (lg+): logo · Grains Game · section links | socials · contract · mute · Buy.
 * Mobile: logo · contract+copy · mute · hamburger — the hamburger menu holds
 * everything else (Grains Game, Memes, PFP & Meme Gen, Token, socials, Buy).
 *
 * "🍚 Grains Game" points at "/" — the landing page IS the clicker game (the
 * main site lives at /home), so it's a next/link route, not a section anchor.
 */
export function JourneyNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pour } = useRice();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || open
          ? "translate-y-0 border-b border-ink/15 bg-steamed/95 text-ink backdrop-blur-sm"
          : "-translate-y-1 border-b border-transparent bg-transparent text-bone"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6 lg:h-24">
        <div className="flex min-w-0 items-center gap-6">
          <a
            href={asset("/home")}
            className="whitespace-nowrap font-display-round text-sm font-bold tracking-tight sm:text-base lg:text-lg"
          >
            {site.nav.logo}
          </a>
          {/* Desktop nav links: the grains game first, then the section anchors. */}
          <nav aria-label="Main" className="hidden items-center gap-5 lg:flex">
            <Link
              href="/"
              className="font-mono text-sm font-bold tracking-widest uppercase transition-colors hover:text-tuna"
            >
              🍚 Grains Game
            </Link>
            {homeNavLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="font-mono text-sm font-bold tracking-widest uppercase transition-colors hover:text-tuna"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
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
          <LanguageSwitcher className="hidden lg:block" />
          <SoundToggle className={scrolled || open ? "text-ink/70 hover:text-ink" : "text-bone/80 hover:text-bone"} />
          {/* Buy — desktop only (in the hamburger on mobile). A real anchor to
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
              className="h-16 w-auto sm:h-20"
            />
          </a>
          {/* Hamburger — mobile only. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className={`flex h-10 w-10 shrink-0 items-center justify-center lg:hidden ${
              scrolled || open ? "text-ink" : "text-bone"
            }`}
          >
            {open ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile menu — GRAINS, section links, socials, and the Buy CTA. */}
      {open && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="border-t border-ink/10 bg-steamed/95 px-4 py-3 text-ink backdrop-blur lg:hidden"
        >
          <div className="flex flex-col">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="py-2.5 font-mono text-sm font-bold tracking-widest text-ink/80 uppercase"
            >
              🍚 Grains Game
            </Link>
            {homeNavLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="py-2.5 font-mono text-sm font-bold tracking-widest text-ink/80 uppercase"
              >
                {item.label}
              </a>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink/10 pt-3">
            <div className="flex items-center gap-2">
              <SocialLinks className="flex items-center gap-2" linkClassName={NAV_SOCIAL_CLASS} />
              <LanguageSwitcher />
            </div>
            <a
              href={site.buyUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center bg-olive px-5 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep"
            >
              BUY {site.ticker}
            </a>
          </div>
        </nav>
      )}
    </header>
  );
}
