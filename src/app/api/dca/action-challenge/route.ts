import { NextResponse } from "next/server";
import { bridgeCall, bridgeConfigured, notConfigured, relay } from "@/lib/botBridge";
import { WRITE_ACTIONS, pickIntent } from "@/lib/dcaIntent";

/**
 * Ask the bot for the EXACT MESSAGE the wallet should sign for one specific change.
 *
 * This is the half of the write path that makes the wallet's approval dialog meaningful. The bot
 * builds the sentence ("action:pause / schedule:12 / value:… / nonce:…") and builds it again from
 * the submitted body before it verifies — so the text the user reads in their wallet is the text
 * that authorises the change, and a proof cannot be carried from one action to another.
 *
 * The site does not compose it, cannot compose it, and must never learn how: if this handler
 * started returning a message it had written itself, the dialog would stop describing what will
 * happen and start describing what this server claims will happen.
 *
 * 404 FROM HERE MEANS WRITES ARE OFF (SITE_BRIDGE_WRITES=false — the current production state), and
 * it is relayed as a 404 so the browser can switch its controls to "turned off" rather than show a
 * failure. Catching it at the challenge is also why the wallet is never asked to sign something
 * that could not have been delivered.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!bridgeConfigured()) return notConfigured();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // The action is checked against the six the site offers before anything is forwarded. Not for
  // the bot's safety — it validates its own input — but so that a typo here fails as a clear 400
  // rather than as a confusing 404 that the client would read as "writes are switched off".
  const action = body.action;
  if (typeof action !== "string" || !WRITE_ACTIONS.includes(action as (typeof WRITE_ACTIONS)[number])) {
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }

  const { status, json } = await bridgeCall("/site/action-challenge", {
    method: "POST",
    body: pickIntent(body),
  });
  return relay(status, json);
}
