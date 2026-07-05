"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Contract address chip with a copy-to-clipboard button. */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — leave the address selectable.
    }
  }

  return (
    <div className="inline-flex max-w-full items-stretch border-2 border-olive-deep/40 bg-bone font-mono text-xs text-ink sm:text-sm">
      <span className="truncate px-3 py-2.5" title={address}>
        {address}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Contract address copied" : "Copy contract address"}
        className="flex min-h-11 min-w-11 items-center justify-center border-l-2 border-olive-deep/40 bg-olive px-3 text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki"
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
