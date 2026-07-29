import { NextResponse } from "next/server";
import { bridgeCall, bridgeConfigured, notConfigured, relay } from "@/lib/botBridge";

/**
 * ESTABLISH the (Telegram user ↔ wallet) link, with a code the BOT issued in a DM.
 *
 * The dashboard is unreachable without this: the bot answers "whose schedules are these?" from the
 * `site_links` mapping, and until a wallet is in it every read comes back `linked: false`. The
 * affordance that sends someone to `/linksite` needs somewhere to come back TO, and this is it.
 *
 * The code proves the TELEGRAM side (only that user's DM received it); the signature proves the
 * WALLET side (only its holder can produce it). Neither alone establishes anything, which is why
 * both are required and why the bot verifies the signature FIRST — a bad signature must not burn a
 * code that is single-use and expires in ten minutes.
 *
 * NOTHING SECRET CROSSES. The code is a short-lived one-time token the user was DMed; the signature
 * proves ownership of an address and confers no authority over it. There is no key, no passphrase
 * and no seed anywhere in this flow, on this route or on the page that calls it — custody stays a
 * Telegram conversation.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!bridgeConfigured()) return notConfigured();

  let body: { wallet?: unknown; code?: unknown; signature?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const { wallet, code, signature } = body;
  if (typeof wallet !== "string" || typeof code !== "string" || typeof signature !== "string") {
    return NextResponse.json({ ok: false, error: "wallet, code and signature are required" }, { status: 400 });
  }

  const { status, json } = await bridgeCall("/site/link", {
    method: "POST",
    body: { wallet, code: code.trim().toUpperCase(), signature },
  });
  return relay(status, json);
}
