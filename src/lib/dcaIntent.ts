/**
 * THE INTENT FIELDS, in one place, shared by the two write routes.
 *
 * Both `/api/dca/action-challenge` and `/api/dca/action` forward an intent to the bot, and they
 * MUST forward the same fields in the same shape: the bot builds the signed message from the
 * challenge's body and rebuilds it from the mutation's body, then verifies the signature against
 * the rebuild. If the two routes passed the intent along differently — one dropping an empty
 * `lifetime`, say — the messages would differ, the signature would fail, and the failure would look
 * like a wallet problem rather than a plumbing one.
 *
 * So the picking happens once, here, and both routes call it.
 */

export const WRITE_ACTIONS = ["pause", "resume", "stop-all", "amount", "interval", "caps"] as const;

/** Only the fields the bot's intent parser reads. Anything else a caller sends is dropped — an
 *  unsigned field that reached the bot could not change what was authorised (the signature covers
 *  the intent, not the envelope), but forwarding unknown keys is how that stops being true. */
const INTENT_FIELDS = ["action", "scheduleId", "amount", "interval", "per", "day", "lifetime"] as const;

export function pickIntent(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of INTENT_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}
