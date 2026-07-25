"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import { LANGUAGES, findLanguage, SOURCE_LANG } from "@/lib/i18n/languages";
import { useTranslate } from "./TranslateProvider";

/**
 * Nav translate control: a globe button showing the current language, opening a
 * searchable list of every language the widget supports.
 *
 * `notranslate` on the whole panel — without it the translator rewrites the
 * language names themselves, and you get a list where every entry reads "Spanish"
 * in Spanish. The names must stay in their own script for anyone to find theirs.
 */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { lang, setLang } = useTranslate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = findLanguage(lang) ?? findLanguage(SOURCE_LANG)!;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter(
      (l) =>
        l.native.toLowerCase().includes(q) ||
        l.english.toLowerCase().includes(q) ||
        l.code.toLowerCase().startsWith(q),
    );
  }, [query]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  return (
    <div ref={rootRef} className={`notranslate relative ${className}`} translate="no">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Change language — currently ${current.english}`}
        className="flex min-h-9 items-center gap-1.5 rounded-full border border-olive-deep/30 bg-bone/80 px-3 text-olive-deep shadow-sm backdrop-blur transition-colors hover:bg-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
      >
        <Globe size={16} aria-hidden="true" />
        <span className="font-mono text-xs font-bold uppercase tracking-widest">
          {current.code === SOURCE_LANG ? "EN" : current.code.toUpperCase()}
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Languages"
          className="absolute right-0 top-full z-[70] mt-2 flex max-h-[70vh] w-64 flex-col overflow-hidden rounded-2xl border border-olive-deep/20 bg-bone shadow-2xl"
        >
          <div className="border-b border-olive-deep/15 p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search languages…"
              aria-label="Search languages"
              className="w-full rounded-lg border border-olive-deep/25 bg-steamed/60 px-2.5 py-1.5 font-sans text-sm text-ink outline-none placeholder:text-olive-deep/50 focus:border-olive"
            />
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto p-1">
            {results.length === 0 && (
              <li className="px-3 py-4 text-center font-sans text-sm text-olive-deep/60">
                No match
              </li>
            )}
            {results.map((l) => {
              const active = l.code === current.code;
              return (
                <li key={l.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setOpen(false);
                      if (l.code !== current.code) setLang(l.code);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-khaki/30 ${
                      active ? "bg-khaki/40" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-sans text-sm font-semibold text-ink">
                        {l.native}
                      </span>
                      {l.native !== l.english && (
                        <span className="block truncate font-sans text-[0.7rem] text-olive-deep/60">
                          {l.english}
                        </span>
                      )}
                    </span>
                    {active && (
                      <Check size={15} aria-hidden="true" className="shrink-0 text-olive" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="border-t border-olive-deep/15 px-3 py-2 font-sans text-[0.65rem] leading-snug text-olive-deep/60">
            Machine translated. English is the original.
          </p>
        </div>
      )}
    </div>
  );
}
