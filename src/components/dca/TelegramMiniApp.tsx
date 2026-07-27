"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DcaWorkspace } from "@/components/dca/DcaWorkspace";
import { handOffUrl, WEB_FRAME, type DcaFrame, type HandOffIntent } from "@/components/dca/frame";
import { isTelegramMiniApp, openExternal, telegramWebApp } from "@/lib/telegram";
import { site } from "@/config/site";

/**
 * THE TELEGRAM MINI APP.
 *
 * THE INVARIANT, restated where it is most tempting to break: no server of ours sees a key or signs
 * anything on this path. This component runs in Telegram's webview; it reads public on-chain state
 * and composes an order. The signature comes from the user's own wallet, in a browser, always.
 *
 * WHY IT HANDS OFF INSTEAD OF CONNECTING. Telegram's webview has no browser extensions and no
 * injected wallet provider, so the Wallet Standard discovery that wallet-adapter performs finds
 * nothing at all. Phantom's own answer for Mini Apps is still "use deeplinks", and Telegram's
 * single-`startapp`-parameter limit makes the return leg of that round trip lossy — the widely-used
 * workaround is to send the user to a page outside Telegram and let them come back. That is what
 * this does, deliberately and visibly, instead of pretending to connect.
 *
 * The alternative — a server-side signer so the button could "just work" in Telegram — is the exact
 * failure this architecture exists to prevent. It would mean the bot holding a key that can spend,
 * which is send-key custody with wallet mode's label on it.
 *
 * WHAT THE MINI APP IS STILL GOOD FOR, and why it is not merely a link:
 *   * it shows the user's live orders, read straight from Jupiter by wallet address — the same
 *     read the website performs, so the two can never disagree;
 *   * it composes the order, with every rail enforced, so the hand-off carries a schedule that has
 *     already been validated against a live price and a live balance;
 *   * it needs no connection to do either, because a public address is enough for both.
 */

interface Identity {
  readonly state: "loading" | "ready" | "unlinked" | "error";
  readonly wallet: string | null;
  readonly mode: "wallet" | "key" | null;
  readonly message?: string;
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/onegrainofrice";

export function TelegramMiniApp() {
  const [identity, setIdentity] = useState<Identity>({ state: "loading", wallet: null, mode: null });
  // Resolved on the client only: `window.Telegram` cannot exist during SSR, and guessing would
  // render the wrong frame for a moment and then swap it under the user.
  const [inTelegram, setInTelegram] = useState<boolean | null>(null);

  useEffect(() => {
    const wa = telegramWebApp();
    wa?.ready();
    wa?.expand();
    setInTelegram(isTelegramMiniApp());
  }, []);

  // Ask the bot who we are. The ONLY server call this app makes, and it returns an address.
  useEffect(() => {
    if (inTelegram !== true) return;
    const wa = telegramWebApp();
    if (!wa) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/tma/wallet`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData: wa.initData }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; linked?: boolean; wallet?: string | null; mode?: "wallet" | "key"; error?: string }
          | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          setIdentity({
            state: "error",
            wallet: null,
            mode: null,
            message: data?.error ?? "Couldn't verify this Telegram session.",
          });
          return;
        }
        if (!data.linked || !data.wallet) {
          setIdentity({ state: "unlinked", wallet: null, mode: data.mode ?? null });
          return;
        }
        setIdentity({ state: "ready", wallet: data.wallet, mode: data.mode ?? null });
      } catch {
        if (!cancelled) {
          setIdentity({ state: "error", wallet: null, mode: null, message: "Couldn't reach the bot." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inTelegram]);

  const handOff = useCallback((intent: HandOffIntent) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    openExternal(handOffUrl(origin, BASE_PATH, intent));
  }, []);

  const frame: DcaFrame = useMemo(
    () => ({
      kind: "telegram",
      canSign: false,
      readOnlyOwner: identity.wallet,
      handOff,
      handOffLabel: "OPEN IN BROWSER TO SIGN ↗",
    }),
    [identity.wallet, handOff],
  );

  // Outside Telegram this route is just the website. Rendering the web frame rather than a "open
  // me in Telegram" dead end means a shared /tma link still works for whoever opens it.
  if (inTelegram === false) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
        <h1 className="font-display text-2xl font-bold text-nori">Recurring {site.ticker} buys</h1>
        <DcaWorkspace frame={WEB_FRAME} />
      </main>
    );
  }

  if (inTelegram === null) {
    return <main className="px-4 py-8 font-mono text-sm text-nori/60">Loading…</main>;
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-3 py-4">
      <header>
        <h1 className="font-display text-2xl font-bold text-nori">Your {site.ticker} DCA</h1>
        <p className="mt-1 font-mono text-xs leading-relaxed text-nori/70">
          Runs on Jupiter, on-chain, from your own wallet. I hold no key and can&apos;t sign for
          you — approving happens in your wallet, in your browser.
        </p>
      </header>

      {identity.state === "loading" && (
        <p className="font-mono text-sm font-bold text-nori/60">Checking your linked wallet…</p>
      )}

      {identity.state === "error" && (
        <div className="border-2 border-tuna/40 bg-tuna/10 px-3 py-2.5">
          <p className="font-mono text-sm font-bold text-tuna">{identity.message}</p>
          <p className="mt-1 font-mono text-xs text-nori/70">
            Close and reopen this from /dca in the bot. If it keeps happening, your Telegram session
            may have expired.
          </p>
        </div>
      )}

      {identity.state === "unlinked" && (
        <div className="border-2 border-nori/30 bg-bone px-3 py-3">
          <p className="font-mono text-sm font-bold text-nori">No wallet linked yet.</p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-nori/70">
            Send <strong>/linksite</strong> to the bot for a one-time code, then open the site,
            connect your wallet and enter it. That proves the wallet is yours with a signature —
            nothing secret is ever sent, here or there.
          </p>
          <p className="mt-2 font-mono text-xs leading-relaxed text-nori/70">
            You can still set up a recurring buy right now without linking — it just won&apos;t show
            up in here afterwards.
          </p>
        </div>
      )}

      {/* The workspace renders in every state. Even unlinked, composing an order and handing it
          off works perfectly — the link only decides whether we can show existing orders back. */}
      <DcaWorkspace frame={frame} />

      <p className="font-mono text-[11px] leading-relaxed text-nori/50">
        Why the browser? Telegram&apos;s in-app view has no wallet extension, so nothing here can be
        signed. Rather than hold a key for you — which would make this custodial — the composed
        order is carried out to your browser, where your own wallet approves it.
      </p>
    </main>
  );
}
