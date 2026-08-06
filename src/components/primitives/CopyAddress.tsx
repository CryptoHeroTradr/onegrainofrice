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
    /* THIS CHIP WAS 389px WIDE ON A 320px PHONE, and it is why the nav looked
       broken there. *Fixed 2026-08-06.*

       Two things were wrong and both were needed:

       1. **`min-w-0` on the address span.** A flex item's `min-width` is `auto`,
          which floors it at min-content — and `truncate` sets `white-space:
          nowrap`, so the min-content of that span is the whole 44-character
          address. `truncate` was therefore doing nothing at all: the span could
          not shrink, so it never had a reason to ellipsize.

       2. **A viewport cap, not a percentage one.** `max-w-full` is `max-width:
          100%`, resolved against the containing block — and every caller puts this
          inside a `flex flex-col items-center` column, where the wrapper is sized
          `fit-content`. A percentage max-width inside a shrink-to-fit ancestor is
          a cyclic dependency, so CSS ignores it while computing intrinsic width
          and the chip got its full max-content anyway. `calc(100vw-3rem)` has no
          such cycle: it does not depend on any ancestor, so no caller can undo it.
          3rem is the pages' `px-6` gutters. It is inert above ~440px, where the
          chip is naturally narrower than the screen.

       Being centred, the overflow ran off BOTH edges, which widened the document —
       and the FIXED nav lays out against the document, so a contract address in the
       footer was making the bar at the top too wide. Four call sites share this
       component, so the fix is here rather than in each of their wrappers. */
    <div className="inline-flex max-w-[calc(100vw-3rem)] items-stretch border-2 border-olive-deep/40 bg-bone font-mono text-xs text-ink sm:text-sm">
      <span className="min-w-0 truncate px-3 py-2.5" title={address}>
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
