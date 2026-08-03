/**
 * The app's basePath — ONE definition for all application code.
 *
 * The value is `""`: this site has its own domain (1grainofrice.com) and is served at
 * the root, so routes and assets are root-relative. `.env.local` sets
 * NEXT_PUBLIC_BASE_PATH="" explicitly, and next.config.ts turns that into Next's
 * `basePath` and re-exports it to the client through `env`.
 *
 * The fallback here is `""` on purpose. It used to be "/onegrainofrice" — the legacy
 * sub-path mount from when this app shared an IP gateway with CXMZ and RiceDAO — copied
 * into eight separate modules. Because `""` is not nullish, `??` never fired, so every
 * one of those fallbacks was dead code that merely *looked* authoritative. That is what
 * produced the chopstick-cursor 404: someone read a fallback, believed it, and
 * hardcoded "/onegrainofrice/..." into globals.css. There is now one place to read.
 *
 * Isomorphic: `process.env.NEXT_PUBLIC_*` is replaced with a literal at build time, so
 * this is safe to import from server and client alike. Note the value is baked in at
 * BUILD time — deploy/build.sh aborts without .env.local for exactly this reason.
 *
 * next.config.ts keeps its own copy of this expression, because a Next config cannot
 * safely import from the module graph it is configuring. Those two are the only places
 * NEXT_PUBLIC_BASE_PATH is read; keep them identical.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
