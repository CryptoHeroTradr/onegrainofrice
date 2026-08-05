"use client";

import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/basePath";
import { readJson } from "@/lib/readJson";

/**
 * Live market data for the $RICE trading portal.
 *
 * - useRiceMarket(): price / 24h change / liquidity / market cap / volume and
 *   the 24h buy-vs-sell split, from DexScreener's public (keyless, CORS-open)
 *   token API. The deepest-liquidity pair wins when several exist.
 * - useRecentTrades(): the live activity stream, read from /api/token-trades,
 *   which decodes recent pool transactions server-side (see that route for why
 *   it can't be done in the browser).
 */

export interface RiceMarket {
  priceUsd: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  volume24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  pairAddress: string | null;
  dexId: string | null;
  loading: boolean;
}

const EMPTY: RiceMarket = {
  priceUsd: null,
  change24h: null,
  liquidityUsd: null,
  marketCapUsd: null,
  volume24h: null,
  buys24h: null,
  sells24h: null,
  pairAddress: null,
  dexId: null,
  loading: true,
};

interface DexPair {
  pairAddress?: string;
  dexId?: string;
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
}

export function useRiceMarket(mint: string, intervalMs = 30_000): RiceMarket {
  const [market, setMarket] = useState<RiceMarket>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        if (!r.ok) return;
        const d = await readJson<{ pairs?: DexPair[] }>(r);
        const pairs: DexPair[] = Array.isArray(d?.pairs) ? d.pairs : [];
        if (!pairs.length) {
          if (!cancelled) setMarket((m) => ({ ...m, loading: false }));
          return;
        }
        const best = pairs.reduce((a, b) =>
          (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a,
        );
        if (cancelled) return;
        setMarket({
          priceUsd: best.priceUsd ? Number(best.priceUsd) : null,
          change24h: best.priceChange?.h24 ?? null,
          liquidityUsd: best.liquidity?.usd ?? null,
          marketCapUsd: best.marketCap ?? best.fdv ?? null,
          volume24h: best.volume?.h24 ?? null,
          buys24h: best.txns?.h24?.buys ?? null,
          sells24h: best.txns?.h24?.sells ?? null,
          pairAddress: best.pairAddress ?? null,
          dexId: best.dexId ?? null,
          loading: false,
        });
      } catch {
        if (!cancelled) setMarket((m) => ({ ...m, loading: false }));
      }
    };

    void load();
    const id = setInterval(() => void load(), intervalMs);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mint, intervalMs]);

  return market;
}

export interface Trade {
  signature: string;
  side: "BUY" | "SELL";
  /** $RICE moved, human units. */
  rice: number;
  /** SOL moved, human units (0 when the trade routed through another token). */
  sol: number;
  trader: string;
  timestamp: number | null;
}

/**
 * The live activity stream, served pre-decoded by /api/token-trades.
 *
 * Decoding happens on the server for the whole site rather than per visitor:
 * each trade needs its own getTransaction, and a browser-side batch of those
 * gets 429'd by the public RPC, which left the panel permanently empty. The
 * route caches its result, so this arrives backfilled on first paint.
 */
export function useRecentTrades(intervalMs = 45_000): Trade[] {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch(`${BASE_PATH}/api/token-trades`);
        if (!r.ok) return;
        const d = await readJson<{ trades?: unknown }>(r);
        if (!cancelled && Array.isArray(d?.trades)) setTrades(d.trades as Trade[]);
      } catch {
        /* keep whatever we already have */
      }
    };

    void load();
    const id = setInterval(() => void load(), intervalMs);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return trades;
}
