import { encodeBase58 } from "@/lib/base58";
import type { SiteDashboard } from "@/lib/bot-contract";
import { readJsonOr } from "@/lib/readJson";

/**
 * THE BROWSER'S CLIENT for the bot's dashboard bridge.
 *
 * Everything the dashboard does is one of two shapes, and both end at the user's wallet:
 *
 *   READ:  ask for a nonce -> the wallet signs the message THE BOT RETURNED -> post it back.
 *   WRITE: ask for a nonce FOR A SPECIFIC INTENT -> the wallet signs the message THE BOT RETURNED
 *          -> post the mutation -> read again.
 *
 * THE CLIENT NEVER COMPOSES THE SIGNED BYTES. It signs `message` exactly as the bridge sent it.
 * That is the property that makes the wallet's approval dialog meaningful: the text the user reads
 * ("action:pause / schedule:12 / …") is the text that is verified, so approving cannot authorise
 * something other than what was shown. If this file ever starts building that string itself, the
 * dialog becomes decoration — and a test asserts it does not.
 *
 * WRITES MAY BE TURNED OFF, AND THAT IS A NORMAL STATE, NOT AN ERROR. The bot ships with
 * SITE_BRIDGE_WRITES=false; the six mutation routes are then not mounted and answer 404. That is
 * the CURRENT PRODUCTION STATE, so it is modelled as a first-class outcome ({@link WritesDisabled})
 * rather than an exception: the dashboard reads perfectly and shows its controls as switched off.
 * Treating it as a failure would put an error banner on a page that is working exactly as deployed.
 */

/** The six mutations, spelled as the bridge's paths do. */
export type DcaAction = "pause" | "resume" | "stop-all" | "amount" | "interval" | "caps";

/** What a control wants done. Mirrors the bridge's intent parsing — id-taking or account-wide. */
export type DcaIntent =
  | { readonly action: "pause" | "resume"; readonly scheduleId: number }
  | { readonly action: "stop-all" }
  | { readonly action: "amount"; readonly scheduleId: number; readonly amount: string }
  | { readonly action: "interval"; readonly scheduleId: number; readonly interval: string }
  | { readonly action: "caps"; readonly per: string; readonly day: string; readonly lifetime?: string };

