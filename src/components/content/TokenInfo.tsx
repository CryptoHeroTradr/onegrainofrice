"use client";

import { useEffect, useState } from "react";
import { site } from "@/config/site";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { CopyAddress } from "@/components/primitives/CopyAddress";
import { useMealsDonated } from "@/hooks/useCharityImpact";
import { TradingPortal } from "@/components/token/TradingPortal";
import { readJson } from "@/lib/readJson";

/**
 * The $RICE token panel — content cloned from the RiceDAO site's "Codex of life"
 * token section (heading, tagline, blurb, the Token/Network/Supply/Contract/
 * Market-Cap table, and the Jupiter + DexScreener CTAs) but restyled in the
 * paper/olive palette here rather than the gold-on-black graphic. Replaces the
 * old four-bowl split. Market cap is live from DexScreener's public token API.
 */

const CONTRACT = site.token.contract;
const JUPITER = site.buyUrl;
const DEXSCREENER = `https://dexscreener.com/solana/${CONTRACT}`;

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

// Live $RICE market cap from DexScreener's public token API. Refreshes every 60s
// while the tab is visible; returns a formatted string, or null until loaded.
function useMarketCap(): string | null {
  const [marketCap, setMarketCap] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CONTRACT}`);
        if (!r.ok) return;
        const d = await readJson<{ pairs?: unknown }>(r);
        const pairs: Array<{ marketCap?: number; fdv?: number; liquidity?: { usd?: number } }> =
          Array.isArray(d?.pairs) ? d.pairs : [];
        if (!pairs.length) return;
        // Prefer the deepest-liquidity pair; fall back to FDV when marketCap absent.
        const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
        const cap = best.marketCap ?? best.fdv;
        if (!cancelled && typeof cap === "number" && cap > 0) setMarketCap(formatUsd(cap));
      } catch {
        /* keep last value */
      }
    };

    void load();
    const id = setInterval(() => void load(), 60_000);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return marketCap;
}

function StatRow({ label, value, breakValue }: { label: string; value: string; breakValue?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-nori/10 py-2.5 last:border-b-0">
      <span className="shrink-0 font-mono text-xs tracking-wide text-nori/55">{label}</span>
      <span
        className={`text-right font-mono text-sm font-semibold text-nori ${
          breakValue ? "break-all" : "tabular-nums"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function TokenInfo() {
  const marketCap = useMarketCap();
  // Same figure as the home hero and /charity: USD out of the charity wallet × 10.
  const mealsProvided = useMealsDonated();

  return (
    <section id="tokenomics" className="section grain-paper bg-bone text-nori">
      <div className="mx-auto max-w-[1180px] px-6 text-center">
        <p className="mb-3 font-mono text-xs font-bold tracking-[0.25em] text-olive uppercase">
          The $RICE Token
        </p>
        <div className="flex justify-center">
          <SectionHeading lead="the codex of" accent="rice." tone="dark" />
        </div>
        <p className="mt-4 font-display text-xl italic text-nori/90">
          Digital. Decentralized. Delicious.
        </p>
        {/* Copy stays in a narrow measure even though the section is now wide
            enough for the trading grid below. */}
        <p className="mx-auto mt-4 max-w-xl font-mono text-sm text-nori/70 sm:text-base">
          The $RICE token on Solana unites virtual grains and real world impact. Every token
          represents a real grain of rice pledged to hunger relief.
        </p>

        {/* Token facts table */}
        <div className="mx-auto mt-10 max-w-md rounded-2xl border-2 border-olive-deep/25 bg-steamed/60 px-5 py-3 text-left shadow-sm">
          <StatRow label="Token" value={site.ticker} />
          <StatRow label="Network" value={site.token.chain} />
          <StatRow label="Supply" value="1,000,000,000" />
          <StatRow label="Contract Address" value={CONTRACT} breakValue />
          <StatRow label="Market Cap" value={marketCap ?? "…"} />
          <StatRow label="Meals Provided" value={mealsProvided ?? "…"} />
        </div>

        <div className="mx-auto mt-5 flex max-w-md justify-center">
          <CopyAddress address={CONTRACT} />
        </div>

        {/* Live DEX ticker, market card and the working SOL ⇄ $RICE swap —
            same section, same paper/olive palette as the facts above. */}
        <TradingPortal />

        {/* CTAs — closing the combined section, below the trading portal. */}
        <div className="mx-auto mt-12 flex max-w-md flex-wrap items-center justify-center gap-3">
          <a
            href={JUPITER}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center bg-olive px-6 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
          >
            BUY {site.ticker} ON JUPITER →
          </a>
          <a
            href={DEXSCREENER}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center border-2 border-olive-deep/40 px-6 font-mono text-sm font-bold tracking-widest text-nori transition-colors hover:bg-nori hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
          >
            View on DexScreener
          </a>
        </div>
      </div>
    </section>
  );
}
