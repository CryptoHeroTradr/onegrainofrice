import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  quote as jupQuote,
  buildSwap as jupBuildSwap,
  buildOpenRecurring as jupBuildOpenRecurring,
  fetchOrders as jupFetchOrders,
  buildCloseRecurring as jupBuildCloseRecurring,
  WSOL_MINT,
  RECURRING_FEE_BPS,
  RECURRING_MIN_USD_PER_ORDER,
  type Quote,
  type JupiterQuoteResponse,
  type RecurringOrder,
  type BuiltTransaction,
} from "@rice/jupiter-dca";

/**
 * THE SITE'S ADAPTER OVER `@rice/jupiter-dca` — not a second Jupiter client.
 *
 * Every call to Jupiter, from every frame (the /home portal, the standalone /dca page, and the
 * Telegram Mini App at /tma), goes through the shared package. This file exists only to hold the
 * things that are deliberately NOT the package's job:
 *
 *   * decimals ⇄ human units — the package takes and returns base units on purpose, because a
 *     decimals convention is a UI decision and putting one in a shared client is how two consumers
 *     end up rounding differently;
 *   * RPC reads (balances, mint decimals) — the package makes no RPC calls at all;
 *   * a SOL/USD price, which we derive from a Jupiter quote rather than adding a price feed.
 *
 * It re-exports the package's constants rather than restating them, so there is exactly one
 * definition of the recurring fee and the per-order minimum in this codebase.
 *
 * WHAT USED TO BE HERE: a parallel implementation of quote/swap/recurring, carrying the comment
 * "mirrors the shared @rice/jupiter-dca contract (to be adopted once that package is
 * git-installable)". It is installable now, and a mirror is a fork that has not diverged YET —
 * so it is gone rather than kept in sync by hand.
 *
 * The invariant travels with the package: every builder returns an UNSIGNED transaction. Nothing
 * in this file signs, and no server of ours is ever in the signing path.
 */

/** Wrapped SOL — Jupiter's stand-in for native SOL on both sides of a route. */
export const SOL_MINT = WSOL_MINT;
export const SOL_DECIMALS = 9;

/** USDC, used only to price SOL for the per-cycle minimum check. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

/** Jupiter's cut on recurring orders, and its live per-order minimum. Both from the package. */
export { RECURRING_FEE_BPS };
export const RECURRING_MIN_USD_PER_CYCLE = RECURRING_MIN_USD_PER_ORDER;

export type { Quote, RecurringOrder };
/** Kept as an alias so existing call sites reading `quote.raw` stay honest about the shape. */
export type QuoteResponse = JupiterQuoteResponse;

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
 *
 * Returns the package's richer {@link Quote} (route labels, minReceived, the untouched Jupiter
 * payload under `.raw`) rather than the bare Jupiter response the old local client returned.
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
}): Promise<Quote> {
  return jupQuote(inputMint, outputMint, amount, slippageBps, signal ? { signal } : {});
}

/**
 * Ask Jupiter to build the swap transaction for `userPublicKey`, deserialized and ready for
 * `sendTransaction`. Jupiter handles the wSOL wrap/unwrap and creates the destination token
 * account when missing. UNSIGNED — the wallet signs.
 */
export async function buildSwapTransaction({
  quote,
  userPublicKey,
}: {
  quote: Quote;
  userPublicKey: string;
}): Promise<VersionedTransaction> {
  const { transaction } = await jupBuildSwap(quote, userPublicKey);
  return transaction;
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
    return fromBaseUnits(q.expectedOut, USDC_DECIMALS);
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
 * Build the UNSIGNED deposit-and-schedule transaction for a time-based recurring (DCA) order.
 * Throws with Jupiter's own message (e.g. the ~$50/cycle minimum) on rejection, which
 * `humanizeTradeError` passes through verbatim because it is already user-ready.
 */
export async function buildRecurringOrder(
  params: OpenRecurringParams,
  userPublicKey: string,
): Promise<BuiltTransaction> {
  const inAmount = Number(params.inAmount);
  if (!Number.isSafeInteger(inAmount)) {
    throw new Error("Deposit amount is too large to schedule safely.");
  }
  return jupBuildOpenRecurring(
    {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmount: params.inAmount,
      numberOfOrders: params.numberOfOrders,
      interval: params.interval,
    },
    userPublicKey,
  );
}

/**
 * A wallet's ACTIVE time-based recurring orders (read-only).
 *
 * THE SAME CALL THE MINI APP MAKES, against the same on-chain orders. This is why an order
 * created in one frame appears in the other: neither frame has a database of orders, they both
 * ask Jupiter about the same wallet.
 */
export async function fetchRecurringOrders(
  owner: string,
  signal?: AbortSignal,
): Promise<RecurringOrder[]> {
  return jupFetchOrders(owner, signal ? { signal } : {});
}

/**
 * Build the UNSIGNED close/cancel transaction for a recurring order. Closing returns the
 * undeployed remainder to the user's wallet. The user's wallet signs — the site never signs.
 *
 * There is NO native pause on the program (verified: /recurring/v1/pause → 404), which is why the
 * shared package has no `buildPauseRecurring` and the UI says so plainly instead of faking one.
 */
export async function buildCloseRecurring(
  orderKey: string,
  userPublicKey: string,
): Promise<BuiltTransaction> {
  return jupBuildCloseRecurring(orderKey, userPublicKey);
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
