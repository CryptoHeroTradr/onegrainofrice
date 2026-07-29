import { NextResponse } from "next/server";
import { bridgeCall, bridgeConfigured, notConfigured, relay } from "@/lib/botBridge";

/**
 * GET a READ challenge — a fresh nonce and the exact message to sign for it.
 *
 * The bot mints the nonce and dates it; the client never dates its own proof. What comes back is
 * public by construction (a random string and a sentence about it), which is why this route needs
 * no identity of its own — proving who you are is what the SIGNATURE does, one call later.
 */
export async function GET(): Promise<NextResponse> {
  if (!bridgeConfigured()) return notConfigured();
  const { status, json } = await bridgeCall("/site/challenge", { method: "GET" });
  return relay(status, json);
}
