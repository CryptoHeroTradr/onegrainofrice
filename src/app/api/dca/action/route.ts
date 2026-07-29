import { NextResponse } from "next/server";
import { bridgeCall, bridgeConfigured, notConfigured, relay } from "@/lib/botBridge";
import { WRITE_ACTIONS, pickIntent } from "@/lib/dcaIntent";

/**
 * SUBMIT one signed mutation. The site's entire role is to carry it.
 *
 * Everything that decides whether this change may happen lives on the bot: the shared secret, the
 * signature over this exact intent, the single-use nonce, the wallet→user resolution, the
 * membership and custody checks, and then the Telegram panel's own `apply*` — which is what makes
 * a guard that blocks the panel block the site in the same words. None of that is re-implemented
 * here and none of it could be: this handler has no idea whose schedule this is.
 *
 * NO KEY-TAKING ACTION EXISTS ON THIS PATH. Importing, generating, exporting or unlocking a wallet
 * is refused by the bot BY NAME, and the site never offers it — there is no key field anywhere in
 * this dashboard, and a test greps for one. Custody is a Telegram conversation.
 *
 * The bot's status comes back untouched:
 *   404 — writes are switched off (SITE_BRIDGE_WRITES=false). The controls render as off.
 *   400/403 — a guard refused, and the bot's sentence is the panel's own. Shown verbatim.
 *   401 — the proof was stale or already spent. The dashboard re-reads rather than re-signing.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!bridgeConfigured()) return notConfigured();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const action = body.action;
  if (typeof action !== "string" || !WRITE_ACTIONS.includes(action as (typeof WRITE_ACTIONS)[number])) {
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
  const { wallet, nonce, signature } = body as { wallet?: unknown; nonce?: unknown; signature?: unknown };
  if (typeof wallet !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
    return NextResponse.json({ ok: false, error: "wallet, nonce and signature are required" }, { status: 400 });
  }

  // The path names the action; the SIGNED MESSAGE names it too, so a body whose action disagrees
  // with what was signed cannot verify. Same fields as the challenge — see lib/dcaIntent.ts.
  const { status, json } = await bridgeCall(`/site/${action}`, {
    method: "POST",
    body: { ...pickIntent(body), wallet, nonce, signature },
  });
  return relay(status, json);
}
