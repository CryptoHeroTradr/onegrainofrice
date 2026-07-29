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
  // The same `@/*` -> `src/*` alias tsconfig and Next use. Without it a test can only import
  // modules that happen to have no internal imports, which quietly limits what is testable to the
  // leaves — and the modules worth testing here (the bot-bridge client, the formatters) are not
  // leaves. Declared once, so a test imports a module exactly the way the app does.
  resolve: {
    alias: { "@": new URL("./src/", import.meta.url).pathname },
  },
});
