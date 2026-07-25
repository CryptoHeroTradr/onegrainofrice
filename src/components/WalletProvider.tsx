"use client";

// Shim of RiceDAO's WalletProvider. onegrainofrice has no wallet / game backend,
// so useGameWallet() always reports "no wallet connected". The ported PFP UI
// handles walletAddress === null gracefully: AI Enhance / Rice Art / Generate
// PFP all work, and only the per-wallet history persistence is skipped.

export function useGameWallet(): { walletAddress: string | null } {
  return { walletAddress: null };
}
