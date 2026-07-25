"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2, Send, Share2 } from "lucide-react";
import type { CountryTotal } from "@/hooks/useGrainsSocket";

/**
 * "Share my rice" — opens a small popover with one-tap share to X or Telegram,
 * plus a copy-link fallback.
 *
 * We deliberately use web intent URLs (window.open) rather than the Web Share
 * API / clipboard API: this site is served over plain HTTP, where both of those
 * are blocked (secure-context only) — which is why the old button appeared to do
 * nothing. Intent URLs work everywhere.
 */
function XGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function ShareButton({
  you,
  yourCountry,
  rank,
  className,
}: {
  you: number;
  yourCountry: CountryTotal | null;
  rank: number | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function buildText(): string {
    const grains = you.toLocaleString("en-US");
    let s = `I've planted ${grains} grains of $RICE 🌾`;
    if (yourCountry && yourCountry.name !== "Unknown" && yourCountry.code !== "XX") {
      s += rank ? ` for ${yourCountry.name} (#${rank} worldwide)` : ` for ${yourCountry.name}`;
    }
    return `${s}. Add yours:`;
  }

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  function openIntent(href: string) {
    window.open(href, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  function shareX() {
    const text = encodeURIComponent(buildText());
    const url = encodeURIComponent(shareUrl);
    openIntent(`https://twitter.com/intent/tweet?text=${text}&url=${url}`);
  }

  function shareTelegram() {
    const text = encodeURIComponent(buildText());
    const url = encodeURIComponent(shareUrl);
    openIntent(`https://t.me/share/url?url=${url}&text=${text}`);
  }

  async function copyLink() {
    const payload = `${buildText()} ${shareUrl}`.trim();
    let ok = false;
    try {
      // Works only in secure contexts; falls back below on HTTP.
      await navigator.clipboard.writeText(payload);
      ok = true;
    } catch {
      ok = legacyCopy(payload);
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Share my rice total"
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-olive-deep/30 bg-bone/80 px-3 py-1.5 font-mono text-xs font-semibold text-olive-deep shadow-sm backdrop-blur transition-colors hover:bg-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
      >
        {copied ? (
          <>
            <Check size={14} aria-hidden="true" /> Link copied!
          </>
        ) : (
          <>
            <Share2 size={14} aria-hidden="true" /> Share my rice
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-2xl border border-olive-deep/20 bg-bone/95 p-1 shadow-xl backdrop-blur"
        >
          <MenuItem onClick={shareX} icon={<XGlyph />}>
            Share on X
          </MenuItem>
          <MenuItem onClick={shareTelegram} icon={<Send size={15} aria-hidden="true" />}>
            Share on Telegram
          </MenuItem>
          <MenuItem onClick={copyLink} icon={<Link2 size={15} aria-hidden="true" />}>
            Copy link
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left font-sans text-sm text-ink transition-colors hover:bg-khaki/30 focus-visible:bg-khaki/30 focus-visible:outline-none"
    >
      <span className="flex w-4 justify-center text-olive-deep">{icon}</span>
      {children}
    </button>
  );
}

/** Clipboard fallback for insecure (HTTP) contexts. */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
