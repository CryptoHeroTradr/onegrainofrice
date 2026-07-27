"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useCharityWalletConnection } from "@/components/charity/CharityWalletProvider";
import { ActiveDcaOrders } from "@/components/dca/ActiveDcaOrders";
import { useDcaFrame } from "@/components/dca/frame";
import { confirmSignature, connection } from "@/lib/solana";
import { solscanTx } from "@/lib/payments";
import { humanizeTradeError, isConfirmTimeout } from "@/lib/tradeErrors";
import {
  SOL_MINT,
  SOL_DECIMALS,
  buildRecurringOrder,
  fetchRecurringOrders,
  getSolUsd,
  toBaseUnits,
  RECURRING_FEE_BPS,
  RECURRING_MIN_USD_PER_CYCLE,
} from "@/lib/jupiter";

/**
 * The DCA tab: a recurring $RICE buy on Jupiter's Recurring program. The user sets
 * a total budget, a per-cycle amount, and an interval; approves ONE deposit-and-
 * schedule transaction in their wallet. The site never holds funds and never signs.
 *
 * Once created the order runs ON-CHAIN — there is no server-side schedule here, and
 * it keeps executing even if this site is down (stated in the UI).
 *
 * Rails mirror the bot's spirit (Phase 16c), enforced BEFORE building the tx:
 * interval ≥ 1 min; per-cycle ≥ Jupiter's ~$50 minimum; per-cycle + total capped so
 * a fat-finger can't schedule the whole wallet. Jupiter's 0.1% fee is stated plainly.
 *
 * FRAMES: identical component on the website and in the Telegram Mini App. Where the frame cannot
 * sign (Telegram's webview has no wallet — see components/dca/frame.tsx), every input still works
 * and every rail is still enforced; only the final button changes, from "start" to a hand-off that
 * carries the composed schedule to the browser. The validation a user sees is therefore the same
 * validation in both places, because it is the same code — not a Telegram-shaped copy of it.
 */

const MIN_INTERVAL_MINUTES = 1; // Jupiter accepts lower, but a sub-minute DCA is nonsensical (bot's rail).
const MIN_CYCLES = 2; // a DCA is at least two buys; one buy is just a swap.
const MAX_CYCLES = 500; // sanity ceiling on the schedule length.
const MAX_TOTAL_SOL = 100; // fat-finger ceiling on the deposit.
const SOL_FEE_BUFFER = 0.01; // keep a little SOL for the signing fee.

const INTERVAL_UNITS = [
  { key: "min", label: "min", secs: 60 },
  { key: "hour", label: "hours", secs: 3600 },
  { key: "day", label: "days", secs: 86400 },
] as const;
type IntervalUnit = (typeof INTERVAL_UNITS)[number]["key"];

type Status = "idle" | "signing" | "confirming" | "submitted" | "success" | "error";

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmt = (n: number, max = 4) => n.toLocaleString(undefined, { maximumFractionDigits: max });

/** "~45 min" / "~10 hours" / "~3.5 days" — the span a schedule covers. */
function humanDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `~${fmt(seconds / 3600, 1)} hours`;
  return `~${fmt(seconds / 86_400, 1)} days`;
}

/** A schedule handed over from another frame, already in human units. */
export interface RecurringPrefill {
  readonly total: number;
  readonly perCycle: number;
  readonly intervalSeconds: number;
}

/** Seconds → the largest whole unit that divides them, so "86400" arrives as "1 day", not "1440 min". */
function splitInterval(seconds: number): { value: string; unit: IntervalUnit } {
  for (const u of [...INTERVAL_UNITS].reverse()) {
    if (seconds % u.secs === 0 && seconds >= u.secs) return { value: String(seconds / u.secs), unit: u.key };
  }
  return { value: String(Math.max(1, Math.round(seconds / 60))), unit: "min" };
}

