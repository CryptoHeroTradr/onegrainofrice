"use client";

import { Component, type ReactNode } from "react";

/**
 * Isolates the Swap/DCA section from the rest of /home. onegrainofrice is live,
 * so if wallet-adapter, an RPC read, or Jupiter throws while rendering, this
 * boundary swaps in a friendly "temporarily unavailable" card and every other
 * section on the page keeps rendering normally.
 *
 * Wraps the WHOLE section — provider included — so even a crash constructing the
 * wallet context is caught. To see it live, load /home?trade-boom=1: TradeCard
 * throws on purpose and this boundary shows the fallback while the page survives.
 */
interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  hasError: boolean;
}

export class TradeErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Diagnostics only — never rethrow, or the crash would propagate to the page.
    console.error("[trade] section error, showing fallback:", error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? <TradeUnavailable />;
    }
    return this.props.children;
  }
}

/** Default fallback: honest, on-theme, and self-contained (no wallet/RPC calls). */
function TradeUnavailable() {
  return (
    <div className="border-2 border-nori/30 bg-bone px-5 py-8 text-center">
      <p className="font-display text-2xl font-bold text-nori">Trading temporarily unavailable</p>
      <p className="mx-auto mt-2 max-w-sm font-mono text-sm text-nori/70">
        The swap &amp; DCA panel hit a snag — a wallet or network hiccup, most likely. The rest of
        the page is fine. Refresh to try again in a moment.
      </p>
    </div>
  );
}
