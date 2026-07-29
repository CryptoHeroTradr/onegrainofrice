"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { DashboardKeyMode } from "@/components/dca/DashboardKeyMode";
import { DashboardWalletMode } from "@/components/dca/DashboardWalletMode";
import { DashboardLink } from "@/components/dca/DashboardLink";
import { useDcaFrame } from "@/components/dca/frame";
import { readDashboard, type SigningWallet } from "@/lib/dcaDashboard";
import type { SiteDashboard } from "@/lib/bot-contract";
import { site } from "@/config/site";

/**
 * THE BOT DASHBOARD — the custodial autotrader, managed from the browser.
 *
 * This is the ONE surface on this site that shows state the bot owns. Everything else in the
 * Swap/DCA interface is the user's own wallet acting directly on Jupiter, with no server of ours in
 * the path. Here, the bot holds a key for some members and runs schedules with it, and this screen
 * is the website's window onto that — read through a signature, changed through a signature, and
 * never through anything this site could do on its own.
 *
 * FOUR SCREENS, NOT ONE WITH BITS HIDDEN. The state a viewer is in decides which:
 *
 *   no wallet connected  -> connect
 *   connected, unlinked  -> the /linksite affordance (DashboardLink) — never an empty dashboard
 *   linked, WALLET mode  -> the observed-fills view (DashboardWalletMode)
 *   linked, KEY mode     -> schedules, budgets, history and controls (DashboardKeyMode)
 *
 * The wallet/key split is the bot's own (`banner.mode`), and it is a split between two different
 * products: in wallet mode the bot holds nothing and runs nothing, so a schedules table would be a
 * table of things that do not exist. The read returns `schedules: []` for those users BY DESIGN —
 * rendering empty rows would describe machinery that is not running.
 *
 * WRITES ARE PROBABLY OFF, AND THAT IS FINE. The bot ships with SITE_BRIDGE_WRITES=false, so every
 * mutation route answers 404. That is the state this was built against: the dashboard renders in
 * full and the controls report themselves switched off. Nothing here throws, nothing renders
 * broken, and no error banner appears for a configuration that is working as deployed.
 *
 * READING COSTS A SIGNATURE, on purpose. The bot will not hand a wallet's schedules to whoever asks
 * for them — the caller proves the wallet by signing a nonce the bot minted. So the dashboard opens
 * behind a button rather than firing a wallet popup at anyone who happens to land on the tab.
 */

export function DcaDashboard() {
  const frame = useDcaFrame();
  const { publicKey, signMessage } = useWallet();
  /** The read and the instant it happened, held TOGETHER: every relative figure on the screen is
   *  measured from that instant, and a snapshot whose timestamp could go missing would be a
   *  snapshot the countdown had to invent a clock for. */
  const [snap, setSnap] = useState<{ data: SiteDashboard; readAt: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = publicKey?.toBase58() ?? null;

  // The dashboard belongs to the wallet that proved it. If the user switches accounts, what is on
  // screen is somebody else's — drop it rather than leave it there looking current.
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (shownFor.current !== null && shownFor.current !== address) {
      setSnap(null);
      setError(null);
    }
    shownFor.current = address;
  }, [address]);

  // Memoised so its identity is stable: `load` depends on it, and a fresh object each render would
  // make the callback change every render and defeat every consumer that depends on it.
  const wallet: SigningWallet | null = useMemo(
    () => (address && signMessage ? { address, signMessage: (m: Uint8Array) => signMessage(m) } : null),
    [address, signMessage],
  );

  const load = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setError(null);
    try {
      const next = await readDashboard(wallet);
      setSnap({ data: next, readAt: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read your dashboard.");
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  // A frame that cannot sign cannot prove a wallet, so it cannot read this at all. Telegram's
  // webview is exactly that. Say where it works instead of rendering a button that cannot work.
  if (!frame.canSign) {
    return (
      <Shell>
        <p className="font-mono text-sm leading-relaxed text-nori/70">
          Managing the bot&apos;s schedules needs a wallet signature, and Telegram&apos;s in-app
          browser has no wallet to sign with. Open{" "}
          <span className="font-bold text-nori">1grainofrice.com/dca</span> in your normal browser —
          or just use <span className="font-bold text-nori">/trade</span> in the bot, which does all
          of this in the chat.
        </p>
      </Shell>
    );
  }

  if (!address) {
    return (
      <Shell>
        <p className="font-mono text-sm leading-relaxed text-nori/70">
          Connect the wallet you linked in Telegram to see the bot&apos;s schedules it runs for you.
        </p>
        <div className="mt-3">
          <WalletMultiButton />
        </div>
      </Shell>
    );
  }

  if (!snap) {
    return (
      <Shell>
        <p className="font-mono text-sm leading-relaxed text-nori/70">
          Your schedules are private, so the bot only shows them to a wallet that proves itself. This
          asks you to sign a short message — <span className="font-bold text-nori">it is not a
          transaction</span>, it moves nothing and costs nothing.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || !signMessage}
          className="mt-3 min-h-11 w-full border-2 border-olive bg-olive px-4 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep disabled:opacity-50"
        >
          {loading ? "CHECK YOUR WALLET…" : "SHOW MY SCHEDULES"}
        </button>
        {!signMessage && (
          <p className="mt-2 font-mono text-xs text-tuna">
            This wallet can&apos;t sign messages, so it can&apos;t prove itself to the bot.
          </p>
        )}
        {error && <p className="mt-2 font-mono text-xs font-bold text-tuna">{error}</p>}
      </Shell>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Banner data={snap.data} />
      {!snap.data.linked ? (
        <DashboardLink wallet={wallet} onLinked={() => void load()} />
      ) : snap.data.walletMode ? (
        <DashboardWalletMode data={snap.data} ticker={site.ticker} onRefresh={() => void load()} busy={loading} />
      ) : (
        <DashboardKeyMode
          data={snap.data}
          wallet={wallet}
          readAt={snap.readAt}
          ticker={site.ticker}
          onRefresh={load}
          busy={loading}
        />
      )}
      {error && <p className="font-mono text-xs font-bold text-tuna">{error}</p>}
    </div>
  );
}

/**
 * RULE A, ON THE WEB. Whether real money is at stake, first, unmissable, in the bot's own words.
 *
 * The boolean drives the STYLING and the bot's sentence is PRINTED. Not paraphrased, not
 * re-authored here: this is the most important sentence in the product, it exists in exactly one
 * place, and a site that wrote its own version of it would be a second place for it to be wrong.
 * The custody line sits directly beneath, same as line two of the Telegram panel — a person must be
 * able to SEE whether a key of theirs is on that server, never infer it from what the page offers.
 */
function Banner({ data }: { data: SiteDashboard }) {
  const live = data.banner.tradeLive;
  return (
    <div
      role="status"
      className={`border-2 px-3 py-2.5 ${
        live ? "border-tuna bg-tuna/15 text-tuna" : "border-olive/50 bg-olive/10 text-olive-deep"
      }`}
    >
      <p className="font-mono text-sm font-bold tracking-wide">{data.banner.text}</p>
      <p className="mt-1 font-mono text-xs leading-relaxed opacity-90">{data.banner.modeText}</p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="border-2 border-nori/25 bg-steamed p-4">{children}</div>;
}
