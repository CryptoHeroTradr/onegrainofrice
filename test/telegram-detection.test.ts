import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  __resetLaunchParamsForTest,
  isTelegramMiniApp,
  parseLaunchParams,
  telegramLaunchDetected,
  telegramLaunchParams,
  telegramWebApp,
} from "../src/lib/telegram";

/**
 * MINI APP DETECTION, and the bug it is pinning.
 *
 * The old check read `window.Telegram.WebApp` and nothing else. That object is created by
 * Telegram's `telegram-web-app.js`, which this site does not load — so inside the real webview the
 * check returned FALSE, the app fell to its "ordinary browser" frame, and every Mini App user got
 * the wrong screen. The failure was invisible: "detection failed" and "this really is a browser"
 * produced identical output.
 *
 * What Telegram actually hands a page with no script at all is the launch fragment
 * (`#tgWebAppData=…`), and `tgWebAppData` IS `initData`.
 *
 * THE ASSERTION THAT MATTERS IS THE LAST DESCRIBE. Parsing a fragment correctly is not the goal —
 * producing bytes the BOT will accept is. So a fragment is built the way Telegram builds one, with
 * a real HMAC over it, and the string this parser extracts is then run through the BOT'S OWN
 * verifier. If the decoding were off by one character the signature check would fail, which is
 * exactly what would happen in production and exactly what a mocked window would not catch.
 */

afterEach(() => {
  __resetLaunchParamsForTest();
  // @ts-expect-error — test teardown of a global this app only ever reads.
  delete globalThis.window;
});

/** Stand up the globals a webview provides. `proxy` is the iOS/Android bridge object. */
function fakeWebview(hash: string, opts: { proxy?: boolean; injected?: unknown } = {}): { posted: [string, string][] } {
  const posted: [string, string][] = [];
  const win: Record<string, unknown> = {
    location: { hash },
    open: () => undefined,
  };
  if (opts.proxy) win.TelegramWebviewProxy = { postEvent: (t: string, d: string) => void posted.push([t, d]) };
  if (opts.injected) win.Telegram = { WebApp: opts.injected };
  win.parent = win; // not an iframe
  // @ts-expect-error — assigning the global this module reads.
  globalThis.window = win;
  __resetLaunchParamsForTest();
  return { posted };
}

/** A Telegram launch fragment, in Telegram's own format. */
function launchFragment(initData: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    tgWebAppData: initData,
    tgWebAppVersion: "7.10",
    tgWebAppPlatform: "ios",
    tgWebAppThemeParams: JSON.stringify({ bg_color: "#17150f", text_color: "#eae3d2" }),
    ...extra,
  });
  return `#${params.toString()}`;
}

/** initData exactly as Telegram signs it: fields sorted, joined with \n, HMAC'd under the token. */
function signedInitData(botToken: string, fields: Record<string, string>): string {
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  const qs = new URLSearchParams(fields);
  qs.set("hash", hash);
  return qs.toString();
}

// ── the regression itself ─────────────────────────────────────────────────────────────────────

describe("the webview is detected without Telegram's script", () => {
  it("finds the Mini App from the launch fragment alone — the case that was broken", () => {
    // No `window.Telegram`, because nothing creates it. This is the real production shape.
    fakeWebview(launchFragment("user=%7B%22id%22%3A42%7D&auth_date=1700000000&hash=abc"));
    expect(isTelegramMiniApp()).toBe(true);
    expect(telegramWebApp()?.platform).toBe("ios");
    expect(telegramWebApp()?.version).toBe("7.10");
  });

  it("would have failed the old way — the object it used to look for is genuinely absent", () => {
    fakeWebview(launchFragment("user=%7B%22id%22%3A42%7D&auth_date=1&hash=abc"));
    expect((globalThis.window as unknown as { Telegram?: unknown }).Telegram).toBeUndefined();
  });

  it("prefers the injected object when a client or a script does provide one", () => {
    // More complete than the shim; if it ever exists it should win.
    fakeWebview(launchFragment("from=fragment&hash=x"), {
      injected: { initData: "from=injected&hash=y", platform: "tdesktop", version: "8.0" },
    });
    expect(telegramWebApp()?.initData).toBe("from=injected&hash=y");
    expect(telegramWebApp()?.platform).toBe("tdesktop");
  });
});

