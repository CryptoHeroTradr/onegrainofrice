/**
 * Telegram Mini App (webview) bindings.
 *
 * THE CORRECTION AT THE HEART OF THIS FILE. It used to say that Telegram injects
 * `window.Telegram.WebApp` into the webview itself, and read only that. It does not. That object is
 * created by Telegram's own `telegram-web-app.js`, which this site deliberately does not load — and
 * the deliberate part is still right: a remote <script> from a third-party origin, in the critical
 * path of the page where a user approves spending their money, is a trade this project does not
 * make. What was wrong was the conclusion drawn from it. Without that script the object simply does
 * not exist, so the detection returned false INSIDE Telegram, the app fell through to its
 * "ordinary browser" frame, and it rendered the wrong screen to every Mini App user.
 *
 * WHAT TELEGRAM ACTUALLY PROVIDES, with no script at all:
 *
 *   * THE LAUNCH PARAMETERS, in the URL fragment: `#tgWebAppData=…&tgWebAppVersion=…&
 *     tgWebAppPlatform=…&tgWebAppThemeParams=…`. `tgWebAppData` IS `initData` — the same signed
 *     blob the official script would hand back, because parsing this fragment is exactly what that
 *     script does with it.
 *   * `window.TelegramWebviewProxy` (iOS/Android), `window.external.notify` (desktop), or the
 *     parent frame (web) — the transport for the handful of commands this app sends.
 *
 * So this file reads what Telegram gives, in Telegram's documented format, and builds the small
 * typed surface the app already used. No third-party origin, no SDK, and the detection now answers
 * the question it was always meant to answer.
 *
 * NOTHING HERE IS TRUSTED, and that is unchanged. `initData` is a signed blob whose signature can
 * only be checked with the bot token — which lives on the bot, not on this site, and must never
 * live here. The site treats it as an opaque string to forward. Reading it out of the fragment
 * rather than out of an injected object changes nothing about that: a fragment is as forgeable as a
 * global, both are the user's to edit, and the bot's HMAC is what makes either of them mean
 * anything. A client that decided for itself who the user was would be a client anyone could edit.
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

interface WebviewProxy {
  postEvent?(eventType: string, eventData: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
    TelegramWebviewProxy?: WebviewProxy;
    // `window.external` is already declared by lib.dom as `External`, so it cannot be augmented
    // here; the desktop client's `notify` is reached through a narrow cast in `postEvent`.
  }
}

/** The launch parameters Telegram puts in the fragment. All optional — absent outside Telegram. */
export interface TelegramLaunchParams {
  /** `tgWebAppData` — this IS initData. Empty when Telegram launched us without an identity. */
  readonly initData: string;
  readonly version: string;
  readonly platform: string;
  readonly themeParams: Record<string, string>;
  /** True when the fragment carried ANY `tgWebApp*` parameter, identity or not. */
  readonly present: boolean;
}

/**
 * SNAPSHOTTED ONCE, at first read.
 *
 * The fragment is fragile: a router push, a scroll-to-anchor, or anything that rewrites the URL
 * takes it away, and it never comes back — there is no second launch to re-read it from. The
 * official script snapshots for the same reason. Nothing is persisted anywhere; this is one
 * module-scoped value that dies with the page, not a stored identity.
 */
let snapshot: TelegramLaunchParams | null = null;

const EMPTY: TelegramLaunchParams = {
  initData: "",
  version: "",
  platform: "",
  themeParams: {},
  present: false,
};

export function telegramLaunchParams(): TelegramLaunchParams {
  if (snapshot) return snapshot;
  if (typeof window === "undefined") return EMPTY; // SSR: there is no fragment to read
  snapshot = parseLaunchParams(window.location.hash);
  return snapshot;
}

/**
 * Parse a location fragment into launch parameters. Pure; exported for test.
 *
 * `URLSearchParams` decodes exactly as Telegram's own parser does (percent-decoding, and `+` as a
 * space), so `tgWebAppData` comes out byte-identical to what the official script would expose —
 * which matters more than it looks: the bot recomputes an HMAC over these bytes, and one character
 * of difference is a 401 rather than a visible error.
 */
