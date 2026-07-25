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

// ───────────────────────────── Recurring (DCA) ──────────────────────────────
//
// Jupiter's Recurring API (POST /recurring/v1/createOrder). Same keyless base as
// the swap. Builds an UNSIGNED deposit-and-schedule transaction the user's wallet
// signs — the site never signs. After it confirms, the order runs ON-CHAIN via
// Jupiter's program; there is no server-side schedule. Mirrors the shared
// @rice/jupiter-dca contract (to be adopted once that package is git-installable).

/** USDC, used only to price SOL for the per-cycle minimum check. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;
/** Jupiter's cut on recurring orders (0.1%), stated plainly in the UI. */
export const RECURRING_FEE_BPS = 10;
/** Live per-order minimum Jupiter enforces (server-side), ~$50. UI warns; API is truth. */
export const RECURRING_MIN_USD_PER_CYCLE = 50;

function deserializeTx(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
  );
}

/** Live SOL price in USD via a Jupiter quote (1 SOL → USDC). Null on failure. */
export async function getSolUsd(signal?: AbortSignal): Promise<number | null> {
  try {
    const q = await getQuote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: toBaseUnits(1, SOL_DECIMALS),
      slippageBps: 50,
      signal,
    });
    return fromBaseUnits(q.outAmount, USDC_DECIMALS);
  } catch {
    return null;
  }
}

export interface OpenRecurringParams {
  inputMint: string;
  outputMint: string;
  /** TOTAL to deposit, in input-mint base units (integer string). */
  inAmount: string;
  /** How many cycles the deposit is split across (≥ 2). */
  numberOfOrders: number;
  /** Seconds between cycles. */
  interval: number;
}

/**
 * Build the UNSIGNED deposit-and-schedule transaction for a time-based recurring
 * (DCA) order. Returns the tx for the wallet to sign, plus Jupiter's requestId.
 * Throws with Jupiter's own message (e.g. the ~$50/cycle minimum) on rejection.
 */
export async function buildRecurringOrder(
  params: OpenRecurringParams,
  userPublicKey: string,
): Promise<{ transaction: VersionedTransaction; requestId: string }> {
  const inAmount = Number(params.inAmount);
  if (!Number.isSafeInteger(inAmount)) {
    throw new Error("Deposit amount is too large to schedule safely.");
  }
  const res = await fetch(`${JUP_API}/recurring/v1/createOrder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: userPublicKey,
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      params: {
        time: {
          inAmount,
          numberOfOrders: params.numberOfOrders,
          interval: params.interval,
        },
      },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.transaction) {
    throw new Error(data?.error ?? `Recurring order build failed (${res.status})`);
  }
  return { transaction: deserializeTx(data.transaction as string), requestId: data.requestId };
}

/** A wallet's recurring order with on-chain state; `orderKey` is its account address. */
export interface RecurringOrder {
  orderKey: string;
  inputMint: string;
  outputMint: string;
  inDeposited: string;
  inWithdrawn: string;
  cycleFrequency: string;
  inAmountPerCycle: string;
  createdAt: string;
  [k: string]: unknown;
}

/** A wallet's ACTIVE time-based recurring orders (read-only). */
export async function fetchRecurringOrders(
  owner: string,
  signal?: AbortSignal,
): Promise<RecurringOrder[]> {
  const url =
    `${JUP_API}/recurring/v1/getRecurringOrders?user=${owner}` +
    `&recurringType=time&orderStatus=active&includeFailedTx=false&page=1`;
  const res = await fetch(url, { signal });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error(data?.error ?? `Fetching recurring orders failed (${res.status})`);
  }
  return Array.isArray(data.time) ? (data.time as RecurringOrder[]) : [];
}
