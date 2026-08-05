import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { site } from "@/config/site";
import { SOL_MINT } from "@/lib/jupiter";
import { readJson } from "@/lib/readJson";

/**
 * Recent $RICE pool trades, decoded server-side.
 *
 * The browser used to do this itself, but decoding N transactions means N
 * getTransaction calls, and the public RPC answers a batch of them with
 * 429 "Too many requests for a specific RPC call" — which is why the activity
 * stream sat empty. Here the work happens once per CACHE_MS for the whole site:
 * requests are issued one at a time with a gap between them, and every visitor
 * is served the same cached, already-decoded list (so the panel is backfilled
 * on first paint instead of waiting for the next trade).
 */

const MINT = site.token.contract;
const RPC =
  process.env.SOLANA_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

const connection = new Connection(RPC, "confirmed");

/** How long a decoded list is served before a background refresh is kicked off. */
const CACHE_MS = 90_000;
/** Trades returned to the client. */
const LIMIT = 10;
/** Signatures inspected to find them — routes that don't touch $RICE are skipped. */
const SCAN = 18;
/** Gap between getTransaction calls; the public RPC 429s on bursts. */
const GAP_MS = 120;

export interface TradeDTO {
  signature: string;
  side: "BUY" | "SELL";
  rice: number;
  sol: number;
  trader: string;
  timestamp: number | null;
}

type Cache = { at: number; trades: TradeDTO[]; pair: string | null };
let cache: Cache | null = null;
/** Read through a function so narrowing from an earlier branch can't stale it. */
const snapshot = (): Cache | null => cache;
/** In-flight refresh, so concurrent requests share one chain walk. */
let inflight: Promise<TradeDTO[]> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deepest-liquidity pool for the mint, per DexScreener. */
async function resolvePair(): Promise<string | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    const d = await readJson<{ pairs?: unknown }>(r);
    const pairs: Array<{ pairAddress?: string; liquidity?: { usd?: number } }> = Array.isArray(
      d?.pairs,
    )
      ? d.pairs
      : [];
    if (!pairs.length) return null;
    return (
      pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a))
        .pairAddress ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Walk the pool's recent signatures and classify each by the FEE PAYER's own
 * $RICE balance delta: up = BUY, down = SELL. Works across every AMM layout
 * without knowing which account holds the pool's vault.
 */
async function decodeTrades(pair: string): Promise<TradeDTO[]> {
  const sigs = await connection.getSignaturesForAddress(new PublicKey(pair), { limit: SCAN });
  const out: TradeDTO[] = [];

  for (const sig of sigs.filter((s) => !s.err)) {
    if (out.length >= LIMIT) break;
    let tx;
    try {
      tx = await connection.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      await sleep(GAP_MS * 4); // rate-limited — back off, then keep going
      continue;
    }
    await sleep(GAP_MS);
    if (!tx?.meta) continue;

    const payer = tx.transaction.message.accountKeys[0]?.pubkey.toBase58();
    if (!payer) continue;

    const delta = (mint: string) => {
      const sum = (rows: typeof tx.meta.preTokenBalances) =>
        (rows ?? [])
          .filter((b) => b.mint === mint && b.owner === payer)
          .reduce((acc, b) => acc + (b.uiTokenAmount.uiAmount ?? 0), 0);
      return sum(tx.meta!.postTokenBalances) - sum(tx.meta!.preTokenBalances);
    };

    const riceDelta = delta(MINT);
    if (Math.abs(riceDelta) < 1e-9) continue; // not a $RICE trade for this payer

    // SOL side: wrapped SOL when the route used it, else the payer's native
    // lamport change net of the fee.
    const wsolDelta = delta(SOL_MINT);
    const nativeDelta =
      (tx.meta.postBalances[0] - tx.meta.preBalances[0] + tx.meta.fee) / 1e9;

    out.push({
      signature: sig.signature,
      side: riceDelta > 0 ? "BUY" : "SELL",
      rice: Math.abs(riceDelta),
      sol: Math.abs(wsolDelta !== 0 ? wsolDelta : nativeDelta),
      trader: payer,
      timestamp: tx.blockTime ?? null,
    });
  }

  return out;
}

export async function GET() {
  const now = Date.now();
  const fresh = cache != null && now - cache.at < CACHE_MS;

  // A full chain walk takes ~30s against the rate-limited public RPC, so a
  // visitor must never wait on one when there is anything to show: serve the
  // cached list at once and refresh behind it (stale-while-revalidate).
  if (cache && fresh) {
    return NextResponse.json(
      { trades: cache.trades, pair: cache.pair, cached: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!inflight) {
    inflight = (async () => {
      const pair = await resolvePair();
      const trades = pair ? await decodeTrades(pair) : [];
      // Only replace a good cache with a good result: an RPC hiccup shouldn't
      // blank a panel that was populated a minute ago.
      if (trades.length || !cache?.trades.length) {
        cache = { at: Date.now(), trades, pair };
      } else {
        cache = { ...cache, at: Date.now() };
      }
      return cache.trades;
    })().finally(() => {
      inflight = null;
    });
  }

  // Stale cache present: hand it back now, let the refresh finish in the
  // background and land in the cache for the next poll.
  if (cache) {
    void inflight.catch(() => {});
    return NextResponse.json(
      { trades: cache.trades, pair: cache.pair, stale: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Nothing cached at all — this caller has to wait for the first walk.
  try {
    const trades = await inflight;
    return NextResponse.json(
      { trades, pair: snapshot()?.pair ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { trades: snapshot()?.trades ?? [], pair: snapshot()?.pair ?? null, stale: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const dynamic = "force-dynamic";
