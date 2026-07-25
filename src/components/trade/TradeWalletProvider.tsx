"use client";

import { useCallback, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import type { Adapter } from "@solana/wallet-adapter-base";
import { SOLANA_RPC_URL } from "@/lib/solana";

import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Self-contained Solana wallet context for the /home Swap/DCA section — its own
 * tree, deliberately separate from the /charity provider so this section owns
 * nothing outside itself.
 *
 * Wallet coverage: Phantom + Solflare come from their adapters; Backpack (and any
 * other modern wallet) is picked up automatically via the Wallet Standard, which
 * `WalletProvider` merges in — no extra adapter package needed. The selection
 * modal lists whatever the visitor actually has installed.
 *
 * `endpoint` is this site's own /api/rpc proxy (see lib/solana.ts): reads go out
 * server-side with the RPC key never reaching the client. autoConnect stays ON so
 * a returning visitor reconnects silently; the modal only calls `select()` and
 * the library's autoConnect handler does the actual connect.
 *
 * NB: wallets only expose themselves in a SECURE CONTEXT (https or localhost).
 */
export function TradeWalletProvider({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => SOLANA_RPC_URL, []);
  const wallets = useMemo<Adapter[]>(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/** Modal-driven connect + a display-ready truncated address. */
export function useTradeWallet() {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const address = publicKey ? publicKey.toBase58() : null;
  const shortAddress = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null;

  const connect = useCallback(() => setVisible(true), [setVisible]);

  return {
    publicKey,
    address,
    shortAddress,
    connected,
    connecting,
    connect,
    disconnect: () => void disconnect(),
  };
}
