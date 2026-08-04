"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { SOURCE_LANG } from "@/lib/i18n/languages";
import { isPlaySurface } from "@/lib/playSurfaces";

/**
 * Page translation, on top of the Google Translate element.
 *
 * Google's widget is driven entirely by a `googtrans` cookie of the form
 * `/<source>/<target>`, which its injected <select class="goog-te-combo"> reads.
 * We keep that mechanism but hide its UI completely (see globals.css) and put our
 * own switcher in the nav, so the site keeps its own look.
 *
 * The widget is DEPRECATED by Google (unsupported since 2018) though still free
 * and functional. Everything here is written to fail soft: if the script never
 * loads, the cookie is still set and the page simply stays in English rather than
 * breaking.
 *
 * Auto-detect: the suggestion comes from the visitor's IP country (nginx's GeoIP
 * X-Country-Code), stamped into a cookie by src/middleware.ts. It is applied ONCE, and
 * only if the visitor has never chosen for themselves — an explicit choice is
 * remembered and always wins.
 *
 * ── NOT ON PLAY SURFACES ────────────────────────────────────────────────────────
 * This is the FOURTH global provider scoped off /chomp through
 * `src/lib/playSurfaces.ts`, after the chopstick cursor, the Konami rice dump and the
 * rice-particle field — but it is the only one scoped off for a reason other than
 * "it fights the game". RICE CHOMP's spec has a hard acceptance criterion of ZERO
 * third-party network requests on the route, and this widget's script from
 * translate.google.com was the only thing violating it. It also has no business
 * being there on its own merits: the widget rewrites text nodes, which is why the
 * HUD already carries `translate="no"` to stop it mangling live score digits.
 *
 * On a play surface the children still render — this provider wraps the whole app —
 * but the script, the widget mount point and the cookie effects are all skipped, and
 * the context is the inert NOOP. So a play surface is NOT TRANSLATED, deliberately.
 * Nothing should render a <LanguageSwitcher> on one; it would be a dead control.
 *
 * One caveat, stated because it is easy to assume otherwise: `next/script` does not
 * unload a script that has already been inserted. A visitor who loads /home and then
 * client-navigates to /chomp — and /chomp is in `homeNavLinks`, so that is a normal
 * path — carries the already-loaded widget with them. The guarantee this scoping
 * gives is precise: a direct load of /chomp makes no third-party request. That is
 * also exactly what "verified in the network tab" measures.
 */

const COOKIE = "googtrans";
/** Written by src/middleware.ts from the GeoIP country header. */
const GEO_COOKIE = "rice_geo_lang";
/** Set once the visitor picks a language themselves (or dismisses the auto-pick). */
const CHOICE_KEY = "rice:lang-chosen";

interface TranslateApi {
  /** Current target language ("en" ⇒ untranslated source). */
  lang: string;
  /** Translate the page. "en" restores the original copy. */
  setLang: (code: string) => void;
  /** True once the visitor has an explicit preference (auto-detect won't fire). */
  chosen: boolean;
}

const NOOP: TranslateApi = { lang: SOURCE_LANG, setLang: () => {}, chosen: false };
const Ctx = createContext<TranslateApi>(NOOP);

export function useTranslate(): TranslateApi {
  return useContext(Ctx);
}

// --- googtrans cookie helpers ----------------------------------------------
// The cookie has to be written for BOTH the exact host and the dot-prefixed
// parent domain: the widget looks for either, and which one sticks depends on
// whether you're on the apex or a subdomain. Writing one only is the classic
// reason "it works locally but not in prod".

function readCookieLang(): string {
  if (typeof document === "undefined") return SOURCE_LANG;
  const m = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
  if (!m) return SOURCE_LANG;
  const parts = decodeURIComponent(m[1]).split("/"); // "/en/es" → ["", "en", "es"]
  return parts[2] || SOURCE_LANG;
}

function writeCookieLang(code: string): void {
  const value = `/${SOURCE_LANG}/${code}`;
  const host = window.location.hostname;
  const bare = host.replace(/^www\./, "");
  const domains = [undefined, host, `.${bare}`];
  for (const d of domains) {
    document.cookie = `${COOKIE}=${value};path=/${d ? `;domain=${d}` : ""}`;
  }
}

