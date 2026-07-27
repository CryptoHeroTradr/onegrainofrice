import type { Metadata } from "next";
import { TelegramMiniApp } from "@/components/dca/TelegramMiniApp";

/**
 * /tma — the Telegram Mini App entry point.
 *
 * This URL goes in the bot's `web_app` buttons (MINI_APP_URL). It renders the same shared Swap/DCA
 * interface every other frame renders; only the frame differs. Opened outside Telegram it falls
 * back to the ordinary web frame, so a shared link is never a dead end.
 *
 * `noindex`: a Mini App shell is not a page anyone should reach from a search result — it is one
 * end of a launch, and out of context it says nothing useful about $RICE.
 */

export const metadata: Metadata = {
  title: "DCA",
  robots: { index: false, follow: false },
};

export default function TmaPage() {
  return <TelegramMiniApp />;
}
