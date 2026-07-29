"use client";

import { useState } from "react";
import { encodeBase58 } from "@/lib/base58";
import { linkMessage, type SigningWallet } from "@/lib/dcaDashboard";

/**
 * A PROVEN WALLET THAT NOBODY HAS CLAIMED — the /linksite affordance, not an empty dashboard.
 *
 * The bot answers "whose schedules are these?" from a mapping the user establishes in Telegram, so
 * an unlinked wallet has no dashboard to show. Rendering the custodial layout with nothing in it
 * would read as "the bot is running nothing for you", which is a different and possibly false
 * claim: it may be running plenty for a Telegram account this wallet has never been connected to.
 *
 * THE LINK NEEDS BOTH HALVES, WHICH IS THE POINT. The code proves the TELEGRAM side — only that
 * user's DM received it. The signature proves the WALLET side — only its holder can produce it.
 * Either alone establishes nothing, which is why the bot wants both and why it is safe for the code
 * to travel through a screen: on its own it authorises nothing at all.
 *
 * NO KEY, NO PASSPHRASE, EVER. This form asks for a ten-character code and a message signature.
 * There is no field here for a private key or a seed phrase, there is nowhere on this site that has
 * one, and the bot would refuse to take one over this channel anyway — it answers every
 * key-touching path with "manage your wallet in the bot". If a page ever asks you for a key, it is
 * not this one and it is not ours.
 */

export function DashboardLink({
  wallet,
  onLinked,
}: {
  wallet: SigningWallet | null;
  onLinked: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!wallet) return;
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // The one message the site composes rather than receives — the bot has no link-challenge
      // endpoint. It is mirrored from the bot's `linkMessage` and pinned by a test; see
      // lib/dcaDashboard.ts. The user still sees the exact text in their wallet before approving.
      const signature = encodeBase58(
        await wallet.signMessage(new TextEncoder().encode(linkMessage(wallet.address, trimmed))),
      );
      const res = await fetch("/api/dca/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: wallet.address, code: trimmed, signature }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok !== true) {
        setError(
          res.status === 400
            ? "That code has expired or was already used. Send /linksite again in the bot for a fresh one."
            : (json.error ?? "Couldn't link this wallet."),
        );
        return;
      }
      setCode("");
      onLinked();
    } catch {
      setError("You declined the signature, so nothing was linked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-2 border-nori/25 bg-steamed p-4">
      <h3 className="font-mono text-sm font-bold tracking-widest text-nori">LINK THIS WALLET</h3>
      <p className="mt-2 font-mono text-sm leading-relaxed text-nori/70">
        This wallet isn&apos;t linked to a Telegram account yet, so there are no bot schedules to
        show for it.
      </p>
      <ol className="mt-3 flex flex-col gap-1.5 font-mono text-sm text-nori/80">
        <li>
          1. DM the bot <span className="font-bold text-nori">/linksite</span> — it replies with a
          one-time code that expires in 10 minutes.
        </li>
        <li>2. Type the code here and sign the message. It is not a transaction and moves nothing.</li>
      </ol>

      <div className="mt-3 flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="A1B2C3D4E5"
          autoComplete="off"
          spellCheck={false}
          maxLength={16}
          className="min-h-11 w-full border-2 border-nori/30 bg-bone px-3 font-mono text-sm tracking-widest text-nori uppercase"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !wallet || code.trim().length === 0}
          className="min-h-11 border-2 border-olive bg-olive px-4 font-mono text-sm font-bold tracking-widest text-bone disabled:opacity-40"
        >
          {busy ? "…" : "LINK"}
        </button>
      </div>
      {error && <p className="mt-2 font-mono text-xs font-bold text-tuna">{error}</p>}

      <p className="mt-3 font-mono text-xs leading-relaxed text-nori/60">
        The bot never asks for a private key or a seed phrase — not here, not anywhere. Wallets and
        keys are managed only in the bot, with <span className="font-bold text-nori">/wallet</span>.
      </p>
    </section>
  );
}