function clearCookieLang(): void {
  const host = window.location.hostname;
  const bare = host.replace(/^www\./, "");
  const expire = "expires=Thu, 01 Jan 1970 00:00:00 GMT";
  for (const d of [undefined, host, `.${bare}`]) {
    document.cookie = `${COOKIE}=;path=/;${expire}${d ? `;domain=${d}` : ""}`;
  }
}

function readGeoSuggestion(): string {
  if (typeof document === "undefined") return SOURCE_LANG;
  const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + GEO_COOKIE + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : SOURCE_LANG;
}

export function TranslateProvider({ children }: { children: ReactNode }) {
  // Every hook below runs unconditionally, on a play surface and off it. The route
  // check gates each effect's BODY and the render output, never the hook itself.
  const onPlaySurface = isPlaySurface(usePathname());
  const [lang, setLangState] = useState(SOURCE_LANG);
  const [chosen, setChosen] = useState(false);
  const [suggested, setSuggested] = useState(SOURCE_LANG);
  const autoRan = useRef(false);

  // Hydrate from the cookie AFTER mount — the server render is always the English
  // source, so reading this during render would desync hydration.
  useEffect(() => {
    if (onPlaySurface) return;
    setLangState(readCookieLang());
    setSuggested(readGeoSuggestion());
    try {
      setChosen(window.localStorage.getItem(CHOICE_KEY) === "1");
    } catch {
      /* storage blocked — auto-detect just re-offers next visit */
    }
  }, [onPlaySurface]);

  const setLang = useCallback((code: string) => {
    // Remember that this was a deliberate choice, so auto-detect never overrides
    // it — including the choice to go back to English.
    try {
      window.localStorage.setItem(CHOICE_KEY, "1");
    } catch {
      /* ignore */
    }
    setChosen(true);
    setLangState(code);

    if (code === SOURCE_LANG) {
      // There is no "translate back to source" — the widget rewrote the DOM in
      // place. Drop the cookie and reload to get the original copy back.
      clearCookieLang();
      window.location.reload();
      return;
    }

    writeCookieLang(code);

    // Drive the widget's hidden <select> so the page translates WITHOUT a reload.
    // If it isn't there yet (script still loading, or blocked), the cookie alone
    // is enough — reload and the widget picks it up on the way in.
    const combo = document.querySelector<HTMLSelectElement>(".goog-te-combo");
    if (combo) {
      combo.value = code;
      combo.dispatchEvent(new Event("change"));
    } else {
      window.location.reload();
    }
  }, []);

  // IP-based auto-translate: once, only for a visitor with no stored preference
  // and no cookie already in play.
  useEffect(() => {
    // Not on a play surface: the widget is not loaded there, so writing the cookie
    // would translate nothing here and quietly translate the NEXT page instead.
    if (onPlaySurface) return;
    if (autoRan.current) return;
    if (!suggested || suggested === SOURCE_LANG) return;
    if (chosen) return;
    if (readCookieLang() !== SOURCE_LANG) return; // already translated
    autoRan.current = true;

    // Set the cookie and let the widget apply it when it initialises, so a
    // first-time visitor from e.g. Brazil lands on Portuguese without a reload.
    writeCookieLang(suggested);
    setLangState(suggested);
    const combo = document.querySelector<HTMLSelectElement>(".goog-te-combo");
    if (combo) {
      combo.value = suggested;
      combo.dispatchEvent(new Event("change"));
    }
  }, [suggested, chosen, onPlaySurface]);

  // A play surface gets the children and nothing else — no script, no widget mount
  // point, no working context. See the note at the top of this file.
  if (onPlaySurface) {
    return <Ctx.Provider value={NOOP}>{children}</Ctx.Provider>;
  }

  return (
    <Ctx.Provider value={{ lang, setLang, chosen }}>
      {children}

      {/* The widget mounts into this node. It is visually hidden (globals.css);
          our nav switcher is the real UI. */}
      <div id="google_translate_element" aria-hidden="true" />

      <Script id="google-translate-init" strategy="afterInteractive">
        {`
          window.googleTranslateElementInit = function () {
            try {
              new google.translate.TranslateElement(
                { pageLanguage: '${SOURCE_LANG}', autoDisplay: false },
                'google_translate_element'
              );
            } catch (e) { /* widget unavailable — page stays in English */ }
          };
        `}
      </Script>
      <Script
        id="google-translate"
        src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"
        strategy="afterInteractive"
      />
    </Ctx.Provider>
  );
}
