import { Connection } from "@solana/web3.js";
import { BASE_PATH } from "./basePath";

/**
 * Shared read-only Solana connection for every wallet flow on the site: the
 * SOL ⇄ $RICE swap on /home and the USDC donate flow on /charity.
 *
 * It points at THIS site's own /api/rpc handler by default, not straight at a
 * public RPC. Solana's public endpoint rejects requests that carry a browser
 * Origin header (403 "Access forbidden"), which made every balance read come
 * back 0; the proxy re-issues the call server-side and also keeps a paid RPC
 * key off the client. Set SOLANA_RPC_URL (server-side) to point the proxy at a
 * dedicated endpoint — the public one is heavily rate-limited.
 *
 * NEXT_PUBLIC_SOLANA_RPC_URL still overrides everything when a browser-safe
 * endpoint should be called directly, skipping the proxy hop.
 */

/** web3.js needs an absolute URL, so the origin is resolved at call time. */
function defaultRpcUrl(): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://127.0.0.1:3006");
  return `${origin}${BASE_PATH}/api/rpc`;
}

export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || defaultRpcUrl();

export const connection = new Connection(SOLANA_RPC_URL, "confirmed");

/**
 * Wait for a signature to reach `confirmed` by POLLING, not by websocket.
 *
 * Connection.confirmTransaction() opens a signature subscription on the ws://
 * twin of the endpoint — which does not exist for the /api/rpc proxy (HTTP
 * only), so it would hang until timeout. getSignatureStatuses is a plain RPC
 * call and goes through the proxy like everything else.
 *
 * Resolves once confirmed, rejects on an on-chain error or after `timeoutMs`.
 */
export async function confirmSignature(
  conn: Connection,
  signature: string,
  timeoutMs = 90_000,
  pollMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { value } = await conn.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        "Timed out waiting for confirmation — the transaction may still land; check Solscan.",
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
