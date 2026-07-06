"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { site } from "@/config/site";
import { RiceButton } from "@/components/rice/RiceButton";
import { SoundToggle } from "@/components/eggs/SoundToggle";

/**
 * Sticky nav: transparent over the hero, then slides in with a solid paper bar
 * once the hero is scrolled past. Village → the RiceDAO game URL (external);
 * a small "classic site" link points at the preserved homepage.
 */
export function JourneyNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "translate-y-0 border-b border-ink/15 bg-steamed/90 text-ink backdrop-blur-sm"
          : "-translate-y-1 border-b border-transparent bg-transparent text-bone"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <a href="#top" className="font-display-round text-lg font-bold tracking-tight">
            {site.nav.logo}
          </a>
          <nav aria-label="Main" className="hidden items-center gap-5 md:flex">
            {site.nav.links.map((item) => {
              const href = item.href === "village" ? site.villageUrl : item.href;
              const external = item.href === "village";
              return (
                <a
                  key={item.label}
                  href={href}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="font-mono text-sm font-bold tracking-widest uppercase transition-colors hover:text-tuna"
                >
                  {item.label}
                </a>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <SoundToggle className={scrolled ? "text-ink/70 hover:text-ink" : "text-bone/80 hover:text-bone"} />
          <Link
            href={site.classicUrl}
            className={`hidden font-mono text-xs tracking-wider underline underline-offset-4 sm:inline ${
              scrolled ? "text-ink/50 hover:text-ink" : "text-bone/60 hover:text-bone"
            }`}
          >
            {site.nav.classicLabel}
          </Link>
          <RiceButton
            pourCount={20}
            aria-label={`${site.hero.ctaPrimary} — pours rice`}
            onClick={() => window.open(site.buyUrl, "_blank", "noopener,noreferrer")}
            className="min-h-11 bg-olive px-4 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep sm:px-5"
          >
            {site.hero.ctaPrimary}
          </RiceButton>
        </div>
      </div>
    </header>
  );
}
