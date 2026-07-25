"use client";

import { useEffect, useState } from "react";
import { site } from "@/config/site";
import { useTradeWallet } from "@/components/trade/TradeWalletProvider";
import { useTradeBalances } from "@/components/trade/useTradeBalances";

/**
 * The Swap/DCA shell: wallet connect, connected address + disconnect, live
 * SOL + $RICE balances, and the two-tab frame (Swap · DCA) that the actual
 * trading logic drops into in later phases. No swapping and no DCA here yet —
 * the tab bodies are placeholders on purpose.
 */

const TOKEN_MINT = site.token.contract;
const TICKER = site.token.name; // "$RICE"

type Tab = "swap" | "dca";

const fmt = (n: number, max = 6) =>
  n.toLocaleString(undefined, { maximumFractionDigits: max });

export function TradeCard() {
  const { publicKey, shortAddress, connected, connecting, connect, disconnect } = useTradeWallet();
  const [tab, setTab] = useState<Tab>("swap");
  const balances = useTradeBalances(publicKey, TOKEN_MINT);

  // Deliberate crash for the error-boundary smoke test: /home?trade-boom=1.
  // Gated behind an effect so the server render and first client render match
  // (no hydration mismatch); the throw fires on the client, where the boundary
  // catches it. See TradeErrorBoundary.
  const boom = useBoomFlag();
  if (boom) throw new Error("Intentional trade-section crash (trade-boom=1) — boundary smoke test.");

  return (
    <div className="flex flex-col gap-4">
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
          {connecting ? "CONNECTING…" : connected ? "DISCONNECT" : "CONNECT WALLET"}
        </button>
      </div>

      {/* Balances — read-only, proves the wallet + RPC path end-to-end */}
      {connected && (
        <dl className="grid grid-cols-2 gap-3">
          <BalanceTile
            label="SOL"
            value={balances.sol}
            loading={balances.loading}
            error={balances.error}
          />
          <BalanceTile
            label={TICKER.replace("$", "")}
            value={balances.token}
            loading={balances.loading}
            error={balances.error}
          />
        </dl>
      )}
      {connected && balances.error && (
        <p className="font-mono text-xs font-bold text-tuna">
          Couldn&apos;t read balances — the RPC is unreachable or rate-limited. Try again shortly.
        </p>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Trade mode" className="flex border-2 border-nori/30 bg-bone">
        <TabButton id="swap" active={tab === "swap"} onSelect={setTab}>
          Swap
        </TabButton>
        <TabButton id="dca" active={tab === "dca"} onSelect={setTab}>
          DCA
        </TabButton>
      </div>

      {/* Tab body — the drop-in frame for later phases */}
      <div
        role="tabpanel"
        id={`trade-panel-${tab}`}
        aria-labelledby={`trade-tab-${tab}`}
        className="border-2 border-dashed border-nori/25 bg-bone px-5 py-10 text-center"
      >
        {tab === "swap" ? (
          <TabPlaceholder
            title="Swap SOL ⇄ $RICE"
            body="The instant swap drops in here — routed through Jupiter and signed by your own wallet. Wiring up next."
          />
        ) : (
          <TabPlaceholder
            title="Recurring buy (DCA)"
            body="Schedule a recurring $RICE buy — deposit once, Jupiter executes on your interval. Coming in a later phase."
          />
        )}
      </div>

      <p className="font-mono text-xs leading-relaxed text-nori/60">
        Non-custodial: nothing is signed without your wallet, and this panel only ever reads your
        public balances. Wallets connect over HTTPS only.
      </p>
    </div>
  );
}

function TabButton({
  id,
  active,
  onSelect,
  children,
}: {
  id: Tab;
  active: boolean;
  onSelect: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`trade-tab-${id}`}
      aria-selected={active}
      aria-controls={`trade-panel-${id}`}
      onClick={() => onSelect(id)}
      className={`min-h-11 flex-1 font-mono text-sm font-bold tracking-widest uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep ${
        active ? "bg-olive text-bone" : "bg-transparent text-nori/70 hover:bg-olive/15 hover:text-nori"
      }`}
    >
      {children}
    </button>
  );
}

function TabPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <>
      <p className="font-display text-xl font-bold text-nori">{title}</p>
      <p className="mx-auto mt-2 max-w-sm font-mono text-sm text-nori/60">{body}</p>
    </>
  );
}

function BalanceTile({
  label,
  value,
  loading,
  error,
}: {
  label: string;
  value: number | null;
  loading: boolean;
  error: boolean;
}) {
  const display = error ? "—" : loading && value == null ? "…" : value == null ? "—" : fmt(value);
  return (
    <div className="border-2 border-nori/30 bg-bone px-3 py-3">
      <dt className="font-mono text-xs font-bold tracking-widest text-nori/60 uppercase">
        {label} balance
      </dt>
      <dd className="m-0 mt-1 font-display text-2xl font-bold break-words text-nori">{display}</dd>
    </div>
  );
}

/** True once the client sees ?trade-boom=1 — used only to test the boundary. */
function useBoomFlag(): boolean {
  const [boom, setBoom] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("trade-boom") === "1") setBoom(true);
  }, []);
  return boom;
}
