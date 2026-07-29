import { NextResponse } from "next/server";
import { bridgeCall, bridgeConfigured, notConfigured, relay } from "@/lib/botBridge";

/**
 * READ the dashboard: a wallet, a nonce, and a signature proving the wallet.
 *
 * This handler forwards those three fields and nothing else. It does not know who the caller is and
 * has no way to find out — the bot resolves the wallet to a Telegram user itself, at action time,
 * through the link the user established in the bot. A site that could name the user here would be a
 * site that could ask for someone else's dashboard.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!bridgeConfigured()) return notConfigured();

  let body: { wallet?: unknown; nonce?: unknown; signature?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const { wallet, nonce, signature } = body;
  if (typeof wallet !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
    return NextResponse.json({ ok: false, error: "wallet, nonce and signature are required" }, { status: 400 });
  }

  const { status, json } = await bridgeCall("/site/schedules", {
    method: "POST",
    body: { wallet, nonce, signature },
  });
  return relay(status, json);
}
