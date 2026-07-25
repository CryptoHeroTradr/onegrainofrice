"use client";

import { SectionHeading } from "@/components/primitives/SectionHeading";
import { TradeErrorBoundary } from "@/components/trade/TradeErrorBoundary";
import { TradeWalletProvider } from "@/components/trade/TradeWalletProvider";
import { TradeCard } from "@/components/trade/TradeCard";

/**
 * The /home Swap/DCA section — a self-contained, client-only tree that mounts
 * its own wallet context and does not touch the rest of the page. Everything
 * that can throw (wallet-adapter, RPC reads, later Jupiter calls) lives inside
 * TradeErrorBoundary, so a failure here shows a friendly fallback while every
 * other section renders normally.
 */
export function TradeSection() {
  return (
    <section id="swap" className="section grain-paper bg-bone text-nori">
      <div className="mx-auto max-w-[560px] px-6">
        <div className="flex justify-center">
          <SectionHeading lead="swap or" accent="stack $RICE" tone="dark" />
        </div>
        <p className="mx-auto mt-4 max-w-md text-center font-mono text-sm text-nori/70">
          Trade SOL ⇄ $RICE instantly, or set a recurring buy — all signed by your own wallet, no
          custody, no middleman.
        </p>

        <div className="mt-8">
          <TradeErrorBoundary>
            <TradeWalletProvider>
              <TradeCard />
            </TradeWalletProvider>
          </TradeErrorBoundary>
        </div>
      </div>
    </section>
  );
}
