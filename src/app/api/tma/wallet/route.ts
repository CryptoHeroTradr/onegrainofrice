import { NextResponse } from "next/server";

/**
 * THE MINI APP'S ONLY SERVER CALL — "which wallet is mine?", and nothing else.
 *
 * The Telegram Mini App at /tma needs to know whose orders to show. It cannot work that out for
 * itself: the page holds a signed `initData` blob from Telegram, but verifying that signature needs
 * the BOT TOKEN, which lives on the bot and must never come near this site or the browser. So this
 * handler forwards the opaque blob to the bot's read-only bridge and returns what the bot says.
 *
 * WHAT COMES BACK IS AN ADDRESS. Not a key, not a signature, not a capability. The Mini App then
 * reads that wallet's open Jupiter orders itself, straight from Jupiter — a public on-chain read
 * anyone could do for any address. The bot's entire contribution is identity resolution.
 *
 * WHAT DOES NOT EXIST HERE, DELIBERATELY:
 *   * no signer, no keypair, no private key, in this file or anything it imports;
 *   * no write endpoint into anyone's wallet or orders — creating and closing orders is done by
 *     the user's wallet against Jupiter, with no server of ours in the path;
 *   * no way for this route to move a lamport, however it is called.
 * `src/app/api/tma/no-signer.test.ts` in the bot repo's spirit: the bot's own test greps this path.
 *
 * The shared secret is read from the server environment and never reaches the client — same
 * discipline as the RPC proxy next door.
 */

const BOT_BRIDGE_URL = process.env.BOT_BRIDGE_URL ?? "http://127.0.0.1:3012";
const BRIDGE_SECRET = process.env.SITE_BRIDGE_SECRET ?? "";

/** The bot is on localhost; a slow reply means it is wedged, not far away. */
const TIMEOUT_MS = 5_000;

export async function POST(req: Request): Promise<NextResponse> {
  if (!BRIDGE_SECRET) {
    // Not configured is not the user's fault and not a 500 they can act on.
    return NextResponse.json(
      { ok: false, error: "The Telegram link isn't configured on this server yet." },
      { status: 503 },
    );
  }

  let initData: unknown;
  try {
    initData = ((await req.json()) as { initData?: unknown }).initData;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (typeof initData !== "string" || initData.length === 0) {
    return NextResponse.json({ ok: false, error: "initData is required" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(`${BOT_BRIDGE_URL}/site/tma-wallet`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-site-bridge-secret": BRIDGE_SECRET,
      },
      body: JSON.stringify({ initData }),
      signal: controller.signal,
      cache: "no-store",
    });
    const data = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
    if (!upstream.ok || !data) {
      // Pass the bot's status through so a 401 (unverifiable session) reads as a 401 here, but
      // never pass its body verbatim — the bot's own message is written for an operator.
      return NextResponse.json(
        { ok: false, error: "Couldn't verify this Telegram session." },
        { status: upstream.status === 401 ? 401 : 502 },
      );
    }
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: "The bot isn't reachable right now." }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