describe("an ordinary browser is still an ordinary browser", () => {
  it("no fragment, no Telegram", () => {
    fakeWebview("");
    expect(isTelegramMiniApp()).toBe(false);
    expect(telegramLaunchDetected()).toBe(false);
    expect(telegramWebApp()).toBeNull();
  });

  it("an unrelated fragment is not a launch", () => {
    // A scroll anchor or another app's state must not be mistaken for a Mini App session.
    for (const hash of ["#pricing", "#a=1&b=2", "#access_token=xyz"]) {
      fakeWebview(hash);
      expect(isTelegramMiniApp(), hash).toBe(false);
      expect(telegramLaunchDetected(), hash).toBe(false);
    }
  });

  it("a Telegram IN-APP BROWSER session — launch signals, no identity — still uses the web frame", () => {
    // Telegram opens ordinary links in a webview too. There is no Mini App identity there, and a
    // wallet DOES work, so the web frame is the right answer.
    fakeWebview("", { proxy: true });
    expect(isTelegramMiniApp()).toBe(false);
    // ...but it is now DISTINGUISHABLE from a plain browser, which is what makes the failure
    // legible instead of silent.
    expect(telegramLaunchDetected()).toBe(true);
  });

  it("a launch with an EMPTY tgWebAppData is the same case", () => {
    fakeWebview(launchFragment(""));
    expect(isTelegramMiniApp()).toBe(false);
    expect(telegramLaunchDetected()).toBe(true);
  });
});

describe("the fragment is read once and kept", () => {
  it("survives the URL being rewritten afterwards", () => {
    // A router push or a scroll-to-anchor takes the fragment away, and there is no second launch
    // to read it back from. The snapshot is why a later render still knows who we are.
    fakeWebview(launchFragment("user=%7B%22id%22%3A7%7D&hash=abc"));
    expect(isTelegramMiniApp()).toBe(true);
    // Simulating the fragment being cleared by a later navigation.
    (globalThis.window as unknown as { location: { hash: string } }).location.hash = "";
    expect(isTelegramMiniApp()).toBe(true);
    expect(telegramLaunchParams().initData).toContain("user=");
  });
});

describe("commands reach the client over Telegram's own transport", () => {
  it("ready and expand post the documented events", () => {
    // `expand()` silently no-oping is why the Mini App opened as a half-height sheet: the old code
    // called it on a null object.
    const { posted } = fakeWebview(launchFragment("user=1&hash=a"), { proxy: true });
    const wa = telegramWebApp()!;
    wa.ready();
    wa.expand();
    expect(posted.map(([t]) => t)).toEqual(["web_app_ready", "web_app_expand"]);
  });

  it("the hand-off asks Telegram to leave the webview", () => {
    const { posted } = fakeWebview(launchFragment("user=1&hash=a"), { proxy: true });
    telegramWebApp()!.openLink("https://1grainofrice.com/onegrainofrice/dca?per=1");
    const [type, data] = posted.at(-1) as [string, string];
    expect(type).toBe("web_app_open_link");
    expect(JSON.parse(data)).toMatchObject({ url: "https://1grainofrice.com/onegrainofrice/dca?per=1" });
  });

  it("falls back to a normal navigation when no transport answers", () => {
    // The hand-off is the one command that must not swallow a tap: a user with no way out of the
    // webview has no way to sign, which is the whole point of the button.
    let opened: string | null = null;
    fakeWebview(launchFragment("user=1&hash=a"));
    // @ts-expect-error — capturing the fallback.
    globalThis.window.open = (u: string) => void (opened = u);
    telegramWebApp()!.openLink("https://example.test/x");
    expect(opened).toBe("https://example.test/x");
  });
});