/** A wallet that can prove itself. Exactly what wallet-adapter gives us, narrowed to what is used. */
export interface SigningWallet {
  readonly address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export type WriteOutcome =
  /** The bot did it. `message` is the panel's own sentence — show it verbatim. */
  | { readonly kind: "ok"; readonly message: string }
  /** SITE_BRIDGE_WRITES=false: the route is not mounted. Not an error; a configuration. */
  | { readonly kind: "writes-disabled" }
  /** A guard refused (min buy, interval floor, cap ceiling, ownership, an UNKNOWN halt). The
   *  bot's message is the panel's, verbatim, and is meant to be read by this user. */
  | { readonly kind: "refused"; readonly message: string }
  /** The proof went stale between composing and submitting — ask for a refresh, never retry
   *  silently: a silent retry would re-sign and re-submit something the user approved a while ago
   *  against a view that has since moved. */
  | { readonly kind: "stale" }
  /** The wallet declined, or the bridge is unreachable. */
  | { readonly kind: "error"; readonly message: string };

/** How long a signed proof is worth submitting. The bridge's nonce TTL is 5 minutes; this is the
 *  client-side half of the same rule, so a control acting on a long-idle view refuses locally
 *  instead of burning a signature the bot would reject anyway. */
export const VIEW_MAX_AGE_MS = 4 * 60_000;

/**
 * THE ONE MESSAGE THIS SIDE COMPOSES, and the exception that proves the rule above.
 *
 * Linking has no challenge endpoint: the bot cannot mint a nonce for a wallet it does not yet know,
 * and the freshness is carried by the CODE instead — single-use, ten minutes, issued in a DM. So
 * this string is built here, and it must match the bot's `linkMessage` byte for byte or the
 * signature will not verify.
 *
 * A duplicated constant is a thing that drifts, so it does not rely on care: `test/dca-client.test.ts`
 * reads the bot's `src/site-bridge/messages.ts` and asserts this produces the identical string.
 * Every OTHER message — every read, every mutation — comes back from the bot and is signed exactly
 * as received.
 */
export function linkMessage(wallet: string, code: string): string {
  return `Link RICE site\nwallet:${wallet}\ncode:${code}`;
}

const enc = new TextEncoder();

async function postJson(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await readJsonOr<Record<string, unknown>>(res, {});
  return { status: res.status, json };
}

/** Sign exactly what the bridge sent back, and hand it over base58 — never a message we built. */
async function proveOver(wallet: SigningWallet, message: string): Promise<string> {
  return encodeBase58(await wallet.signMessage(enc.encode(message)));
}

/**
 * READ the dashboard for a wallet.
 *
 * Throws only when the read genuinely could not happen (the wallet refused, the bridge is down).
 * An UNLINKED wallet is not that: it comes back as a valid dashboard with `linked: false`, because
 * the bot answers the question "whose is this?" with "nobody's" rather than with an error.
 */
export async function readDashboard(wallet: SigningWallet): Promise<SiteDashboard> {
  const challenge = await fetch("/api/dca/challenge", { cache: "no-store" });
  const c = await readJsonOr<{ nonce?: string; message?: string }>(challenge, {});
  if (!challenge.ok || !c.nonce || !c.message) throw new Error("The bot isn't reachable right now.");

  const signature = await proveOver(wallet, c.message);
  const { status, json } = await postJson("/api/dca/dashboard", {
    wallet: wallet.address,
    nonce: c.nonce,
    signature,
  });
  if (status !== 200 || json.ok !== true) {
    throw new Error(typeof json.error === "string" ? json.error : "Couldn't read your dashboard.");
  }
  return json as unknown as SiteDashboard;
}

/**
 * RUN a mutation: challenge for THIS intent, sign what comes back, submit.
 *
 * `viewAgeMs` is the age of the dashboard the control was clicked on. A control acting on a view
 * older than the nonce window refuses BEFORE asking the wallet to sign — the same discipline as the
 * panel's stale-view rule, and the reason is the same: the user is about to approve a change to a
 * state they may no longer be looking at.
 */
export async function runAction(
  wallet: SigningWallet,
  intent: DcaIntent,
  viewAgeMs: number,
): Promise<WriteOutcome> {
  if (viewAgeMs > VIEW_MAX_AGE_MS) return { kind: "stale" };

  const challenge = await postJson("/api/dca/action-challenge", intent);
  // 404 here is the same fact as 404 on the mutation: with writes off, neither route is mounted.
  // Detecting it at the challenge means the wallet is never asked to sign something undeliverable.
  if (challenge.status === 404) return { kind: "writes-disabled" };
  const nonce = challenge.json.nonce;
  const message = challenge.json.message;
  if (challenge.status !== 200 || typeof nonce !== "string" || typeof message !== "string") {
    return { kind: "error", message: errorOf(challenge.json, "Couldn't prepare that change.") };
  }

  let signature: string;
  try {
    signature = await proveOver(wallet, message);
  } catch {
    // A declined signature is a decision, not a fault. Say so plainly and change nothing.
    return { kind: "error", message: "You declined the signature, so nothing was changed." };
  }

  const { status, json } = await postJson("/api/dca/action", {
    ...intent,
    wallet: wallet.address,
    nonce,
    signature,
  });
  if (status === 404) return { kind: "writes-disabled" };
  if (status === 200 && json.ok === true) {
    return { kind: "ok", message: typeof json.message === "string" ? json.message : "Done." };
  }
  if (status === 401) return { kind: "stale" }; // a consumed or expired nonce
  if (status === 400 || status === 403) return { kind: "refused", message: errorOf(json, "That change was refused.") };
  return { kind: "error", message: errorOf(json, "The bot isn't reachable right now.") };
}

function errorOf(json: Record<string, unknown>, fallback: string): string {
  return typeof json.error === "string" && json.error.length > 0 ? json.error : fallback;
}
