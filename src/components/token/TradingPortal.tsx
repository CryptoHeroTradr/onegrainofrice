"use client";

import { useState } from "react";
import { site } from "@/config/site";
import { CharityWalletProvider } from "@/components/charity/CharityWalletProvider";
import { SwapPanel } from "@/components/token/SwapPanel";
import { TradeErrorBoundary } from "@/components/trade/TradeErrorBoundary";
import { useRecentTrades, useRiceMarket, type Trade } from "@/hooks/useRiceMarket";
import { asset } from "@/lib/asset";

/**
 * The trading half of the tokenomics section: live DEX metrics, a working
 * SOL ⇄ $RICE swap (left), and the pool's recent trades (right).
 *
 * Renders as bare blocks — no <section>, no background of its own — because
 * TokenInfo composes it INTO the tokenomics section so the token facts and the
 * trading terminal read as one panel in the paper/olive theme. Mounts its own
 * wallet provider (the same one /charity uses) so the root layout stays
 * wallet-free.
 */

const MINT = site.token.contract;
/** The listing artwork $RICE shows on DexScreener/Jupiter, mirrored locally so
 *  the swap doesn't hotlink a CDN that can rotate or block the referrer. */
const TOKEN_LOGO = asset("/rice-token-logo.png");

const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Solid, hard-edged card — high contrast against the bone section background. */
const CARD = "rounded-2xl border-2 border-nori/35 bg-steamed p-5 shadow-sm";

function fmtUsd(n: number | null, digits = 2): string {
  if (n == null) return "…";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n < 0.01 && n > 0) return `$${n.toPrecision(3)}`;
  return `$${n.toFixed(digits)}`;
}

