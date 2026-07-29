"use client";

import { useState } from "react";
import { CharityWalletProvider } from "@/components/charity/CharityWalletProvider";
import { SwapPanel } from "@/components/dca/SwapPanel";
import { RecurringPanel, type RecurringPrefill } from "@/components/dca/RecurringPanel";
import { DcaDashboard } from "@/components/dca/DcaDashboard";
import { TradeErrorBoundary } from "@/components/dca/TradeErrorBoundary";
import { DcaFrameProvider, type DcaFrame } from "@/components/dca/frame";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";

/**
 * THE WHOLE TRADING INTERFACE, IN ONE MOUNTABLE UNIT.
 *
 * /dca (browser) and /tma (Telegram) both render exactly this, differing only in the `frame` they
 * pass. The /home portal keeps its own composition because it is embedded in a page section rather
 * than being a page, but it imports the SAME panels from `components/dca`.
 *
 * THE WALLET PROVIDER IS MOUNTED IN BOTH FRAMES, on purpose, even though Telegram's webview has no
 * wallet to find. Wallet-adapter's hooks throw outside their provider, so the alternative is for
 * every panel to branch on whether it may call `useWallet()` — which would mean two component
 * trees, and two component trees is exactly the thing this phase exists to avoid. Mounted with
 * nothing to discover, the adapter simply reports no wallet and `publicKey` stays null, which is
 * already the state the panels handle. The frame, not the hook, decides what the UI offers.
 */

const MINT = site.token.contract;
const TOKEN_LOGO = asset("/rice-token-logo.png");

type Tab = "swap" | "dca" | "bot";

export function DcaWorkspace({
  frame,
  initialTab = "dca",
  prefill,
}: {
  frame: DcaFrame;
  initialTab?: Tab;
  /** A schedule composed in another frame and handed here to be signed. */
  prefill?: RecurringPrefill | undefined;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  /**
   * THE BOT TAB IS OFFERED ONLY WHERE A WALLET CAN SIGN, and `canSign` is the honest test for it.
   *
   * Reading the bot's dashboard is proof-gated: the bot will not hand a wallet's schedules to
   * whoever asks, so the caller signs a nonce it minted. A frame with no wallet to sign with cannot
   * complete that exchange — which is the same capability the trading panels already branch on, not
   * a new axis. Telegram's webview therefore keeps the two tabs it has always had, and the frame
   * gains no knowledge of what it is being used for.
   */
  const tabs: readonly (readonly [Tab, string])[] = frame.canSign
    ? ([
        ["dca", "RECURRING"],
        ["swap", "SWAP"],
        ["bot", "BOT"],
      ] as const)
    : ([
        ["dca", "RECURRING"],
        ["swap", "SWAP"],
      ] as const);

  return (
    <CharityWalletProvider>
      <DcaFrameProvider frame={frame}>
        <TradeErrorBoundary>
          <div className="flex flex-col gap-4">
            <div className="flex gap-2" role="tablist" aria-label="Trade or schedule">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`min-h-11 flex-1 border-2 px-4 font-mono text-sm font-bold tracking-widest transition-colors ${
                    tab === key
                      ? "border-olive bg-olive text-bone"
                      : "border-nori/30 text-nori/70 hover:border-nori"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "dca" && <RecurringPanel riceMint={MINT} ticker={site.ticker} prefill={prefill} />}
            {tab === "swap" && <SwapPanel riceMint={MINT} ticker={site.ticker} logoSrc={TOKEN_LOGO} />}
            {tab === "bot" && <DcaDashboard />}
          </div>
        </TradeErrorBoundary>
      </DcaFrameProvider>
    </CharityWalletProvider>
  );
}
