import { NextResponse } from "next/server";

/**
 * Same-origin server proxy for the RiceDAO charity-wallet tracker, mirroring
 * src/app/api/charity/route.ts. The browser only ever calls
 * /onegrainofrice/api/charity-wallet/<endpoint> — this handler reaches the
 * internal Express server (RICEDAO_API_BASE, server-side only), which reads the
 * charity wallet straight off Solana. No CORS, no third-party calls from the
 * client. Upstream already caches 60s; we revalidate on the same cadence.
 */
export const revalidate = 60;

const API_BASE = process.env.RICEDAO_API_BASE ?? "http://127.0.0.1:1112";

/** Only these are proxied — an arbitrary path would be an open relay. */
const ALLOWED = ["balances", "recipients", "transactions", "impact"] as const;
type Endpoint = (typeof ALLOWED)[number];

/** Shape-preserving empty payloads, so the UI degrades instead of breaking. */
const FALLBACK: Record<Endpoint, unknown> = {
  balances: {
    walletAddress: "",
    sol: 0,
    usdc: 0,
    rice: 0,
    lastUpdated: "",
    solscanUrl: "",
    error: true,
  },
  recipients: { recipients: [] },
  transactions: { transactions: [] },
  impact: {
    totalDonatedUsd: 0,
    mealsDonated: 0,
    totalRaisedUsd: 0,
    countries: [],
    donors: [],
    solPrice: null,
    ricePrice: null,
    mealsPerUsd: 10,
    lastUpdated: "",
    error: true,
  },
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ endpoint: string }> },
) {
  const { endpoint } = await params;
  if (!ALLOWED.includes(endpoint as Endpoint)) {
    return NextResponse.json({ error: "unknown endpoint" }, { status: 404 });
  }
  const key = endpoint as Endpoint;

  try {
    const res = await fetch(`${API_BASE}/api/charity-wallet/${key}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error("upstream not ok");
    return NextResponse.json(await res.json());
  } catch {
    // Never surface a broken state to the user.
    return NextResponse.json(FALLBACK[key]);
  }
}