function fmtAgo(ts: number | null): string {
  if (!ts) return "";
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

type Tab = "swap" | "dca";

/**
 * Isolates the live trading terminal from the rest of /home: if wallet-adapter,
 * an RPC read, or Jupiter throws, the boundary shows a friendly fallback and
 * every other section on the page renders normally. (Carried over from the
 * Phase 2 shell when the DCA tab was merged into this portal.)
 */
export function TradingPortal() {
  return (
    <TradeErrorBoundary>
      <CharityWalletProvider>
        <PortalBody />
      </CharityWalletProvider>
    </TradeErrorBoundary>
  );
}

function PortalBody() {
  const market = useRiceMarket(MINT);
  const trades = useRecentTrades();
  const [tab, setTab] = useState<Tab>("swap");

  const buys = market.buys24h ?? 0;
  const sells = market.sells24h ?? 0;
  const total = buys + sells;
  const buyPct = total > 0 ? Math.round((buys / total) * 100) : null;

  return (
    <div className="mx-auto mt-14 max-w-[1180px] text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b-4 border-nori/80 pb-4">
        <h3 className="font-display text-3xl font-bold text-nori sm:text-4xl">
          Jupiter trading portal
        </h3>
        <span className="font-mono text-sm font-bold tracking-widest text-nori/80 uppercase">
          {market.loading ? "connecting…" : `live · ${market.dexId ?? "solana"}`}
        </span>
      </div>

      {/* Live ticker strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label={`${site.ticker.replace("$", "")}/usd`}
          value={market.priceUsd == null ? "…" : `$${market.priceUsd.toPrecision(5)}`}
        />
        <Metric
          label="24h change"
          value={
            market.change24h == null
              ? "…"
              : `${market.change24h >= 0 ? "▲ +" : "▼ "}${market.change24h.toFixed(2)}%`
          }
          tone={market.change24h == null ? "default" : market.change24h >= 0 ? "up" : "down"}
        />
        <Metric label="liquidity" value={fmtUsd(market.liquidityUsd)} />
        <Metric label="24h volume" value={fmtUsd(market.volume24h)} />
      </div>

      {/* Swap on the left, market + activity on the right. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[0.95fr_1fr]">
        <div className={CARD}>
          {/* Swap · DCA tabs — the swap is live; DCA is the frame it drops into. */}
          <div
            role="tablist"
            aria-label="Trade mode"
            className="mb-4 flex border-2 border-nori/30 bg-bone"
          >
            <TabButton id="swap" active={tab === "swap"} onSelect={setTab}>
              Swap
            </TabButton>
            <TabButton id="dca" active={tab === "dca"} onSelect={setTab}>
              DCA
            </TabButton>
          </div>

          {tab === "swap" ? (
            <div role="tabpanel" id="portal-panel-swap" aria-labelledby="portal-tab-swap">
              <SwapPanel riceMint={MINT} ticker={site.ticker} logoSrc={TOKEN_LOGO} />
            </div>
          ) : (
            <div role="tabpanel" id="portal-panel-dca" aria-labelledby="portal-tab-dca">
              <DcaPlaceholder />
            </div>
          )}
        </div>

        <div className={CARD}>
          <div className="flex items-center gap-3 border-b-2 border-nori/25 pb-4">
            {/* Images are unoptimized site-wide (next.config.ts). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={TOKEN_LOGO}
              alt={`${site.ticker} token logo`}
              width={44}
              height={44}
              className="block size-11 rounded-full border-2 border-nori/40 object-cover"
            />
            <div className="min-w-0">
              <p className="font-display text-xl font-bold text-nori">RICE Token</p>
              <a
                href={`https://solscan.io/token/${MINT}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm font-bold text-olive-deep underline-offset-2 hover:underline"
              >
                CA: {shortAddr(MINT)} ↗
              </a>
            </div>
          </div>

          {/* 24h buy pressure — same stacked-bar language as the allocation bar. */}
          <div className="mt-5">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="font-mono text-sm font-bold tracking-widest text-nori uppercase">
                24h buy pressure
              </span>
              <span className="font-mono text-sm font-bold text-bamboo">
                {buyPct == null ? "…" : `${buyPct}% buyers`}
              </span>
            </div>
            <div
              className="flex h-9 w-full overflow-hidden border-2 border-nori"
              role="img"
              aria-label={
                buyPct == null
                  ? "Buy pressure loading"
                  : `${buys} buys versus ${sells} sells in the last 24 hours`
              }
            >
              <div className="bg-bamboo" style={{ width: `${buyPct ?? 0}%` }} />
              <div className="flex-1 bg-tuna" />
            </div>
            <div className="mt-2 flex justify-between font-mono text-sm font-bold text-nori">
              <span>{buys.toLocaleString()} buys</span>
              <span>{sells.toLocaleString()} sells</span>
            </div>
          </div>

          {/* Live activity — last 10 pool trades, decoded server-side. */}
          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="font-mono text-sm font-bold tracking-widest text-nori uppercase">
                live activity
              </span>
              <span className="font-mono text-xs font-bold text-nori/60">
                last {trades.length || 10} on-chain trades
              </span>
            </div>
            {trades.length === 0 ? (
              <p className="font-mono text-sm font-bold text-nori/60">Loading pool trades…</p>
            ) : (
              <ul className="space-y-1.5">
                {trades.map((t) => (
                  <TradeRow key={t.signature} trade={t} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  id,
  active,
  onSelect,
  children,
}: {
  id: Tab;
  active: boolean;
  onSelect: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`portal-tab-${id}`}
      aria-selected={active}
      aria-controls={`portal-panel-${id}`}
      onClick={() => onSelect(id)}
      className={`min-h-11 flex-1 font-mono text-sm font-bold tracking-widest uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep ${
        active ? "bg-olive text-bone" : "bg-transparent text-nori/70 hover:bg-olive/15 hover:text-nori"
      }`}
    >
      {children}
    </button>
  );
}

/** DCA tab body — the recurring-buy frame. Wired up in a later phase. */
function DcaPlaceholder() {
  return (
    <div className="border-2 border-dashed border-nori/25 bg-bone px-5 py-12 text-center">
      <p className="font-display text-xl font-bold text-nori">Recurring buy (DCA)</p>
      <p className="mx-auto mt-2 max-w-sm font-mono text-sm text-nori/60">
        Schedule a recurring $RICE buy — deposit once, Jupiter executes on your interval. Coming in a
        later phase.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "up" | "down";
}) {
  const color = tone === "up" ? "text-bamboo" : tone === "down" ? "text-tuna" : "text-nori";
  return (
    <div className="border-2 border-nori/35 bg-steamed px-4 py-3">
      <p className="font-mono text-xs font-bold tracking-widest text-nori/70 uppercase">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold tabular-nums sm:text-[1.75rem] ${color}`}>
        {value}
      </p>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const buy = trade.side === "BUY";
  return (
    <li className="flex flex-wrap items-center gap-2 border-2 border-nori/20 bg-bone px-2.5 py-2 font-mono text-sm">
      <span
        className={`px-2 py-0.5 text-xs font-bold tracking-widest text-bone ${
          buy ? "bg-bamboo" : "bg-tuna"
        }`}
      >
        {trade.side}
      </span>
      <span className="font-bold text-nori tabular-nums">
        {trade.rice.toLocaleString(undefined, { maximumFractionDigits: 0 })} RICE
      </span>
      <span className="ml-auto font-bold text-nori/80 tabular-nums">
        {trade.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL
      </span>
      <a
        href={`https://solscan.io/tx/${trade.signature}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-bold text-olive-deep underline-offset-2 hover:underline"
      >
        {shortAddr(trade.trader)}
      </a>
      <span className="text-nori/60">{fmtAgo(trade.timestamp)}</span>
    </li>
  );
}
