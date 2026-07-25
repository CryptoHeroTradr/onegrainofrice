import { NextResponse } from "next/server";

/**
 * Same-origin Solana JSON-RPC proxy.
 *
 * Solana's public endpoint (api.mainnet-beta.solana.com) answers 403 "Access
 * forbidden" to any request carrying a browser Origin header, so the wallet
 * flows that talk to it straight from the page — swap quotes/balances on /home,
 * the USDC donate flow on /charity — read every balance as 0. Routing through
 * this handler means the browser only ever calls this site, and the upstream
 * call goes out server-side with no Origin.
 *
 * It also keeps the RPC credential server-side: set SOLANA_RPC_URL to a
 * dedicated endpoint (Helius/QuickNode/Triton, key in the URL) and nothing
 * about it reaches the client. NEXT_PUBLIC_SOLANA_RPC_URL still wins on the
 * client when a public, browser-safe endpoint is preferred (see lib/solana.ts).
 */

const UPSTREAM =
  process.env.SOLANA_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

/**
 * Methods the site actually uses: reads, plus the two writes a wallet-signed
 * swap/donation needs. An open proxy would let anyone use this host as free RPC
 * bandwidth, so anything unlisted is refused.
 */
const ALLOWED = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getParsedTransaction",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenSupply",
  "getTransaction",
  "getVersion",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
]);

/** Batched calls arrive as an array; single calls as one object. */
function methodsOf(body: unknown): string[] {
  const list = Array.isArray(body) ? body : [body];
  return list.map((r) => (r as { method?: string } | null)?.method ?? "");
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const methods = methodsOf(body);
  if (!methods.length || methods.some((m) => !ALLOWED.has(m))) {
    return NextResponse.json({ error: "Method not allowed" }, { status: 403 });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Never cached: balances, blockhashes and signature statuses are all
      // point-in-time, and a stale blockhash fails the transaction outright.
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `RPC upstream unreachable: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";