// ── the one that proves the bytes are right ───────────────────────────────────────────────────

describe("the extracted initData is what the BOT accepts", () => {
  const BOT_VERIFIER = "/home/deploy/ricebuybot-src/src/site-bridge/init-data.ts";
  const TOKEN = "7654321:AAH-fake-bot-token-for-tests-only-xyz";

  it("round-trips through the bot's real HMAC check, not a mock of it", async () => {
    if (!existsSync(BOT_VERIFIER)) return; // no bot checkout here; the parse tests above still ran

    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = signedInitData(TOKEN, {
      auth_date: authDate,
      query_id: "AAHtest",
      // The realistic case: a JSON user object full of characters that MUST survive one — and only
      // one — round of percent-decoding. Decode twice, or not at all, and the HMAC fails.
      user: JSON.stringify({ id: 4242, first_name: "Rice & Co", username: "rice_villager" }),
    });

    // Telegram puts that string into the fragment, percent-encoded. This is the exact trip.
    fakeWebview(launchFragment(initData));
    const extracted = telegramWebApp()!.initData;
    expect(extracted).toBe(initData);

    const { verifyInitData } = (await import(BOT_VERIFIER)) as {
      verifyInitData: (d: string, t: string, now?: number) => { ok: boolean; userId?: number; reason?: string };
    };
    const verdict = verifyInitData(extracted, TOKEN);
    expect(verdict.reason ?? "ok").toBe("ok");
    expect(verdict.ok).toBe(true);
    expect(verdict.userId).toBe(4242);
  });

  it("a mangled fragment fails the bot's check rather than passing quietly", async () => {
    if (!existsSync(BOT_VERIFIER)) return;
    // The name carries an `&`, which is what makes this test mean something: percent-decoded a
    // second time it splits the query string, so the data-check string the bot rebuilds no longer
    // matches what was signed. A name without one decodes idempotently and would pass either way.
    const initData = signedInitData(TOKEN, {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 4242, first_name: "Rice & Co" }),
    });
    const { verifyInitData } = (await import(BOT_VERIFIER)) as {
      verifyInitData: (d: string, t: string) => { ok: boolean; reason?: string };
    };
    // Double-decoding is the realistic mistake; it must not verify.
    expect(verifyInitData(decodeURIComponent(initData), TOKEN).ok).toBe(false);
    expect(verifyInitData(initData, TOKEN).ok).toBe(true); // the control
  });
});

// ── pure parsing ──────────────────────────────────────────────────────────────────────────────

describe("parseLaunchParams", () => {
  it("decodes exactly once, as Telegram's own parser does", () => {
    const initData = "user=%7B%22id%22%3A1%7D&auth_date=1700000000&hash=deadbeef";
    const p = parseLaunchParams(launchFragment(initData));
    expect(p.initData).toBe(initData);
    expect(p.present).toBe(true);
  });

  it("reads the platform, version and theme, and shrugs off a broken theme blob", () => {
    const p = parseLaunchParams("#tgWebAppVersion=7.0&tgWebAppPlatform=android&tgWebAppThemeParams=notjson");
    expect(p.platform).toBe("android");
    expect(p.version).toBe("7.0");
    expect(p.themeParams).toEqual({}); // cosmetic — never worth failing a launch over
    expect(p.present).toBe(true);
  });

  it("is a pure function of the fragment, with or without the leading #", () => {
    const a = parseLaunchParams("#tgWebAppData=x&tgWebAppPlatform=ios");
    const b = parseLaunchParams("tgWebAppData=x&tgWebAppPlatform=ios");
    expect(a).toEqual(b);
    expect(parseLaunchParams("")).toMatchObject({ present: false, initData: "" });
  });
});
