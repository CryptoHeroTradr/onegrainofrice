"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCharityWalletConnection } from "@/components/charity/CharityWalletProvider";
import { confirmSignature, connection } from "@/lib/solana";
import { buildUsdcTransfer, solscanTx } from "@/lib/payments";
import { C, CHARITY_WALLET_ADDR } from "@/components/charity/ui";

const PRESETS = [1, 5, 10, 25];

type Status = "idle" | "sending" | "confirming" | "success" | "error";

/**
 * Wallet-connected button that donates USDC directly to the charity wallet.
 * 100% of the transfer goes to the public charity address — no server in the
 * loop, the user's wallet signs and submits the transfer itself.
 */
export function DonateButton({
  defaultAmount = 5,
  label = "🌾 DONATE NOW",
}: {
  defaultAmount?: number;
  label?: string;
}) {
  const { publicKey, sendTransaction } = useWallet();
  const { connected, connect } = useCharityWalletConnection();
  const [amount, setAmount] = useState<number>(defaultAmount);
  const [custom, setCustom] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [sig, setSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effective = custom.trim() ? Number(custom) : amount;

  const donate = useCallback(async () => {
    if (!publicKey || !(effective > 0)) return;
    setError(null);
    setStatus("sending");
    try {
      const memo = `RICEDAO_DONATE:${publicKey.toBase58()}`;
      const tx = await buildUsdcTransfer(
        connection,
        publicKey,
        CHARITY_WALLET_ADDR,
        effective,
        memo,
      );
      const signature = await sendTransaction(tx, connection);
      setStatus("confirming");
      await confirmSignature(connection, signature);
      setSig(signature);
      setStatus("success");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }, [publicKey, effective, sendTransaction]);

  const busy = status === "sending" || status === "confirming";

  if (status === "success" && sig) {
    return (
      <div style={{ textAlign: "center", color: C.white }}>
        <div style={{ color: "#7bbf6a", fontWeight: 700, marginBottom: 6 }}>
          🙏 Thank you for your ${effective.toFixed(2)} donation!
        </div>
        <a
          href={solscanTx(sig)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: C.gold, textDecoration: "none" }}
        >
          View on Solscan →
        </a>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          justifyContent: "center",
        }}
      >
        {PRESETS.map((p) => {
          const selected = !custom && amount === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                setAmount(p);
                setCustom("");
              }}
              style={{
                padding: "0.4rem 0.9rem",
                borderRadius: 8,
                border: `1px solid ${selected ? C.gold : C.muted}`,
                background: selected ? "rgba(201,168,76,0.18)" : "transparent",
                color: selected ? C.gold : C.white,
                cursor: "pointer",
              }}
            >
              ${p}
            </button>
          );
        })}
        <input
          type="number"
          min={1}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Custom"
          aria-label="Custom donation amount in USDC"
          style={{
            width: 90,
            padding: "0.4rem 0.6rem",
            borderRadius: 8,
            border: `1px solid ${custom ? C.gold : C.muted}`,
            background: "rgba(0,0,0,0.3)",
            color: C.white,
            outline: "none",
          }}
        />
      </div>

      <div style={{ color: C.muted, fontSize: "0.8rem" }}>
        100% goes to the charity wallet · USDC
      </div>

      {connected ? (
        <button
          type="button"
          onClick={donate}
          disabled={busy || !(effective > 0)}
          style={{
            padding: "0.7rem 1.6rem",
            borderRadius: 10,
            border: `1px solid ${C.gold}`,
            background: busy ? "rgba(201,168,76,0.35)" : C.gold,
            color: C.dark,
            fontWeight: 700,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {status === "sending"
            ? "Approve in wallet…"
            : status === "confirming"
              ? "Confirming…"
              : `${label} ($${effective > 0 ? effective : 0})`}
        </button>
      ) : (
        <button
          type="button"
          onClick={connect}
          style={{
            padding: "0.7rem 1.6rem",
            borderRadius: 10,
            border: `1px solid ${C.gold}`,
            background: "transparent",
            color: C.gold,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Connect Wallet to Donate
        </button>
      )}

      {error && <div style={{ color: "#e08c8c", fontSize: "0.8rem" }}>{error}</div>}
    </div>
  );
}
