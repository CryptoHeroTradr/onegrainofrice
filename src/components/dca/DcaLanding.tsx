"use client";

import { DcaWorkspace } from "@/components/dca/DcaWorkspace";
import { WEB_FRAME } from "@/components/dca/frame";
import { SiteMenu } from "@/components/journey/SiteMenu";
import { site } from "@/config/site";

/**
 * The /dca page body — the WEB frame, where a wallet connects and signs.
 *
 * A hand-off from the Telegram Mini App lands here with the schedule already composed. Two rules
 * about how that prefill is treated:
 *
 *   * It is parsed DEFENSIVELY. These numbers arrived in a URL, which means they arrived from
 *     wherever the user's browser had been — a shared link, an edited address bar, a stale message.
 *     Anything not finite and positive is dropped and the form opens on its defaults.
 *   * It is a STARTING POINT, never a decision. Every rail in RecurringPanel re-runs here against
 *     a live price and a live balance, and the wallet still shows the user exactly what they are
 *     signing. Nothing is pre-approved by having survived a hand-off.
 */

export function DcaLanding({
  total,
  per,
  every,
  cancel,
  tab,
}: {
  total?: string | undefined;
  per?: string | undefined;
  every?: string | undefined;
  cancel?: string | undefined;
  tab: "swap" | "dca";
}) {
  const n = (v: string | undefined): number | null => {
    if (v === undefined) return null;
    const parsed = Number(v);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const t = n(total);
  const p = n(per);
  const e = n(every);
  // All three or none — a half-carried schedule would silently mix handed-over values with
  // defaults and show the user a schedule nobody composed.
  const prefill = t != null && p != null && e != null ? { total: t, perCycle: p, intervalSeconds: e } : undefined;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-8">
      {/* This page carries no site bar of its own, so the 🌾 Menu is the way
          back into the rest of the site (notably for a Telegram hand-off, which
          lands here cold). Static, not fixed — nothing here scrolls under it. */}
      <SiteMenu className="self-start" />
      <header>
        <h1 className="font-display text-3xl font-bold text-nori">
          Recurring {site.ticker} buys
        </h1>
        <p className="mt-1 font-mono text-sm leading-relaxed text-nori/70">
          Your wallet signs; the schedule then runs on Jupiter&apos;s on-chain program. Nothing is
          custodial, and it keeps buying whether or not this site is up.
        </p>
      </header>

      {prefill && (
        <p className="border-2 border-olive/40 bg-olive/10 px-3 py-2.5 font-mono text-sm font-bold text-olive-deep">
          📲 Carried over from Telegram — check it below, then approve in your wallet.
        </p>
      )}
      {cancel && (
        <p className="border-2 border-tuna/40 bg-tuna/10 px-3 py-2.5 font-mono text-sm font-bold break-words text-tuna">
          Cancelling {cancel.slice(0, 4)}…{cancel.slice(-4)} — connect your wallet, then use
          CANCEL / TURN OFF on that order below.
        </p>
      )}

      <DcaWorkspace frame={WEB_FRAME} initialTab={tab} prefill={prefill} />
    </main>
  );
}
