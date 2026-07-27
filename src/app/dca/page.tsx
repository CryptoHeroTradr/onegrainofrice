import type { Metadata } from "next";
import { DcaLanding } from "@/components/dca/DcaLanding";
import { site } from "@/config/site";

/**
 * /dca — the standalone Swap/DCA page, in the ordinary browser frame.
 *
 * Two jobs. It is a real page in its own right (a focused place to set up a recurring buy, without
 * scrolling past a landing page to reach it), and it is the LANDING POINT FOR THE MINI APP'S
 * HAND-OFF: Telegram's webview cannot sign, so it sends the composed order here, to a browser where
 * the user's wallet actually works.
 *
 * The hand-off arrives as query params (`?total=&per=&every=` or `?cancel=`), which is why they are
 * read here and passed down as a prefill. See components/dca/frame.tsx for why a URL is the only
 * carrier that survives the trip out of Telegram's webview.
 */

export const metadata: Metadata = {
  title: `Recurring buys — ${site.ticker}`,
  description:
    "Set up a recurring on-chain buy through Jupiter. Non-custodial: your wallet signs, and the schedule runs on-chain whether or not this site is up.",
};

export default async function DcaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  return (
    <DcaLanding
      total={one(params.total)}
      per={one(params.per)}
      every={one(params.every)}
      cancel={one(params.cancel)}
      tab={one(params.tab) === "swap" ? "swap" : "dca"}
    />
  );
}
