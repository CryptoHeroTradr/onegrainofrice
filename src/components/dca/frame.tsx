"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * ONE INTERFACE, TWO FRAMES.
 *
 * The Swap/DCA panels render in three places — the /home trading portal, the standalone /dca page,
 * and the Telegram Mini App at /tma — and they are the SAME components in all three. This module
 * holds the only thing that genuinely differs between them, so that difference lives in one small
 * typed object instead of being smeared through the panels as `if (isTelegram)`.
 *
 * WHAT DIFFERS IS EXACTLY ONE THING: whether a transaction can be signed here.
 *
 * A Telegram Mini App runs in Telegram's own webview, which has no browser extensions and no
 * injected wallet provider — so wallet-adapter's Wallet Standard discovery finds nothing, and
 * there is no wallet to connect to. That is a property of the container, not a bug we can fix, and
 * not something a server-side signer may be introduced to paper over: a bot server that signs for
 * the user is send-key custody wearing wallet mode's label, and this whole path exists to not be
 * that.
 *
 * So the Telegram frame COMPOSES and the browser frame SIGNS. The Mini App shows live order state
 * and lets the user build an order, then hands the composed order to the full site — in the system
 * browser, where their wallet works — via {@link DcaFrame.handOff}. Nothing is retyped, and the
 * transaction is signed by the same wallet-adapter code path the website has always used.
 *
 * The panels never ask "am I in Telegram". They ask "can I sign here", and when the answer is no
 * they render the hand-off the frame gave them.
 */

/** What the user is trying to do, carried across the hand-off so nothing is retyped. */
export type HandOffIntent =
  | { readonly kind: "swap" }
  | {
      readonly kind: "dca-create";
      /** Input-mint human units per cycle. */
      readonly perCycle: number;
      /** Total human units to deposit. */
      readonly total: number;
      readonly intervalSeconds: number;
    }
  | { readonly kind: "dca-cancel"; readonly orderKey: string };

export interface DcaFrame {
  readonly kind: "web" | "telegram";
  /**
   * Can a wallet sign in this frame? `false` makes every signing control render as a hand-off
   * instead. It is deliberately a capability rather than a container name — a future frame that
   * CAN sign inside Telegram would set this true and change nothing else.
   */
  readonly canSign: boolean;
  /**
   * The wallet whose orders are displayed, when the frame knows it without a connection.
   *
   * In the Telegram frame this is the address the user PROVED they own via the Phase 6 link, read
   * back through the bot's read-only bridge. It is an address and nothing else — no key, no
   * signing authority, no ability to act on their behalf. In the web frame it is null, because
   * there the connected wallet is the answer and wallet-adapter supplies it.
   */
  readonly readOnlyOwner: string | null;
  /** Open the full site to finish an action this frame cannot sign. No-op when `canSign`. */
  readonly handOff: (intent: HandOffIntent) => void;
  /** Button copy for the hand-off, e.g. "OPEN IN BROWSER TO SIGN". */
  readonly handOffLabel: string;
}

/**
 * The default: an ordinary browser page where wallet-adapter works. Every existing mount gets this
 * without changing a line, which is what makes the extraction safe to land in one go.
 */
export const WEB_FRAME: DcaFrame = {
  kind: "web",
  canSign: true,
  readOnlyOwner: null,
  handOff: () => {},
  handOffLabel: "",
};

const FrameContext = createContext<DcaFrame>(WEB_FRAME);

export function DcaFrameProvider({
  frame,
  children,
}: {
  frame: DcaFrame;
  children: React.ReactNode;
}) {
  // Memoised on the fields the panels actually read, so a parent re-render does not remount the
  // whole trading UI mid-quote.
  const value = useMemo(
    () => frame,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame.kind, frame.canSign, frame.readOnlyOwner, frame.handOffLabel, frame.handOff],
  );
  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
}

export function useDcaFrame(): DcaFrame {
  return useContext(FrameContext);
}

/**
 * The hand-off target: the standalone /dca page, with the composed order in the query string.
 *
 * Query params rather than a POST or a stashed session, because the hand-off crosses an app
 * boundary — Telegram's webview to the system browser — where nothing of ours is shared. A URL is
 * the only thing that reliably survives that trip.
 *
 * Amounts travel as the user typed them, NOT as base units: they are re-validated and re-quoted on
 * arrival against a live price, and shipping a pre-computed base-unit amount across a hand-off
 * would be a stale number wearing the authority of an exact one.
 */
export function handOffUrl(origin: string, basePath: string, intent: HandOffIntent): string {
  const url = new URL(`${basePath}/dca`, origin);
  if (intent.kind === "dca-create") {
    url.searchParams.set("total", String(intent.total));
    url.searchParams.set("per", String(intent.perCycle));
    url.searchParams.set("every", String(intent.intervalSeconds));
  } else if (intent.kind === "dca-cancel") {
    url.searchParams.set("cancel", intent.orderKey);
  } else {
    url.searchParams.set("tab", "swap");
  }
  return url.toString();
}
