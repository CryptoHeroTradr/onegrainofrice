import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";

/**
 * Jupiter aggregator client for the /home trading portal (SOL ⇄ $RICE).
 *
 * Uses Jupiter's keyless "lite" tier, which is CORS-open and needs no API key —
 * the browser talks to Jupiter directly, exactly like jup.ag does. Set
 * NEXT_PUBLIC_JUPITER_API to a Pro endpoint (https://api.jup.ag) if a key-based
 * plan is added later; the paths are identical.
 *
 * Flow: quote() prices the route → buildSwapTransaction() asks Jupiter to
 * assemble a ready-to-sign VersionedTransaction for the connected wallet → the
 * wallet signs and submits it. No server of ours is in the loop and no custody
 * ever leaves the user's wallet.
 */

const JUP_API = process.env.NEXT_PUBLIC_JUPITER_API ?? "https://lite-api.jup.ag";

/** Wrapped SOL — Jupiter's stand-in for native SOL on both sides of a route. */
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;

export interface QuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo?: { label?: string } }>;
  [k: string]: unknown;
}

/** Human units → base units (integer string) for the given decimals. */
export function toBaseUnits(uiAmount: number, decimals: number): string {
  return BigInt(Math.round(uiAmount * 10 ** decimals)).toString();
}

/** Base units → human units. */
export function fromBaseUnits(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/**
 * Price a swap. `amount` is in the INPUT mint's base units.
 * Throws with Jupiter's own message when no route exists (illiquid pair, dust
 * amount, etc.) so the UI can surface something actionable.
 */
export async function getQuote({
  inputMint,
  outputMint,
  amount,
  slippageBps,
  signal,
}: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  signal?: AbortSignal;
}): Promise<QuoteResponse> {
  const url =
    `${JUP_API}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
  const res = await fetch(url, { signal });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    throw new Error(data?.error ?? `Quote failed (${res.status})`);
  }
  return data as QuoteResponse;
}

/**
 * Ask Jupiter to build the swap transaction for `userPublicKey`, returned
 * deserialized and ready for `sendTransaction`. Jupiter handles the wSOL
 * wrap/unwrap and creates the destination token account when missing.
 */
export async function buildSwapTransaction({
  quote,
  userPublicKey,
}: {
  quote: QuoteResponse;
  userPublicKey: string;
}): Promise<VersionedTransaction> {
  const res = await fetch(`${JUP_API}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      // Let Jupiter size the priority fee, capped so a congested block can't
      // quietly eat a large chunk of a small swap.
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: 1_000_000,
          priorityLevel: "high",
        },
      },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.swapTransaction) {
    throw new Error(data?.error ?? `Swap build failed (${res.status})`);
  }
  return VersionedTransaction.deserialize(
    Uint8Array.from(atob(data.swapTransaction as string), (c) => c.charCodeAt(0)),
  );
}

/** Mint decimals, straight from the chain. Falls back to `fallback` on RPC failure. */
export async function getMintDecimals(
  conn: Connection,
  mint: string,
  fallback = 6,
): Promise<number> {
  try {
    const supply = await conn.getTokenSupply(new PublicKey(mint));
    return supply.value.decimals;
  } catch {
    return fallback;
  }
}

/** Owner's balance of an SPL mint in human units (0 when no token account). */
export async function getTokenBalance(
  conn: Connection,
  owner: PublicKey,
  mint: string,
): Promise<number> {
  try {
    const res = await conn.getParsedTokenAccountsByOwner(owner, {
      mint: new PublicKey(mint),
    });
    return res.value.reduce(
      (sum, { account }) =>
        sum + (account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
      0,
    );
  } catch {
    return 0;
  }
}
