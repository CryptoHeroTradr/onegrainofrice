/**
 * THE BOT'S DASHBOARD CONTRACT, VENDORED — and the reason it is vendored rather than installed.
 *
 * `dashboard-contract.ts` beside this file is a BYTE-FOR-BYTE COPY of
 * `src/site-bridge/dashboard-contract.ts` in the ricebuybot repo, at the commit recorded in
 * `pinned.json`. It is types and constants only; the bot's own test keeps it import-free precisely
 * so it can travel like this.
 *
 * WHY NOT A GIT DEPENDENCY. `@rice/jupiter-dca` is consumed that way because it is a real package
 * with compiled output and a release loop. The bot is not a package: depending on
 * `github:CryptoHeroTradr/ricebuybot#<sha>` would pull an entire Telegram bot — its source, its
 * dependency tree, its keystore code — into this website's `node_modules` to obtain one file of
 * type declarations. The thing we want to import weighs nothing; the thing we would have to
 * install weighs everything.
 *
 * WHY NOT A SHARED PACKAGE. A third repo, a version, a tag, a bump in two consumers — for a file
 * with no runtime behaviour. That is release-loop ceremony bought with nothing.
 *
 * SO: a copy, pinned, WITH A TEST THAT FAILS WHEN IT DRIFTS. `test/bot-contract-pinned.test.ts`
 * hashes this copy against `pinned.json` on every run, and — whenever the bot checkout is present —
 * re-reads the pinned commit through `git show` and compares byte for byte. Same discipline as the
 * `dist/` check in @rice/jupiter-dca: a copied artifact is safe exactly as long as something
 * mechanical notices when it stops matching its source. Left to discipline, it would go stale
 * silently, and stale types are worse than missing ones — the code still compiles and merely
 * describes a payload the server no longer sends.
 *
 * TO UPDATE: re-copy the file from the bot at its new commit, then update `ref` and `sha256` in
 * `pinned.json`. The test tells you both numbers when it fails.
 */
export * from "./dashboard-contract";
