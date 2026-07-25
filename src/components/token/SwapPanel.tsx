"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";
import { useCharityWalletConnection } from "@/components/charity/CharityWalletProvider";
import { confirmSignature, connection } from "@/lib/solana";
import { solscanTx } from "@/lib/payments";
import {
  SOL_MINT,
  SOL_DECIMALS,
  buildSwapTransaction,
  fromBaseUnits,
  getMintDecimals,
  getQuote,
  getTokenBalance,
  toBaseUnits,
  type QuoteResponse,
} from "@/lib/jupiter";

/**
 * The real swap: SOL ⇄ $RICE through the Jupiter aggregator, signed and
 * submitted by the visitor's own wallet. Quotes refresh as you type (and every
 * 20s while idle) so the displayed output is the route that will actually be
 * built when you press Swap.
 *
 * Styled in the paper/olive tokenomics theme — it sits inside that section.
 */

const SLIPPAGE_OPTIONS = [50, 100, 300] as const; // basis points
/** Bounds for the custom slippage box (Jupiter itself accepts 0.01%–50%). */
const MIN_SLIPPAGE_PCT = 0.01;
const MAX_SLIPPAGE_PCT = 50;
const PRESETS = [0.1, 0.5, 1];
/** Leave enough SOL for fees/rent when the user taps MAX on the SOL side. */
const SOL_FEE_BUFFER = 0.01;
/**
 * Above this price impact (percent) the panel doesn't just show the number — it
 * makes the user acknowledge it before the swap can be signed. Mirrors the bot
 * executor's guard (maxPriceImpactPct 0.03): on a ~$105K-cap token a modest order
 * moves the price itself, and a slippage tolerance is NOT a price-impact guard.
 */
const IMPACT_WARN_PCT = 3;

/** Small pill/chip button, olive when active. */
const chip = (active: boolean) =>
  `min-h-9 border-2 px-3 py-0.5 font-mono text-sm font-bold transition-colors ${
    active
      ? "border-olive bg-olive/20 text-olive-deep"
      : "border-nori/30 text-nori/70 hover:border-nori"
  }`;

// "submitted" = broadcast but not yet confirmed within the window — an uncertain
// outcome, NOT a failure (it may still land). Distinct from "success"/"error".
type Status = "idle" | "quoting" | "signing" | "confirming" | "submitted" | "success" | "error";

/** confirmSignature (lib/solana) throws this on a confirmation timeout — the tx may still land. */
function isConfirmTimeout(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return m.includes("timed out") || m.includes("still land") || m.includes("check solscan");
}

/**
 * Turn a wallet / RPC / Jupiter failure into a sentence the user can act on. A raw
 * RPC error ("custom program error: 0x1771", "Blockhash not found") is never shown.
 */
function humanizeSwapError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.toLowerCase();
  if (m.includes("user rejected") || m.includes("rejected the request") || m.includes("declined") || m.includes("user denied"))
    return "You dismissed the wallet — nothing was signed. Press Swap to try again.";
  if (m.includes("insufficient") && (m.includes("lamport") || m.includes("sol") || m.includes("fee") || m.includes("rent")))
    return "Not enough SOL to cover network fees. Leave a little SOL (≈0.01) unspent and try again.";
  if (m.includes("slippage") || m.includes("0x1771") || m.includes("exceeds desired") || m.includes("price impact"))
    return "The price moved past your slippage tolerance. Re-quote and try again, or nudge slippage up a little.";
  if (m.includes("on-chain") || m.includes("custom program error") || m.includes("instruction error"))
    return "The swap failed on-chain — the pool price likely moved. Re-quote and try again; only the network fee was spent.";
  if (m.includes("blockhash") || m.includes("block height exceeded") || m.includes("expired"))
    return "The transaction expired before it landed. Re-quote and try again.";
  if (m.includes("no route") || m.includes("could not find any route") || m.includes("no routes"))
    return "No swap route for that pair and size right now — try a different amount.";
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("timeout") || m.includes("429") || m.includes("rate limit") || m.includes("fetch"))
    return "Couldn't reach the network. Check your connection and try again in a moment.";
  return "The swap didn't go through. Re-quote and try again — nothing was signed unless your wallet prompted you.";
}

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function fmt(n: number, max = 6): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

