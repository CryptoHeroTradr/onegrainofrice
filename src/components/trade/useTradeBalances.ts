"use client";

import { useCallback, useEffect, useState } from "react";
import { LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";
import { connection } from "@/lib/solana";
import { getTokenBalance } from "@/lib/jupiter";

/**
 * Read-only SOL + token balances for the connected wallet, fetched through the
 * site's /api/rpc proxy (see lib/solana.ts). This is the end-to-end proof that
 * the wallet and RPC path work before any transaction logic exists.
 *
 * A failed read surfaces as `error`, never as a silent 0 — a bogus zero reads as
 * "empty wallet" and would be misleading. `null` publicKey ⇒ idle, nothing read.
 */
export interface TradeBalances {
  sol: number | null;
  token: number | null;
  loading: boolean;
  error: boolean;
  refresh: () => void;
}

export function useTradeBalances(publicKey: PublicKey | null, tokenMint: string): TradeBalances {
  const [sol, setSol] = useState<number | null>(null);
  const [token, setToken] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const owner = publicKey ? publicKey.toBase58() : null;

  const load = useCallback(async (): Promise<void> => {
    if (!publicKey) return;
    setLoading(true);
    setError(false);
    try {
      const [lamports, tokenAmount] = await Promise.all([
        connection.getBalance(publicKey),
        getTokenBalance(connection, publicKey, tokenMint),
      ]);
      setSol(lamports / LAMPORTS_PER_SOL);
      setToken(tokenAmount);
    } catch {
      setError(true);
      setSol(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
    // owner is the stable string form of publicKey; keeps the ref identity out of deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, tokenMint]);

  useEffect(() => {
    if (!publicKey) {
      setSol(null);
      setToken(null);
      setError(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, tokenMint]);

  return { sol, token, loading, error, refresh: () => void load() };
}
