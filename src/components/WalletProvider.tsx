"use client";

// Shim of RiceDAO's WalletProvider. onegrainofrice has no wallet / game backend,
// so useGameWallet() always reports "no wallet connected". Nothing reads it at
// present — the PFP generator dropped its per-wallet history when the three AI
// panels became one Generate process, since the endpoints that history needed
// (/api/pfp/history) only ever existed in RiceDAO. Kept as the seam to fill if
// wallet-attached generations come back.

export function useGameWallet(): { walletAddress: string | null } {
  return { walletAddress: null };
}
