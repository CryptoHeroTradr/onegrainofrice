"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * $RICE contract chip for the grains page.
 *
 * - `inline` (default, desktop header): "$RICE on Solana" + the FULL contract
 *   address + a Copy button.
 * - `stacked` (mobile card): "$RICE on Solana" → full address → an action row
 *   with socials · Copy CA · Share.
 *
 * Copy works even on plain HTTP: `navigator.clipboard` is blocked in insecure
 * contexts, so we fall back to a hidden-textarea `execCommand("copy")`.
 */
export function ContractChip({
  address,
  label = "$RICE",
  chain = "Solana",
  variant = "inline",
  before,
  after,
  className,
}: {
  address: string;
  label?: string;
  chain?: string;
  variant?: "inline" | "stacked" | "compact";
  /** Content on the stacked card's action row, left of Copy CA (e.g. socials). */
  before?: React.ReactNode;
  /** Content on the stacked card's action row, right of Copy CA (e.g. share). */
  after?: React.ReactNode;
  /** Extra classes for the compact variant's pill (e.g. to size it in a nav). */
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const ok = await copyText(address);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const copyLabel = copied ? "Contract address copied" : `Copy ${label} contract address ${address}`;

  // Compact (nav): a single pill button — label + shortened address + copy icon.
  if (variant === "compact") {
    const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
    return (
      <button
        type="button"
        onClick={copy}
        aria-label={copyLabel}
        className={`inline-flex items-center gap-1.5 rounded-full border border-olive-deep/30 bg-bone/80 px-3 py-1.5 font-mono text-xs shadow-sm backdrop-blur transition-colors hover:bg-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive ${className ?? ""}`}
      >
        <span className="hidden font-semibold text-olive-deep sm:inline">{label}</span>
        <span className="tabular-nums text-ink/80">{copied ? "Copied!" : short}</span>
        {copied ? (
          <Check size={13} className="text-olive-deep" aria-hidden="true" />
        ) : (
          <Copy size={13} className="text-olive-deep" aria-hidden="true" />
        )}
      </button>
    );
  }

  if (variant === "stacked") {
    return (
      <div className="flex w-full flex-col items-center gap-1 rounded-2xl border border-olive-deep/30 bg-bone/80 px-3 py-1.5 text-center shadow-sm backdrop-blur">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-olive-deep">
          {label} on {chain}
        </span>
        <span className="break-all font-mono text-[0.7rem] leading-snug text-ink" title={address} translate="no">
          {address}
        </span>
        {/* Action row: socials · Copy CA · Share, all on one line. */}
        <div className="mt-0.5 flex w-full flex-wrap items-center justify-center gap-2 border-t border-olive-deep/15 pt-1.5">
          {before}
          <button
            type="button"
            onClick={copy}
            aria-label={copyLabel}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-olive-deep/30 bg-steamed/70 px-3 py-1.5 font-mono text-xs font-semibold text-olive-deep transition-colors hover:bg-steamed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
          >
            {copied ? (
              <>
                <Check size={14} aria-hidden="true" /> Copied!
              </>
            ) : (
              <>
                <Copy size={14} aria-hidden="true" /> Copy CA
              </>
            )}
          </button>
          {after}
        </div>
      </div>
    );
  }

  // Inline (desktop): label + FULL address + a distinct working Copy button.
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-olive-deep/30 bg-bone/80 px-3 py-1.5 font-mono text-xs shadow-sm backdrop-blur">
      <span className="font-semibold text-olive-deep">
        {label} on {chain}
      </span>
      <span className="tabular-nums text-ink" title={address} translate="no">
        {address}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copyLabel}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-olive-deep/30 bg-steamed/70 px-2.5 py-1 font-semibold text-olive-deep transition-colors hover:bg-steamed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive"
      >
        {copied ? (
          <>
            <Check size={13} aria-hidden="true" /> Copied!
          </>
        ) : (
          <>
            <Copy size={13} aria-hidden="true" /> Copy
          </>
        )}
      </button>
    </div>
  );
}

/** Copy text to the clipboard, with an HTTP/insecure-context fallback. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Blocked (insecure context / permissions) — fall through to the legacy path.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
