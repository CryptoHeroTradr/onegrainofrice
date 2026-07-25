"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { confirmSignature, connection } from "@/lib/solana";
import { humanizeTradeError, isConfirmTimeout } from "@/lib/tradeErrors";
import {
  SOL_MINT,
  USDC_MINT,
  buildCloseRecurring,
  fetchRecurringOrders,
  type RecurringOrder,
} from "@/lib/jupiter";

/**
 * The connected wallet's open recurring (DCA) orders, read live from Jupiter's
 * program, with a user-signed CANCEL that returns funds to the wallet.
 *
 * PAUSE: Jupiter's Recurring program has NO native pause (verified —
 * /recurring/v1/pause is 404). We do NOT fake one with a hidden flag (there is no
 * server here). Pause is represented honestly as "cancel now (funds return),
 * recreate to resume" — see the note below the list.
 *
 * Cancel takes no confirmation dialog: the wallet's own approval IS the
 * confirmation. Because the close is on-chain and user-signed, it works even if
 * this site — or the bot — is entirely down.
 */

const REFRESH_MS = 30_000;

function decimalsOf(mint: string): number {
  return mint === SOL_MINT ? 9 : 6; // SOL = 9; RICE / USDC / most pump mints = 6
}
function symbolOf(mint: string, riceMint: string, ticker: string): string {
  if (mint === SOL_MINT) return "SOL";
  if (mint === riceMint) return ticker.replace("$", "");
  if (mint === USDC_MINT) return "USDC";
  return `${mint.slice(0, 4)}…`;
}
const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number, max = 4) => n.toLocaleString(undefined, { maximumFractionDigits: max });

