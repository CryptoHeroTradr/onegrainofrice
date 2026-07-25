/**
 * Shared human-facing error handling for the swap + DCA panels. A raw RPC / program
 * error ("custom program error: 0x1771", "Blockhash not found") is never shown to a
 * user; these map the common failures to a sentence they can act on. Jupiter's own
 * clear messages (e.g. the ~$50/cycle recurring minimum) are passed through verbatim.
 */

/** confirmSignature (lib/solana) throws this on a confirmation timeout — the tx may still land. */
export function isConfirmTimeout(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return m.includes("timed out") || m.includes("still land") || m.includes("check solscan");
}

export function humanizeTradeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.toLowerCase();
  // Jupiter's own clear, user-ready messages — pass through as-is.
  if (m.includes("minimum is") || m.includes("valued at") || m.includes("must be at least")) return raw;
  if (m.includes("user rejected") || m.includes("rejected the request") || m.includes("declined") || m.includes("user denied"))
    return "You dismissed the wallet — nothing was signed. Try again when ready.";
  if (m.includes("insufficient") && (m.includes("lamport") || m.includes("sol") || m.includes("fee") || m.includes("rent")))
    return "Not enough SOL to cover the deposit plus network fees. Leave a little SOL (≈0.01) unspent and try again.";
  if (m.includes("slippage") || m.includes("0x1771") || m.includes("exceeds desired") || m.includes("price impact"))
    return "The price moved past your slippage tolerance. Re-quote and try again, or nudge slippage up a little.";
  if (m.includes("on-chain") || m.includes("custom program error") || m.includes("instruction error"))
    return "It failed on-chain — the pool price likely moved. Try again; only the network fee was spent.";
  if (m.includes("blockhash") || m.includes("block height exceeded") || m.includes("expired"))
    return "The transaction expired before it landed. Try again.";
  if (m.includes("no route") || m.includes("could not find any route") || m.includes("no routes"))
    return "No route for that pair and size right now — try a different amount.";
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("timeout") || m.includes("429") || m.includes("rate limit") || m.includes("fetch"))
    return "Couldn't reach the network. Check your connection and try again in a moment.";
  return "That didn't go through — try again. Nothing was signed unless your wallet prompted you.";
}