export function RecurringPanel({
  riceMint,
  ticker,
  prefill,
}: {
  riceMint: string;
  ticker: string;
  /** A schedule composed in another frame (the Mini App) and handed here to be signed. */
  prefill?: RecurringPrefill | undefined;
}) {
  const { publicKey, sendTransaction } = useWallet();
  const { connected, connecting, connect, disconnect, shortAddress } = useCharityWalletConnection();
  const frame = useDcaFrame();

  const prefilledInterval = prefill ? splitInterval(prefill.intervalSeconds) : null;
  const [totalStr, setTotalStr] = useState(prefill ? String(prefill.total) : "5");
  const [perCycleStr, setPerCycleStr] = useState(prefill ? String(prefill.perCycle) : "1");
  const [intervalStr, setIntervalStr] = useState(prefilledInterval?.value ?? "1");
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(prefilledInterval?.unit ?? "day");

  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [rpcDown, setRpcDown] = useState(false);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [orderKey, setOrderKey] = useState<string | null>(null);
  /** Bumped after a create so the orders list below refetches immediately. */
  const [ordersRefresh, setOrdersRefresh] = useState(0);

  // Live SOL/USD (to price the per-cycle $50 minimum), refreshed while mounted.
  useEffect(() => {
    let cancelled = false;
    const load = () => void getSolUsd().then((v) => !cancelled && v != null && setSolUsd(v));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  /**
   * Whose SOL we are spending.
   *
   * The connected wallet where there is one; otherwise the frame's proven read-only address. A
   * balance is public information, so reading it needs no connection and no permission — and it is
   * what lets the Mini App enforce "not enough SOL" while composing, instead of the user finding
   * out only after they have switched apps to sign.
   */
  const ownerAddress = publicKey ? publicKey.toBase58() : frame.readOnlyOwner;

  // SOL balance (so the total can be checked against it).
  const loadBalance = useCallback(async () => {
    if (!ownerAddress) return;
    try {
      const lamports = await connection.getBalance(new PublicKey(ownerAddress));
      setSolBalance(lamports / LAMPORTS_PER_SOL);
      setRpcDown(false);
    } catch {
      setRpcDown(true);
    }
  }, [ownerAddress]);
  useEffect(() => {
    if (!ownerAddress) {
      setSolBalance(null);
      return;
    }
    void loadBalance();
  }, [ownerAddress, loadBalance]);

  // ── Derived schedule ───────────────────────────────────────────────────────
  const total = num(totalStr);
  const perCycle = num(perCycleStr);
  const unitSecs = INTERVAL_UNITS.find((u) => u.key === intervalUnit)!.secs;
  const intervalSeconds = Math.round(num(intervalStr) * unitSecs);
  const intervalMinutes = intervalSeconds / 60;
  const numberOfOrders = perCycle > 0 ? Math.floor(total / perCycle) : 0;
  // Deposit exactly N whole cycles so each cycle is precisely the per-cycle amount;
  // any remainder below one cycle is left unscheduled.
  const depositSol = perCycle * numberOfOrders;
  const spanSeconds = numberOfOrders * intervalSeconds;
  const perCycleUsd = solUsd != null ? perCycle * solUsd : null;
  const minPerCycleSol = solUsd != null ? RECURRING_MIN_USD_PER_CYCLE / solUsd : null;

  // ── Validation (before building the tx) ─────────────────────────────────────
  const complete = total > 0 && perCycle > 0 && num(intervalStr) > 0;
  const validationError = ((): string | null => {
    if (!complete) return null;
    if (intervalMinutes < MIN_INTERVAL_MINUTES) return `Interval must be at least ${MIN_INTERVAL_MINUTES} minute.`;
    if (perCycle > total) return "Per-cycle amount can't exceed the total.";
    if (total > MAX_TOTAL_SOL) return `Total is capped at ${MAX_TOTAL_SOL} SOL here (fat-finger guard).`;
    if (numberOfOrders < MIN_CYCLES) return "That's fewer than 2 cycles — raise the total or lower the per-cycle amount.";
    if (numberOfOrders > MAX_CYCLES) return `That's over ${MAX_CYCLES} cycles — raise the per-cycle amount or lower the total.`;
    if (perCycleUsd != null && perCycleUsd < RECURRING_MIN_USD_PER_CYCLE)
      return `Each cycle must be worth ≥ $${RECURRING_MIN_USD_PER_CYCLE} (Jupiter's minimum)${
        minPerCycleSol != null ? ` — about ${fmt(minPerCycleSol, 3)} SOL/cycle at the current price` : ""
      }.`;
    if (!rpcDown && solBalance != null && depositSol > solBalance - SOL_FEE_BUFFER)
      return `Not enough SOL — you have ${fmt(solBalance, 4)} (leave ≈${SOL_FEE_BUFFER} for fees).`;
    return null;
  })();
  const canCreate = complete && validationError == null && status !== "signing" && status !== "confirming" && status !== "submitted";
  const busy = status === "signing" || status === "confirming";

  const setMax = () => {
    if (solBalance == null) return;
    setTotalStr(String(Math.max(0, Math.floor((solBalance - SOL_FEE_BUFFER) * 1000) / 1000)));
  };

  const create = useCallback(async () => {
    if (!publicKey || !canCreate) return;
    setError(null);
    setSig(null);
    setOrderKey(null);
    setStatus("signing");
    let signature: string | undefined;
    try {
      const { transaction } = await buildRecurringOrder(
        {
          inputMint: SOL_MINT,
          outputMint: riceMint,
          inAmount: toBaseUnits(depositSol, SOL_DECIMALS),
          numberOfOrders,
          interval: intervalSeconds,
        },
        publicKey.toBase58(),
      );
      signature = await sendTransaction(transaction, connection); // wallet signs + sends
      setSig(signature);
      setStatus("confirming");
      await confirmSignature(connection, signature);
      setStatus("success");
      setOrdersRefresh((n) => n + 1);
      void loadBalance();
      // Read back the created order's on-chain account (best-effort; indexing may lag).
      try {
        const orders = await fetchRecurringOrders(publicKey.toBase58());
        const newest = orders
          .slice()
          .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))[0];
        if (newest?.orderKey) setOrderKey(newest.orderKey);
      } catch {
        /* keep the tx signature as the on-chain reference */
      }
    } catch (err) {
      // Uncertain-outcome discipline: a confirm timeout after a send is NOT a failure,
      // and we NEVER auto-retry (a blind retry is a second on-chain order).
      if (signature && isConfirmTimeout(err)) {
        setStatus("submitted");
        setOrdersRefresh((n) => n + 1); // the order may have been created; surface it
        void loadBalance();
      } else {
        setError(humanizeTradeError(err));
        setStatus("error");
      }
    }
  }, [publicKey, canCreate, riceMint, depositSol, numberOfOrders, intervalSeconds, sendTransaction, loadBalance]);

  const intervalLabel = `${fmt(num(intervalStr), 2)} ${INTERVAL_UNITS.find((u) => u.key === intervalUnit)!.label}`;

  return (
    <div className="flex flex-col gap-3">
      {/* Wallet row. Where the frame can't sign there is nothing to connect TO, so it states the
          linked wallet instead of offering a button that would open a wallet picker with no
          wallets in it. */}
      {frame.canSign ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-nori/30 bg-bone px-3 py-2.5">
          <span className="font-mono text-sm font-bold tracking-wide text-nori/70 uppercase">
            wallet:{" "}
            <strong className={connected ? "text-nori" : "text-nori/70"}>
              {connected ? shortAddress : "disconnected"}
            </strong>
          </span>
          <button
            type="button"
            onClick={connected ? disconnect : connect}
            disabled={connecting}
            className={
              connected
                ? "min-h-10 border-2 border-nori px-4 font-mono text-sm font-bold tracking-widest text-nori transition-colors hover:bg-nori hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
                : "min-h-10 bg-olive px-4 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
            }
          >
            {connecting ? "CONNECTING…" : connected ? "DISCONNECT" : "CONNECT WALLET"}
          </button>
        </div>
      ) : (
        <div className="border-2 border-nori/30 bg-bone px-3 py-2.5">
          <span className="font-mono text-sm font-bold tracking-wide text-nori/70 uppercase">
            wallet:{" "}
            <strong className="text-nori">
              {frame.readOnlyOwner
                ? `${frame.readOnlyOwner.slice(0, 4)}…${frame.readOnlyOwner.slice(-4)}`
                : "not linked"}
            </strong>
          </span>
        </div>
      )}

      {/* Total deposit */}
      <Field
        label="total to deposit"
        balance={rpcDown ? "unavailable" : solBalance == null ? "—" : `${fmt(solBalance, 4)} SOL`}
        symbol="SOL"
      >
        <div className="flex items-center gap-2">
          <input
            inputMode="decimal"
            value={totalStr}
            onChange={(e) => setTotalStr(e.target.value.replace(/[^\d.]/g, ""))}
            aria-label="Total SOL to deposit"
            className="w-full min-w-0 bg-transparent font-display text-3xl font-bold text-nori outline-none"
          />
          <button
            type="button"
            onClick={setMax}
            disabled={!connected || solBalance == null}
            className="shrink-0 border-2 border-nori/40 px-2.5 py-1 font-mono text-xs font-bold tracking-widest text-nori transition-colors hover:border-nori hover:bg-nori hover:text-bone disabled:opacity-40"
          >
            MAX
          </button>
        </div>
      </Field>

      {/* Per cycle */}
      <Field
        label="each cycle buys"
        balance={perCycleUsd != null ? `≈ $${fmt(perCycleUsd, 2)}` : ""}
        symbol="SOL"
      >
        <input
          inputMode="decimal"
          value={perCycleStr}
          onChange={(e) => setPerCycleStr(e.target.value.replace(/[^\d.]/g, ""))}
          aria-label="SOL per cycle"
          className="w-full min-w-0 bg-transparent font-display text-3xl font-bold text-nori outline-none"
        />
      </Field>

      {/* Interval */}
      <div className="border-2 border-nori/30 bg-bone px-3 py-3">
        <div className="mb-1 font-mono text-sm font-bold tracking-wide text-nori/70 uppercase">
          every
        </div>
        <div className="flex items-center gap-2">
          <input
            inputMode="decimal"
            value={intervalStr}
            onChange={(e) => setIntervalStr(e.target.value.replace(/[^\d.]/g, ""))}
            aria-label="Interval amount"
            className="w-20 min-w-0 bg-transparent font-display text-3xl font-bold text-nori outline-none"
          />
          <div className="flex gap-1.5">
            {INTERVAL_UNITS.map((u) => (
              <button
                key={u.key}
                type="button"
                onClick={() => setIntervalUnit(u.key)}
                className={`min-h-9 border-2 px-3 font-mono text-sm font-bold transition-colors ${
                  intervalUnit === u.key
                    ? "border-olive bg-olive/20 text-olive-deep"
                    : "border-nori/30 text-nori/70 hover:border-nori"
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Derived schedule preview */}
      {complete && validationError == null && (
        <div className="border-2 border-olive/40 bg-olive/10 px-3 py-3">
          <p className="font-mono text-sm font-bold text-olive-deep uppercase tracking-widest">your schedule</p>
          <p className="mt-1 font-display text-lg font-bold text-nori">
            {fmt(perCycle)} SOL of {ticker} every {intervalLabel}
          </p>
          <p className="mt-0.5 font-mono text-sm text-nori/80">
            {numberOfOrders} buys over {humanDuration(spanSeconds)} · depositing {fmt(depositSol)} SOL
            {depositSol < total ? ` (of ${fmt(total)}; the rest is under one cycle)` : ""}
          </p>
        </div>
      )}

      {/* Fees + on-chain honesty */}
      <p className="font-mono text-xs leading-relaxed text-nori/60">
        Jupiter charges {RECURRING_FEE_BPS / 100}% per cycle, and requires each cycle to be worth at
        least ${RECURRING_MIN_USD_PER_CYCLE}
        {minPerCycleSol != null ? ` (≈${fmt(minPerCycleSol, 3)} SOL now)` : ""}. You approve one
        deposit-and-schedule transaction; after that the order runs on Jupiter&apos;s on-chain program
        and keeps buying even if this site is down. Non-custodial — the site never holds funds or signs.
      </p>

      {/* Validation / action */}
      {complete && validationError && (
        <p className="font-mono text-sm font-bold break-words text-tuna">{validationError}</p>
      )}

      {/* THE HAND-OFF. This frame cannot sign, so the composed schedule travels to one that can,
          rather than the button lying about what it will do. Enabled on the same `canCreate` as
          the real thing: a schedule that would be refused here would be refused there too, and
          learning that after switching apps is a worse place to learn it. */}
      {!frame.canSign ? (
        <button
          type="button"
          onClick={() =>
            frame.handOff({ kind: "dca-create", perCycle, total: depositSol, intervalSeconds })
          }
          disabled={!complete || validationError != null}
          className="inline-flex min-h-13 items-center justify-center bg-olive px-6 font-mono text-base font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep disabled:cursor-not-allowed disabled:bg-nori/30"
        >
          {frame.handOffLabel}
        </button>
      ) : connected ? (
        <button
          type="button"
          onClick={create}
          disabled={!canCreate}
          className="inline-flex min-h-13 items-center justify-center bg-olive px-6 font-mono text-base font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep disabled:cursor-not-allowed disabled:bg-nori/30"
        >
          {status === "signing"
            ? "APPROVE IN WALLET…"
            : status === "confirming"
              ? "CONFIRMING…"
              : status === "submitted"
                ? "AWAITING CONFIRMATION…"
                : "START RECURRING BUY"}
        </button>
      ) : (
        <button
          type="button"
          onClick={connect}
          className="inline-flex min-h-13 items-center justify-center border-2 border-nori px-6 font-mono text-base font-bold tracking-widest text-nori transition-colors hover:bg-nori hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
        >
          CONNECT WALLET TO START
        </button>
      )}

      {/* Success */}
      {status === "success" && sig && (
        <div className="border-2 border-bamboo/50 bg-bamboo/10 px-3 py-2.5">
          <p className="font-mono text-sm font-bold text-bamboo">✅ Recurring buy created — live on-chain.</p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-nori/80">
            {orderKey ? (
              <>
                Order account:{" "}
                <a
                  href={`https://solscan.io/account/${orderKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {orderKey.slice(0, 4)}…{orderKey.slice(-4)} →
                </a>
                {"  ·  "}
              </>
            ) : null}
            <a href={solscanTx(sig)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              transaction on Solscan →
            </a>
          </p>
        </div>
      )}

      {/* Submitted (uncertain) */}
      {status === "submitted" && sig && (
        <div className="border-2 border-nori/40 bg-steamed px-3 py-2.5">
          <p className="font-mono text-sm font-bold text-nori">
            ⏳ Sent — awaiting confirmation. It may still land; this isn&apos;t a failure.
          </p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-nori/70">
            Don&apos;t submit again — that could create a second order. Check it:{" "}
            <a href={solscanTx(sig)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              view on Solscan →
            </a>
          </p>
        </div>
      )}

      {rpcDown && (
        <p className="font-mono text-sm font-bold text-tuna">
          Couldn&apos;t read your SOL balance — the RPC is unreachable or rate-limited. You can still
          create an order; double-check the amount against your wallet.
        </p>
      )}

      {status === "error" && error && (
        <p className="font-mono text-sm font-bold break-words text-tuna">{error}</p>
      )}

      {/* The wallet's open recurring orders, with cancel (and honest pause). */}
      <ActiveDcaOrders riceMint={riceMint} ticker={ticker} refreshSignal={ordersRefresh} />
    </div>
  );
}

function Field({
  label,
  balance,
  symbol,
  children,
}: {
  label: string;
  balance: string;
  symbol: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-2 border-nori/30 bg-bone px-3 py-3">
      <div className="mb-1 flex flex-wrap justify-between gap-2 font-mono text-sm font-bold tracking-wide text-nori/70">
        <span className="uppercase">{label}</span>
        {balance ? <span>{balance}</span> : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <span className="inline-flex shrink-0 items-center gap-2 border-2 border-nori bg-steamed px-3 py-2 font-mono text-base font-bold whitespace-nowrap text-nori">
          {symbol}
        </span>
      </div>
    </div>
  );
}
