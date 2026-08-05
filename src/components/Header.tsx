"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, Menu, X } from "lucide-react";
import { site } from "@/config/site";

const NAV = [
  { label: "ABOUT", href: "#about" },
  { label: "IMPACT", href: "#impact" },
  { label: "TOKENOMICS", href: "#tokenomics" },
  { label: "FAQ", href: "#faq" },
];

/**
 * The Grains Game, from the /classic header.
 *
 * **This link was broken, and had been for a long time.** *Fixed Phase 7,
 * 2026-08-05.* The two GRAINS links here disagreed with each other: the desktop
 * one pointed at "/" and the mobile one at "/grains", which has never been a page
 * — `src/app/grains/` holds only `session/route.ts`, the cookie minter. So every
 * visitor who opened the /classic menu on a phone and tapped GRAINS got the 404.
 * Verified against the live process before the fix: `/grains` → 404, `/` → 200.
 *
 * Both now point at one constant, and the constant is a route that exists. This
 * phase is what made the correct target exist: the game moved off "/" (which is
 * the home page now) and onto /games/grains, so leaving the desktop link alone
 * would have quietly repointed it at the home page instead.
 */
const GRAINS_HREF = "/games/grains";

export function Header() {
  const [open, setOpen] = useState(false);
  // Path without basePath, so it compares directly against GRAINS_HREF.
  const pathname = usePathname();
  const onGrains = pathname === GRAINS_HREF;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-ink/15 bg-paper/90 text-ink backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4 px-4 sm:px-6">
        {/* Wordmark + nav grouped together on the left */}
        <div className="flex items-center gap-6">
          <a href="#top" className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm border-2 border-ink/70 text-olive">
              <Heart size={15} fill="currentColor" aria-hidden="true" />
            </span>
            {site.ticker}
          </a>

          <nav aria-label="Main" className="hidden items-center gap-5 md:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="font-display text-sm font-bold tracking-wide text-ink/80 uppercase transition-colors hover:text-olive"
              >
                {item.label}
              </a>
            ))}
            {/* Game route — basePath auto-applied by next/link. */}
            <Link
              href={GRAINS_HREF}
              aria-current={onGrains ? "page" : undefined}
              className={`font-display text-sm font-bold tracking-wide uppercase transition-colors hover:text-olive ${
                onGrains ? "text-olive" : "text-ink/80"
              }`}
            >
              GRAINS
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={site.buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center bg-olive px-4 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep sm:px-5"
          >
            BUY {site.ticker}
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex min-h-11 min-w-11 items-center justify-center text-ink md:hidden"
          >
            {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          aria-label="Main mobile"
          className="border-t border-ink/15 bg-paper px-4 py-2 md:hidden"
        >
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block py-3 font-mono text-sm font-bold tracking-widest text-ink/80"
            >
              {item.label}
            </a>
          ))}
          <Link
            href={GRAINS_HREF}
            onClick={() => setOpen(false)}
            aria-current={onGrains ? "page" : undefined}
            className={`block py-3 font-mono text-sm font-bold tracking-widest ${
              onGrains ? "text-olive" : "text-ink/80"
            }`}
          >
            🍚 GRAINS
          </Link>
        </nav>
      )}
    </header>
  );
}
