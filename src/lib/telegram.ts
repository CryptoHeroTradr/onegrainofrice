/**
 * Telegram Mini App (webview) bindings.
 *
 * Telegram injects `window.Telegram.WebApp` into the webview itself — there is no SDK to install
 * and no script to load from telegram.org. That matters here: adding a remote <script> would put a
 * third-party origin in the critical path of a page whose entire selling point is that no third
 * party is in the path. So this file is a typed reader for an object that is either present (we are
 * in Telegram) or absent (we are in an ordinary browser).
 *
 * NOTHING HERE IS TRUSTED. `initData` is a signed blob, and the signature can only be checked with
 * the bot token — which lives on the bot, not on this site, and must never live here. So the site
 * treats initData as an opaque string to forward, and the ONLY thing that ever comes back is a
 * wallet address the bot has already proven belongs to that Telegram user. A client that decided
 * for itself who the user was would be a client anyone could edit.
 */

/** The slice of Telegram's WebApp API this app uses. Deliberately small. */
export interface TelegramWebApp {
  /** Signed identity blob. Opaque to us — only the bot can validate it. */
  readonly initData: string;
  readonly version: string;
  readonly platform: string;
  readonly colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  /** Open a URL in the SYSTEM browser, leaving the webview. The hand-off. */
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  close(): void;
  readonly themeParams?: Record<string, string>;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** The injected WebApp, or null in an ordinary browser (and always null during SSR). */
export function telegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/**
 * Are we inside a Telegram Mini App?
 *
 * Presence of the injected object, not a user-agent sniff. `initData` is required as well because
 * Telegram also injects the object into ordinary in-app browser sessions where there is no Mini App
 * identity — and those must fall through to the normal web frame, where a wallet actually works.
 */
export function isTelegramMiniApp(): boolean {
  const wa = telegramWebApp();
  return wa != null && typeof wa.initData === "string" && wa.initData.length > 0;
}

/**
 * Leave the webview for the system browser.
 *
 * `openLink` is the only exit that reliably lands in a REAL browser, which is the entire point of
 * the hand-off: the user needs an environment where their wallet extension or wallet app can
 * actually connect. `window.open` inside the webview would keep them in Telegram, where there is
 * still no wallet — a hand-off that hands off to the same dead end.
 *
 * Falls back to a normal navigation outside Telegram so the same button works on the web.
 */
export function openExternal(url: string): void {
  const wa = telegramWebApp();
  if (wa) {
    wa.HapticFeedback?.impactOccurred("medium");
    wa.openLink(url);
    return;
  }
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}
