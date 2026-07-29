"use client";

import { agoLabel, formatRaw, serverNow, shortId, usd } from "@/lib/dcaFormat";
import type { SiteDashboard } from "@/lib/bot-contract";
import { useEffect, useState } from "react";

/**
 * WALLET MODE — a different screen, not the custodial one with the controls greyed out.
 *
 * In wallet mode the bot holds no key for this user and runs no schedule of theirs. There is
 * nothing of ours to pause, no cap of ours to set, and no execution of ours to list — the read
 * returns `schedules: []` for exactly that reason. Rendering the custodial layout with empty rows
 * and dead buttons would describe machinery that is not running, and every disabled control is an
 * invitation to ask why it is disabled.
 *
 * What there IS: the wallet they proved they own, and the recurring buys the bot SAW that wallet
 * make on-chain. Those are observations, not orders — the bot never asks Jupiter anything on
 * anyone's behalf. Live order state (how many cycles remain, cancelling) belongs to the RECURRING
 * tab on this same page, where the user's own wallet talks to Jupiter directly. Saying that plainly
 * beats showing a number here that looks authoritative and is a day old.
 */

export function DashboardWalletMode({
  data,
  ticker,
  onRefresh,
  busy,
}: {
  data: SiteDashboard;
  ticker: string;
  onRefresh: () => void;
  busy: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1_000), 1_000);
    return () => clearInterval(t);
  }, []);
  const now = serverNow(data.serverTime, elapsed);
  const w = data.walletMode;
  if (!w) return null;

  return (
    <div className="flex flex-col gap-4">
      <section className="border-2 border-nori/25 bg-steamed p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-mono text-sm font-bold tracking-widest text-nori">YOUR WALLET</h3>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="min-h-9 border-2 border-nori/30 px-3 font-mono text-xs font-bold tracking-widest text-nori/70 transition-colors hover:border-nori disabled:opacity-50"
          >
            {busy ? "…" : "REFRESH"}
          </button>
        </div>
        <p className="mt-2 font-mono text-sm break-all text-nori">
          {w.linkedWallet ? shortId(w.linkedWallet) : "—"}{" "}
          <span className="text-nori/60">(linked, proven by signature)</span>
        </p>
        <p className="mt-2 font-mono text-xs leading-relaxed text-nori/60">
          The bot holds no key for you and runs no schedule of yours — your recurring buys live in
          your own wallet, on Jupiter&apos;s program, and keep running whether or not this site or
          the bot is up. Manage them on the <span className="font-bold text-nori">RECURRING</span> tab.
        </p>
      </section>

      <section className="border-2 border-nori/25 bg-steamed p-4">
        <h3 className="font-mono text-sm font-bold tracking-widest text-nori">DCA BUYS THE BOT SAW</h3>
        {w.recentBuys.length === 0 ? (
          <p className="mt-2 font-mono text-sm text-nori/70">
            No recurring buys spotted from this wallet yet.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {w.recentBuys.map((b) => (
              <li key={`${b.at}-${b.tokensRaw}`} className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-xs">
                <span className="text-nori">
                  {formatRaw(b.tokensRaw, 6, 0)} {ticker.replace("$", "")}
                </span>
                <span className="text-nori/50">
                  {usd(b.usdIn)} · {agoLabel(b.at, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-mono text-xs leading-relaxed text-nori/60">
          These are fills observed on-chain, not your open orders. How many cycles are left, and
          cancelling, are read live from Jupiter on the RECURRING tab.
        </p>
      </section>

      <p className="font-mono text-xs leading-relaxed text-nori/60">
        🔑 Nothing custodial here, and nothing to hand over. If you ever want the bot to trade for
        you it asks for that in Telegram, with a warning you have to type back —{" "}
        <span className="font-bold text-nori">/mode</span> in the bot, never on a website.
      </p>
    </div>
  );
}
