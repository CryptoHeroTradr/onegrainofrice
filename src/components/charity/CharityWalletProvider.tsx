"use client";

import { useCallback, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import type { Adapter } from "@solana/wallet-adapter-base";
import { SOLANA_RPC_URL } from "@/lib/solana";

import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Solana connection + wallet context (Phantom + Solflare) with the library's
 * wallet-selection modal. Ported from RiceDAO, but mounted around the /charity
 * page ONLY rather than in the root layout: /charity is the sole route here that
 * touches a wallet, and the rest of the site (and the `useGameWallet` shim in
 * src/components/WalletProvider.tsx that /pfp uses) stays exactly as it was.
 *
 * autoConnect must stay ON: the selection modal only calls `select()`, and the
 * library's autoConnect handler is the only thing that then connects the chosen
 * adapter. A fresh user selection triggers a prompting `connect()`; a
 * localStorage restore on load triggers a silent one, so it won't hang on load.
 *
 * NB: wallets only connect from a SECURE CONTEXT (https or localhost). Over
 * plain http on a bare IP, Phantom won't register.
 */
export function CharityWalletProvider({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => SOLANA_RPC_URL, []);
  const wallets = useMemo<Adapter[]>(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}

/** Convenience wallet hook: adds modal-driven connect + display-ready address. */
export function useCharityWalletConnection() {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const walletAddress = publicKey ? publicKey.toBase58() : null;
  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : null;

  const connect = useCallback(() => setVisible(true), [setVisible]);

  return {
    publicKey,
    connected,
    connecting,
    connect,
    disconnect: () => void disconnect(),
    walletAddress,
    shortAddress,
  };
}