/**
 * Truncate toward zero at `decimals` places — never round UP. MAX used to
 * .toFixed() the balance, which rounds up (21,447,260.515 → ….52), asking the
 * swap for more tokens than the wallet holds and tripping "Insufficient".
 */
function floorTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(n * f) / f;
}

/** Balance as shown next to a field — truncated exactly like MAX spends it. */
function balanceLabel(n: number, decimals: number, symbol: string): string {
  const digits = Math.min(decimals, 6);
  return `${fmt(floorTo(n, digits), digits)} ${symbol}`;
}

/**
 * Connected wallet's SOL + $RICE holdings, in human units. Deliberately lets an
 * RPC failure THROW rather than reporting 0 — a silent zero reads as "empty
 * wallet" and blocks the swap behind a bogus "Insufficient SOL".
 */
async function fetchBalances(
  owner: PublicKey,
  riceMint: string,
): Promise<{ sol: number; rice: number }> {
  const [lamports, rice] = await Promise.all([
    connection.getBalance(owner),
    getTokenBalance(connection, owner, riceMint),
  ]);
  return { sol: lamports / LAMPORTS_PER_SOL, rice };
}

export function SwapPanel({
  riceMint,
  ticker,
  logoSrc,
}: {
  riceMint: string;
  ticker: string;
  /** $RICE token mark (the DexScreener listing art), already asset()-resolved. */
  logoSrc: string;
}) {
  const { publicKey, sendTransaction } = useWallet();
  const { connected, connecting, connect, disconnect, shortAddress } =
    useCharityWalletConnection();

  const [payRice, setPayRice] = useState(false); // false = SOL→RICE (buy)
  const [amount, setAmount] = useState("0.1");
  const [presetBps, setPresetBps] = useState<number>(100);
  /** Non-empty while the custom box is in use; wins over the preset when valid. */
  const [customPct, setCustomPct] = useState("");
  const customRef = useRef<HTMLInputElement>(null);
  const [riceDecimals, setRiceDecimals] = useState(6);
  const [fetchedBalances, setBalances] = useState<{ sol: number; rice: number }>({
    sol: 0,
    rice: 0,
  });
  /** Zeroed the moment the wallet disconnects, without an extra effect. */
  const balances = publicKey ? fetchedBalances : { sol: 0, rice: 0 };
  // Quotes are stored WITH the input key they priced, so a quote is never shown
  // for an amount/direction/slippage the user has since changed (no effect has
  // to null it out on every keystroke — the key simply stops matching).
  const [quoted, setQuoted] = useState<{ key: string; quote: QuoteResponse } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  /** True when the balance read failed, so 0 is "unknown", not "empty". */
  const [rpcDown, setRpcDown] = useState(false);
  /** The user has acknowledged a high price-impact quote (see IMPACT_WARN_PCT).
   *  Reset whenever the priced inputs change, so an ack never carries to a new quote. */
  const [impactAck, setImpactAck] = useState(false);

  // Custom slippage, in basis points — null while the box holds something out
  // of range, in which case the quote falls back to the last preset rather than
  // pricing a swap at a tolerance the user didn't mean.
  const customActive = customPct.trim() !== "";
  const customBps = (() => {
    if (!customActive) return null;
    const pct = Number(customPct);
    if (!Number.isFinite(pct) || pct < MIN_SLIPPAGE_PCT || pct > MAX_SLIPPAGE_PCT) return null;
    return Math.round(pct * 100);
  })();
  const slippageBps = customBps ?? presetBps;

  const inMint = payRice ? riceMint : SOL_MINT;
  const outMint = payRice ? SOL_MINT : riceMint;
  const inDecimals = payRice ? riceDecimals : SOL_DECIMALS;
  const outDecimals = payRice ? SOL_DECIMALS : riceDecimals;
  const inSymbol = payRice ? ticker : "SOL";
  const outSymbol = payRice ? "SOL" : ticker;
  const inBalance = payRice ? balances.rice : balances.sol;

  // $RICE decimals come from the chain once — pump.fun mints are 6, but don't
  // assume: a wrong exponent would misprice every quote by orders of magnitude.
  useEffect(() => {
    let cancelled = false;
    void getMintDecimals(connection, riceMint).then((d) => {
      if (!cancelled) setRiceDecimals(d);
    });
    return () => {
      cancelled = true;
    };
  }, [riceMint]);

  // Load on connect / mint change; the swap handler re-runs it after settling.
  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    void fetchBalances(publicKey, riceMint).then(
      (b) => {
        if (cancelled) return;
        setBalances(b);
        setRpcDown(false);
      },
      () => {
        if (!cancelled) setRpcDown(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [publicKey, riceMint]);

  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;
    try {
      setBalances(await fetchBalances(publicKey, riceMint));
      setRpcDown(false);
    } catch {
      setRpcDown(true);
    }
  }, [publicKey, riceMint]);

  // ── Live quote: debounced on input, refreshed every 20s so it can't go stale.
  const abortRef = useRef<AbortController | null>(null);
  const uiAmount = num(amount);

  const quoteKey = `${inMint}|${uiAmount}|${inDecimals}|${slippageBps}`;

  useEffect(() => {
    if (!(uiAmount > 0)) return;
    let cancelled = false;
    const run = async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // Only drive the idle↔quoting indicator; a background re-quote must NEVER clobber
      // an in-flight or finished SWAP (signing/confirming/submitted/success/error).
      setStatus((s) => (s === "idle" || s === "quoting" ? "quoting" : s));
      try {
        const q = await getQuote({
          inputMint: inMint,
          outputMint: outMint,
          amount: toBaseUnits(uiAmount, inDecimals),
          slippageBps,
          signal: ctrl.signal,
        });
        if (cancelled) return;
        setQuoted({ key: quoteKey, quote: q });
        setError(null);
        setStatus((s) => (s === "quoting" ? "idle" : s));
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setQuoted(null);
        setError(humanizeSwapError(err)); // never surface a raw quote/RPC error
        setStatus((s) => (s === "quoting" ? "idle" : s));
      }
    };

    const debounce = setTimeout(run, 350);
    const poll = setInterval(run, 20_000);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(poll);
    };
  }, [quoteKey, uiAmount, inMint, outMint, inDecimals, slippageBps]);

  /** Only ever the quote for the CURRENT inputs. */
  const quote = quoted?.key === quoteKey ? quoted.quote : null;

  const outAmount = quote ? fromBaseUnits(quote.outAmount, outDecimals) : null;
  const minReceived = quote ? fromBaseUnits(quote.otherAmountThreshold, outDecimals) : null;
  const priceImpact = quote ? Number(quote.priceImpactPct) * 100 : null;
  const route = useMemo(
    () =>
      quote?.routePlan
        ?.map((r) => r.swapInfo?.label)
        .filter(Boolean)
        .join(" → ") || null,
    [quote],
  );

  // High price impact — gate the swap behind an explicit acknowledgement.
  const highImpact = priceImpact != null && priceImpact > IMPACT_WARN_PCT;
  // A change to the priced inputs starts fresh: drop a stale acknowledgement AND clear a
  // finished/pending swap result so the panel returns to quoting (the 20s poll, which does
  // not change quoteKey, never triggers this — it leaves a result on screen).
  useEffect(() => {
    setImpactAck(false);
    setStatus((s) => (s === "success" || s === "error" || s === "submitted" ? "idle" : s));
  }, [quoteKey]);

  const busy = status === "signing" || status === "confirming";
  // Compare with a one-base-unit tolerance: the balance and the typed amount
  // are both floats, and an exact "spend everything" must not fail on the last
  // bit of representation error.
  const dust = 10 ** -inDecimals / 2;
  const insufficient = !rpcDown && uiAmount > 0 && uiAmount - inBalance > dust;

  const swap = useCallback(async () => {
    if (!publicKey || !quote) return;
    if (highImpact && !impactAck) return; // gated behind the high-impact acknowledgement
    setError(null);
    setSig(null);
    setStatus("signing");
    // Captured the instant the wallet broadcasts, BEFORE we confirm — so a confirm
    // timeout can still show the user exactly what to check.
    let signature: string | undefined;
    try {
      const tx = await buildSwapTransaction({ quote, userPublicKey: publicKey.toBase58() });
      signature = await sendTransaction(tx, connection); // wallet signs + sends
      setSig(signature);
      setStatus("confirming");
      await confirmSignature(connection, signature);
      setStatus("success");
      void refreshBalances();
    } catch (err) {
      // Uncertain-outcome discipline (same as the bot): a confirm timeout AFTER a send
      // is NOT a failure — the swap may still land. Show the signature; NEVER auto-retry
      // (a blind retry on a swap the user may have signed is a double-buy).
      if (signature && isConfirmTimeout(err)) {
        setStatus("submitted");
        void refreshBalances();
      } else {
        setError(humanizeSwapError(err));
        setStatus("error");
      }
    }
  }, [publicKey, quote, highImpact, impactAck, sendTransaction, refreshBalances]);

  /** Re-poll confirmation for the SAME signature — never re-signs or re-sends. */
  const recheck = useCallback(async () => {
    if (!sig) return;
    setStatus("confirming");
    try {
      await confirmSignature(connection, sig);
      setStatus("success");
      void refreshBalances();
    } catch (err) {
      if (isConfirmTimeout(err)) setStatus("submitted");
      else {
        setError(humanizeSwapError(err));
        setStatus("error");
      }
    }
  }, [sig, refreshBalances]);

  const riceIcon = <TokenMark src={logoSrc} alt={`${ticker} logo`} />;
  const solIcon = <SolMark />;

  /** Spend the whole balance — every decimal of it, SOL minus a fee buffer. */
  const setMax = () => {
    const raw = payRice ? balances.rice : Math.max(0, balances.sol - SOL_FEE_BUFFER);
    const max = floorTo(raw, inDecimals);
    setAmount(max > 0 ? String(max) : "0");
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Wallet row */}
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
          {connecting ? "CONNECTING…" : connected ? "DISCONNECT" : "CONNECT"}
        </button>
      </div>

      {/* You pay */}
      <TokenField
        label="you pay"
        balance={rpcDown ? "unavailable" : balanceLabel(inBalance, inDecimals, inSymbol)}
        symbol={inSymbol}
        icon={payRice ? riceIcon : solIcon}
      >
        <div className="flex items-center gap-2">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            aria-label={`Amount of ${inSymbol} to swap`}
            className="w-full min-w-0 bg-transparent font-display text-4xl font-bold text-nori outline-none"
          />
          <button
            type="button"
            onClick={setMax}
            disabled={!connected}
            className="shrink-0 border-2 border-nori/40 px-2.5 py-1 font-mono text-xs font-bold tracking-widest text-nori transition-colors hover:border-nori hover:bg-nori hover:text-bone disabled:opacity-40"
          >
            MAX
          </button>
        </div>
        {!payRice && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(String(p))}
                className={chip(uiAmount === p)}
              >
                {p} SOL
              </button>
            ))}
          </div>
        )}
      </TokenField>

      {/* Flip */}
      <div className="-my-4 flex justify-center">
        <button
          type="button"
          onClick={() => {
            setPayRice((v) => !v);
            setAmount(payRice ? "0.1" : "");
            setQuoted(null);
            setStatus("idle");
          }}
          aria-label="Swap direction"
          className="z-10 flex size-10 items-center justify-center rounded-full border-2 border-nori bg-steamed text-lg font-bold text-nori transition-colors hover:bg-olive hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
        >
          ⇅
        </button>
      </div>

      {/* You receive */}
      <TokenField
        label="you receive (est.)"
        balance={
          rpcDown
            ? "unavailable"
            : balanceLabel(payRice ? balances.sol : balances.rice, outDecimals, outSymbol)
        }
        symbol={outSymbol}
        icon={payRice ? solIcon : riceIcon}
      >
        <p
          className={`font-display text-4xl font-bold ${
            outAmount == null ? "text-nori/40" : "text-nori"
          }`}
        >
          {status === "quoting" && !outAmount
            ? "…"
            : outAmount == null
              ? "0"
              : fmt(outAmount, payRice ? 6 : 2)}
        </p>
      </TokenField>

      {/* Route detail */}
      {quote && (
        <dl className="space-y-1 font-mono text-sm">
          <Row
            label="rate"
            value={`1 ${inSymbol} ≈ ${fmt((outAmount ?? 0) / (uiAmount || 1), payRice ? 8 : 2)} ${outSymbol}`}
          />
          <Row
            label="minimum received"
            value={`${fmt(minReceived ?? 0, payRice ? 6 : 2)} ${outSymbol}`}
          />
          <Row
            label="price impact"
            value={priceImpact == null ? "—" : `${priceImpact.toFixed(2)}%`}
            danger={highImpact}
          />
          {route && <Row label="route" value={route} />}
        </dl>
      )}

      {/* Slippage: presets + custom */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm font-bold tracking-widest text-nori uppercase">
            slippage
          </span>
          {SLIPPAGE_OPTIONS.map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => {
                setPresetBps(bps);
                setCustomPct("");
              }}
              className={chip(!customActive && presetBps === bps)}
            >
              {bps / 100}%
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              // Toggle: opening seeds the box with the active preset so the
              // number in view always matches the slippage being quoted.
              if (customActive) setCustomPct("");
              else {
                setCustomPct(String(presetBps / 100));
                customRef.current?.focus();
              }
            }}
            className={chip(customActive)}
          >
            Custom
          </button>
          <span
            className={`inline-flex min-h-9 items-center gap-0.5 border-2 px-2 font-mono text-sm font-bold ${
              customActive ? "border-olive bg-olive/20 text-olive-deep" : "border-nori/30 text-nori/70"
            }`}
          >
            <input
              ref={customRef}
              inputMode="decimal"
              value={customPct}
              onChange={(e) => setCustomPct(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0.00"
              aria-label="Custom slippage tolerance, percent"
              className="w-12 bg-transparent text-right font-mono text-sm font-bold outline-none placeholder:text-nori/40"
            />
            %
          </span>
        </div>
        {customActive && customBps == null && (
          <p className="font-mono text-sm font-bold text-tuna">
            Enter a slippage between {MIN_SLIPPAGE_PCT}% and {MAX_SLIPPAGE_PCT}%.
          </p>
        )}
        {customBps != null && customBps > 500 && (
          <p className="font-mono text-sm font-bold text-tuna">
            High slippage — you could receive up to {(customBps / 100).toFixed(2)}% less than quoted.
          </p>
        )}
      </div>

      {/* High price-impact warning + acknowledgement — the swap can't be signed
          until this is checked. Slippage tolerance does NOT cover this. */}
      {highImpact && priceImpact != null && (
        <div className="border-2 border-tuna bg-tuna/10 px-3 py-3">
          <p className="font-mono text-sm font-bold text-tuna">
            ⚠ High price impact — {priceImpact.toFixed(2)}%
          </p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-nori/80">
            This order alone moves the price about {priceImpact.toFixed(1)}% against you — separate
            from slippage. $RICE is a thin market; a smaller amount usually gets a better rate. To
            swap anyway, acknowledge below.
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 font-mono text-sm font-bold text-nori">
            <input
              type="checkbox"
              checked={impactAck}
              onChange={(e) => setImpactAck(e.target.checked)}
              className="size-4 accent-tuna"
            />
            I understand the {priceImpact.toFixed(2)}% price impact
          </label>
        </div>
      )}

      {/* Action */}
      {connected ? (
        <button
          type="button"
          onClick={swap}
          disabled={busy || !quote || insufficient || status === "submitted" || (highImpact && !impactAck)}
          className="inline-flex min-h-13 items-center justify-center bg-olive px-6 font-mono text-base font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep disabled:cursor-not-allowed disabled:bg-nori/30"
        >
          {insufficient
            ? `INSUFFICIENT ${inSymbol.replace("$", "")}`
            : status === "submitted"
              ? "AWAITING CONFIRMATION…"
              : highImpact && !impactAck
                ? "ACKNOWLEDGE IMPACT TO SWAP"
                : status === "signing"
                  ? "APPROVE IN WALLET…"
                  : status === "confirming"
                    ? "CONFIRMING…"
                    : `SWAP ${inSymbol.replace("$", "")} → ${outSymbol.replace("$", "")}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={connect}
          className="inline-flex min-h-13 items-center justify-center border-2 border-nori px-6 font-mono text-base font-bold tracking-widest text-nori transition-colors hover:bg-nori hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
        >
          CONNECT WALLET TO SWAP
        </button>
      )}

      {status === "success" && sig && (
        <p className="font-mono text-sm font-bold text-bamboo">
          ✅ Swap confirmed —{" "}
          <a
            href={solscanTx(sig)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            view on Solscan →
          </a>
        </p>
      )}

      {/* Submitted but not yet confirmed — an uncertain outcome, NOT a failure.
          Show the signature, don't re-swap (that could buy twice), let them check. */}
      {status === "submitted" && sig && (
        <div className="border-2 border-nori/40 bg-steamed px-3 py-2.5">
          <p className="font-mono text-sm font-bold text-nori">
            ⏳ Sent — awaiting confirmation. It may still land; this isn&apos;t a failure.
          </p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-nori/70">
            Don&apos;t swap again — that could buy twice. Check it:{" "}
            <a
              href={solscanTx(sig)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              view on Solscan →
            </a>
          </p>
          <button
            type="button"
            onClick={recheck}
            className="mt-2 min-h-9 border-2 border-nori px-3 font-mono text-xs font-bold tracking-widest text-nori transition-colors hover:bg-nori hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
          >
            RE-CHECK STATUS
          </button>
        </div>
      )}

      {rpcDown && (
        <p className="font-mono text-sm font-bold text-tuna">
          Couldn&apos;t read your balances — the Solana RPC is unreachable or rate-limited. Swaps
          still work; double-check the amount against your wallet.
        </p>
      )}

      {error && status !== "success" && status !== "submitted" && (
        <p className="font-mono text-sm font-bold break-words text-tuna">{error}</p>
      )}

      <p className="font-mono text-xs leading-relaxed text-nori/60">
        Swaps route through the Jupiter aggregator and are signed by your own wallet — no custody,
        no middleman. Wallets only connect over HTTPS.
      </p>
    </div>
  );
}

/** The $RICE listing logo, circular. */
function TokenMark({ src, alt, size = 24 }: { src: string; alt: string; size?: number }) {
  return (
    // Images are unoptimized site-wide (see next.config.ts), and this is a
    // fixed-size local asset.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="block rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  );
}

/** Solana's mark, drawn inline so the SOL side isn't a bare word next to a logo. */
function SolMark({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-bold text-nori"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
        fontSize: size * 0.62,
        lineHeight: 1,
      }}
    >
      ◎
    </span>
  );
}

function TokenField({
  label,
  balance,
  symbol,
  icon,
  children,
}: {
  label: string;
  balance: string;
  symbol: string;
  /** Token mark shown inside the symbol pill. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-2 border-nori/30 bg-bone px-3 py-3">
      <div className="mb-1 flex flex-wrap justify-between gap-2 font-mono text-sm font-bold tracking-wide text-nori/70">
        <span className="uppercase">{label}</span>
        <span>balance: {balance}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <span className="inline-flex shrink-0 items-center gap-2 border-2 border-nori bg-steamed px-3 py-2 font-mono text-base font-bold whitespace-nowrap text-nori">
          {icon}
          {symbol}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-nori/15 pb-1 last:border-b-0">
      <dt className="font-bold tracking-wide text-nori/70 uppercase">{label}</dt>
      <dd className={`m-0 text-right font-bold break-words ${danger ? "text-tuna" : "text-nori"}`}>
        {value}
      </dd>
    </div>
  );
}
