"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { homeNavLinks } from "@/config/home";

/**
 * The site menu: a single "🌾 Menu" button that opens a dark-green dropdown
 * holding every nav link with its emoji. This replaces the row of inline nav
 * links at ALL breakpoints (it is not a mobile-only hamburger), so the bar reads
 * the same on a phone and on a desktop.
 *
 * Colours are fixed rather than tokenised because the panel is its own surface:
 * dark green ground, white text, light gold (khaki) for the current page and for
 * hover/focus. Those three are the whole spec.
 *
 * Every link comes from `homeNavLinks` and nothing is prepended. *Phase 7,
 * 2026-08-05:* there used to be a `MENU_LINKS` const here that stuck a hardcoded
 * "🍚 Grains Game → /" entry on the front, because the Grains Game was the landing
 * page and so could not sit in the shared nav config like every other route. The
 * games now live under `/games` and the menu has one "🎮 Games" entry pointing at
 * the index, so the special case is deleted rather than repointed — a second list
 * of nav links is a second list to forget.
 */

export function SiteMenu({
  /** Rendered inside the open panel, under a divider (socials / Buy on mobile). */
  footer,
  /** Classes for the footer's divider row — e.g. "lg:hidden" to drop it on desktop. */
  footerClassName = "",
  className = "",
}: {
  footer?: ReactNode;
  footerClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // usePathname() is basePath-stripped, so it compares directly against the
  // hrefs below (which next/link re-prefixes on render).
  const pathname = usePathname();

  // Close on outside click / Escape — a dropdown that survives either feels stuck.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-haspopup="menu"
        className="flex min-h-11 items-center gap-2 rounded-md bg-[#254a24] px-3 font-mono text-sm font-bold tracking-widest text-white uppercase shadow-sm transition-colors hover:bg-[#1c3a1b] hover:text-[#f0d17a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0d17a] sm:px-4"
      >
        <span aria-hidden="true">🌾</span>
        Menu
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          id="site-menu"
          role="menu"
          aria-label="Site"
          className="absolute top-full left-0 z-50 mt-2 w-[min(17rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border border-[#f0d17a]/25 bg-[#254a24] py-1.5 text-white shadow-xl"
        >
          {homeNavLinks.map((item) => {
            // Anchored links ("/#tokenomics") never count as the current page —
            // otherwise Home and Token would both light up while you are on "/".
            const active = !item.href.includes("#") && pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 px-4 py-3 font-mono text-sm font-bold tracking-widest uppercase transition-colors hover:bg-white/10 hover:text-[#f0d17a] focus-visible:bg-white/10 focus-visible:text-[#f0d17a] focus-visible:outline-none ${
                  active ? "text-[#f0d17a]" : "text-white"
                }`}
              >
                <span aria-hidden="true" className="text-base">
                  {item.emoji}
                </span>
                {item.label}
              </Link>
            );
          })}

          {footer && (
            <div className={`mt-1.5 border-t border-white/15 px-4 py-3 ${footerClassName}`}>
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
