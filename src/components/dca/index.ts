/**
 * THE SHARED SWAP/DCA INTERFACE — one implementation, mounted in every frame.
 *
 * Consumers:
 *   /home        the tokenomics trading portal   (web frame — connect and sign)
 *   /dca         the standalone full-page view   (web frame — also the hand-off target)
 *   /tma         the Telegram Mini App           (telegram frame — compose, read, hand off)
 *
 * All three import from HERE. If a fourth surface ever needs the trading UI it imports from here
 * too, and it gets the same rails, the same error copy, the same Jupiter client and the same
 * uncertain-outcome discipline — because there is only one of each to get.
 *
 * The frame is the only axis of difference, and it carries exactly one real capability: whether a
 * wallet can sign here. See `frame.tsx` for why that is a capability rather than a container name.
 */
export { SwapPanel } from "./SwapPanel";
export { RecurringPanel, type RecurringPrefill } from "./RecurringPanel";
export { ActiveDcaOrders } from "./ActiveDcaOrders";
export { TradeErrorBoundary } from "./TradeErrorBoundary";
export {
  DcaFrameProvider,
  useDcaFrame,
  handOffUrl,
  WEB_FRAME,
  type DcaFrame,
  type HandOffIntent,
} from "./frame";
