"use client";

import { useEffect, useState } from "react";
import { GAME_API } from "@/components/landing/ui";
import { readJson } from "@/lib/readJson";

/**
 * The single source of truth for the site's impact numbers.
 *
 * Everything here derives from one figure: the total USD value that has left
 * the public charity wallet. $1 buys 10 meals, so meals = USD out × 10. The
 * server (RiceDAO /api/charity-wallet/impact, reached through the same-origin
 * proxy) reads the wallet's full history off-chain-of-trust — resolving real
 * counterparties, valuing SOL at the live price, and excluding treasury swaps —
 * so the home hero, the token panel and the charity page can never disagree
 * about how many meals have been funded.
 */

export interface CountryRank {
  id: string;
  country: string;
  flag: string;
  name: string;
  walletAddress: string | null;
  url: string | null;
  status: "forming" | "active" | "donated";
  usd: number;
  meals: number;
  donationCount: number;
}

export interface DonorRank {
  address: string;
  short: string;
  usd: number;
  donationCount: number;
  lastDonationAt: string | null;
  solscanUrl: string;
}

export interface Impact {
  /** Total USD value sent OUT of the charity wallet to partners. */
  totalDonatedUsd: number;
  /** totalDonatedUsd × mealsPerUsd. */
  mealsDonated: number;
  /** Total USD value donated INTO the charity wallet. */
  totalRaisedUsd: number;
  countries: CountryRank[];
  donors: DonorRank[];
  solPrice: number | null;
  ricePrice: number | null;
  mealsPerUsd: number;
  lastUpdated: string;
  error?: boolean;
}

/** Polls the impact endpoint every 60s while the tab is visible. */
export function useCharityImpact(): { impact: Impact | null; loading: boolean } {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch(`${GAME_API}/api/charity-wallet/impact`);
        if (!r.ok) return;
        const d = await readJson<Impact>(r);
        if (!cancelled) setImpact(d);
      } catch {
        /* keep last value */
      } finally {
        if (!cancelled) setLoading(false);
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

  return { impact, loading };
}

/** "1,234" — meals funded so far, or null until the first load resolves. */
export function useMealsDonated(): string | null {
  const { impact } = useCharityImpact();
  return impact ? Math.floor(impact.mealsDonated).toLocaleString() : null;
}

/** "$8.79" — USD formatted for display. */
export function formatUsd(n: number, digits = 2): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
