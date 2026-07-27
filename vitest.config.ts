import { defineConfig } from "vitest/config";

/**
 * Tests for the INVARIANTS of the money-touching UI, not for the whole site.
 *
 * This app is largely presentational and has never needed a test runner. What changed is that it
 * now hosts the shared Swap/DCA interface — the one place where a user signs a transaction — and
 * that interface makes two structural promises which are cheap to assert and expensive to notice
 * breaking: there is exactly ONE Jupiter client, and there is NO order storage anywhere (so the
 * website and the Telegram Mini App cannot drift apart about what a wallet's orders are).
 *
 * Deliberately node-environment and DOM-free: these are source-shape and pure-function tests. A
 * jsdom render harness for panels that need a wallet, a live quote and a Solana RPC would test the
 * mocks, not the product.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