function humanInterval(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${fmt(seconds / 3600, 1)} h`;
  return `${fmt(seconds / 86_400, 1)} d`;
}

/** createdAt/updatedAt may be a unix-seconds string or an ISO date-time. → ms, or null. */
function parseTime(v: unknown): number | null {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v !== "string" || !v) return null;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n > 1e12 ? n : n * 1000;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function humanNextCycle(nextMs: number | null): string {
  if (nextMs == null) return "—";
  const delta = nextMs - Date.now();
  if (delta <= 0) return "any moment";
  if (delta < 3600_000) return `in ~${Math.round(delta / 60_000)} min`;
  if (delta < 86_400_000) return `in ~${fmt(delta / 3600_000, 1)} h`;
  return `in ~${fmt(delta / 86_400_000, 1)} d`;
}

interface Derived {
  order: RecurringOrder;
  pair: string;
  perCycle: number;
  inSym: string;
  outSym: string;
  intervalSeconds: number;
  cyclesTotal: number;
  cyclesDone: number;
  usedIn: number;
  remainingIn: number;
  receivedOut: number;
  nextMs: number | null;
}

function derive(order: RecurringOrder, riceMint: string, ticker: string): Derived {
  const inDec = decimalsOf(order.inputMint);
  const outDec = decimalsOf(order.outputMint);
  const perCycleRaw = toNum(order.rawInAmountPerCycle);
  const depositedRaw = toNum(order.rawInDeposited);
  const usedRaw = toNum(order.rawInUsed);
  const perCycle = perCycleRaw / 10 ** inDec;
  // Cycle counts are RATIOS of raw amounts → decimals cancel, so they're exact.
  const cyclesTotal = perCycleRaw > 0 ? Math.round(depositedRaw / perCycleRaw) : 0;
  const cyclesDone = perCycleRaw > 0 ? Math.round(usedRaw / perCycleRaw) : 0;
  const intervalSeconds = toNum(order.cycleFrequency);
  const last = parseTime(order.updatedAt) ?? parseTime(order.createdAt);
  const nextMs = last != null && intervalSeconds > 0 ? last + intervalSeconds * 1000 : null;
  return {
    order,
    pair: `${symbolOf(order.inputMint, riceMint, ticker)} → ${symbolOf(order.outputMint, riceMint, ticker)}`,
    inSym: symbolOf(order.inputMint, riceMint, ticker),
    outSym: symbolOf(order.outputMint, riceMint, ticker),
    perCycle,
    intervalSeconds,
    cyclesTotal,
    cyclesDone,
    usedIn: usedRaw / 10 ** inDec,
    remainingIn: (depositedRaw - usedRaw) / 10 ** inDec,
    receivedOut: toNum(order.rawOutReceived) / 10 ** outDec,
    nextMs,
  };
}

export function ActiveDcaOrders({
  riceMint,
  ticker,
  refreshSignal,
}: {
  riceMint: string;
  ticker: string;
  /** Bumped by the create form so a new order shows immediately. */
  refreshSignal: number;
}) {
  const { publicKey, sendTransaction } = useWallet();
  const [orders, setOrders] = useState<RecurringOrder[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ key: string; msg: string } | null>(null);
  const [rowSubmitted, setRowSubmitted] = useState<{ key: string; sig: string } | null>(null);

  const owner = publicKey ? publicKey.toBase58() : null;

  const load = useCallback(async () => {
    if (!owner) return;
    try {
      setOrders(await fetchRecurringOrders(owner));
      setListError(null);
    } catch (err) {
      setListError(humanizeTradeError(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  useEffect(() => {
    if (!owner) {
      setOrders(null);
      return;
    }
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, refreshSignal]);

  const cancel = useCallback(
    async (orderKey: string) => {
      if (!publicKey) return;
      setBusyKey(orderKey);
      setRowError(null);
      setRowSubmitted(null);
      let sig: string | undefined;
      try {
        const { transaction } = await buildCloseRecurring(orderKey, publicKey.toBase58());
        sig = await sendTransaction(transaction, connection); // wallet approval IS the confirmation
        await confirmSignature(connection, sig);
        await load(); // funds returned; the order leaves the list
      } catch (err) {
        // A confirm timeout after a send is NOT a failure and is NEVER auto-retried.
        if (sig && isConfirmTimeout(err)) {
          setRowSubmitted({ key: orderKey, sig });
          setTimeout(() => void load(), 8000);
        } else {
          setRowError({ key: orderKey, msg: humanizeTradeError(err) });
        }
      } finally {
        setBusyKey(null);
      }
    },
    [publicKey, sendTransaction, load],
  );

  if (!owner) return null;

  return (
    <div className="mt-6 border-t-2 border-nori/20 pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-mono text-sm font-bold tracking-widest text-nori uppercase">
          your recurring orders
        </h4>
        {orders != null && (
          <span className="font-mono text-xs font-bold text-nori/60">
            {orders.length === 0 ? "none active" : `${orders.length} active`}
          </span>
        )}
      </div>

      {listError && <p className="mt-2 font-mono text-sm font-bold text-tuna">{listError}</p>}

      {orders == null && !listError && (
        <p className="mt-2 font-mono text-sm font-bold text-nori/60">Loading your orders…</p>
      )}

      {orders != null && orders.length === 0 && !listError && (
        <p className="mt-2 font-mono text-sm text-nori/60">
          No active recurring orders. Create one above.
        </p>
      )}

      {orders != null && orders.length > 0 && (
        <ul className="mt-3 space-y-3">
          {orders.map((o) => {
            const d = derive(o, riceMint, ticker);
            const busy = busyKey === o.orderKey;
            return (
              <li key={o.orderKey} className="border-2 border-nori/25 bg-bone px-3 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-lg font-bold text-nori">{d.pair}</span>
                  <a
                    href={`https://solscan.io/account/${o.orderKey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs font-bold text-olive-deep underline-offset-2 hover:underline"
                  >
                    {o.orderKey.slice(0, 4)}…{o.orderKey.slice(-4)} ↗
                  </a>
                </div>

                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm">
                  <Row label="each cycle" value={`${fmt(d.perCycle)} ${d.inSym} every ${humanInterval(d.intervalSeconds)}`} />
                  <Row label="filled" value={`${d.cyclesDone}/${d.cyclesTotal} cycles`} />
                  <Row label="remaining" value={`${fmt(d.remainingIn)} ${d.inSym}`} />
                  <Row label="received" value={`${fmt(d.receivedOut)} ${d.outSym}`} />
                  <Row label="next cycle" value={humanNextCycle(d.nextMs)} />
                </dl>

                <button
                  type="button"
                  onClick={() => void cancel(o.orderKey)}
                  disabled={busy}
                  className="mt-3 min-h-10 border-2 border-tuna px-4 font-mono text-sm font-bold tracking-widest text-tuna transition-colors hover:bg-tuna hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tuna disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "APPROVE IN WALLET…" : "CANCEL / TURN OFF"}
                </button>

                {rowSubmitted?.key === o.orderKey && (
                  <p className="mt-2 font-mono text-xs font-bold text-nori/70">
                    ⏳ Close sent — it may still complete; don&apos;t re-submit.{" "}
                    <a
                      href={`https://solscan.io/tx/${rowSubmitted.sig}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      check on Solscan →
                    </a>
                  </p>
                )}
                {rowError?.key === o.orderKey && (
                  <p className="mt-2 font-mono text-xs font-bold break-words text-tuna">{rowError.msg}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* PAUSE — honest, because the program has no native pause. */}
      <p className="mt-4 font-mono text-xs leading-relaxed text-nori/60">
        <strong className="text-nori/80">No pause?</strong> Jupiter&apos;s program can&apos;t pause a
        recurring order — only run or close it. To pause, cancel it (your remaining funds return to your
        wallet) and create a new one when you want to resume. We won&apos;t fake a pause the chain
        can&apos;t honor. Canceling is on-chain and signed by you, so it works even if this site is down.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-nori/10 pb-1">
      <dt className="font-bold tracking-wide text-nori/60 uppercase">{label}</dt>
      <dd className="m-0 text-right font-bold break-words text-nori">{value}</dd>
    </div>
  );
}