export function parseLaunchParams(hash: string): TelegramLaunchParams {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.length === 0) return EMPTY;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return EMPTY;
  }

  // A fragment can carry anything (a scroll anchor, another app's state). Only a `tgWebApp*` key
  // means Telegram launched this page.
  let present = false;
  for (const key of params.keys()) {
    if (key.startsWith("tgWebApp")) {
      present = true;
      break;
    }
  }
  if (!present) return EMPTY;

  let themeParams: Record<string, string> = {};
  const rawTheme = params.get("tgWebAppThemeParams");
  if (rawTheme) {
    try {
      themeParams = JSON.parse(rawTheme) as Record<string, string>;
    } catch {
      themeParams = {}; // cosmetic; never worth failing a launch over
    }
  }

  return {
    initData: params.get("tgWebAppData") ?? "",
    version: params.get("tgWebAppVersion") ?? "",
    platform: params.get("tgWebAppPlatform") ?? "",
    themeParams,
    present: true,
  };
}

/**
 * Send one command to the Telegram client, over whichever transport this platform provides.
 *
 * Three transports, all of them Telegram's own, tried in the order the official script tries them.
 * If none answers the command is dropped — the right outcome for `ready`/`expand` (cosmetic) and
 * compensated for in `openLink` (not cosmetic at all).
 */
function postEvent(eventType: string, eventData: Record<string, unknown> = {}): boolean {
  if (typeof window === "undefined") return false;
  const proxy = window.TelegramWebviewProxy;
  if (typeof proxy?.postEvent === "function") {
    proxy.postEvent(eventType, JSON.stringify(eventData));
    return true;
  }
  const desktop = window.external as unknown as { notify?(payload: string): void } | undefined;
  if (typeof desktop?.notify === "function") {
    desktop.notify(JSON.stringify({ eventType, eventData }));
    return true;
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(JSON.stringify({ eventType, eventData }), "*");
    return true;
  }
  return false;
}

/**
 * The WebApp surface, from whichever source has it.
 *
 * The injected object wins when it exists — if a future page ever does load Telegram's script, or a
 * client injects one, that implementation is more complete than this one and should be preferred.
 * Otherwise the launch parameters are assembled into the same shape. Null in an ordinary browser,
 * and always null during SSR.
 */
export function telegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;

  const injected = window.Telegram?.WebApp;
  if (injected) return injected;

  const p = telegramLaunchParams();
  if (!p.present) return null;

  return {
    initData: p.initData,
    version: p.version,
    platform: p.platform,
    colorScheme: p.themeParams.bg_color && isDark(p.themeParams.bg_color) ? "dark" : "light",
    themeParams: p.themeParams,
    ready: () => void postEvent("web_app_ready"),
    expand: () => void postEvent("web_app_expand"),
    close: () => void postEvent("web_app_close"),
    openLink: (url: string, options?: { try_instant_view?: boolean }) => {
      // THE HAND-OFF, and the one command that must not silently do nothing: this is how a user
      // gets from the webview (no wallet) to a real browser (their wallet). `web_app_open_link`
      // leaves Telegram; if no transport answers, a plain window.open at least moves them somewhere
      // rather than swallowing the tap.
      const sent = postEvent("web_app_open_link", {
        url,
        try_instant_view: options?.try_instant_view ?? false,
      });
      if (!sent) window.open(url, "_blank", "noopener,noreferrer");
    },
  };
}

/** Rough light/dark read of a theme colour. Cosmetic only. */
function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1] as string, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/**
 * Are we inside a Telegram Mini App, with an identity we can forward?
 *
 * Unchanged in meaning: a WebApp surface AND a non-empty `initData`. Telegram also opens ordinary
 * in-app browser sessions where there is no Mini App identity, and those must fall through to the
 * web frame, where a wallet actually works.
 */
export function isTelegramMiniApp(): boolean {
  const wa = telegramWebApp();
  return wa != null && typeof wa.initData === "string" && wa.initData.length > 0;
}

/**
 * Did Telegram launch this page, whether or not it gave us an identity?
 *
 * The gap between this and {@link isTelegramMiniApp} is the gap between "not in Telegram" and "in
 * Telegram, but something is wrong" — and the reason this bug survived is that those two looked
 * identical from the outside. When this is true and that one is false, the app has something to
 * say instead of a wrong frame to render silently.
 */
export function telegramLaunchDetected(): boolean {
  if (typeof window === "undefined") return false;
  if (window.Telegram?.WebApp) return true;
  if (typeof window.TelegramWebviewProxy?.postEvent === "function") return true;
  return telegramLaunchParams().present;
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

/** Test seam: drop the snapshot so a test can present a different fragment. Never called by the app. */
export function __resetLaunchParamsForTest(): void {
  snapshot = null;
}
