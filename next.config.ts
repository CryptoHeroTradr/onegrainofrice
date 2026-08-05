import type { NextConfig } from "next";

/**
 * ROOT MOUNT. This site owns its own domain (1grainofrice.com), so it is served at "/"
 * and every route and asset is root-relative. `.env.local` sets NEXT_PUBLIC_BASE_PATH=""
 * explicitly; this expression is what turns that into Next's `basePath` and re-exports
 * it to the client via `env` below.
 *
 * The fallback is "" ON PURPOSE. It used to be "/onegrainofrice" — the legacy sub-path
 * mount from when this app shared an IP gateway with CXMZ and RiceDAO. Because "" is not
 * nullish, `??` never fired: that fallback was dead code in every environment, copied
 * into eight modules, all of them describing a mount that no longer exists. It read as
 * authoritative and wasn't, which is how "/onegrainofrice/grains/chopstick-cursor.svg"
 * ended up hardcoded in globals.css and 404ing in production for months.
 *
 * If this app is ever remounted under a sub-path, set NEXT_PUBLIC_BASE_PATH in the
 * environment — do not reintroduce a non-empty literal here.
 *
 * NOTE: `src/lib/basePath.ts` holds the identical expression for application code (a
 * Next config cannot safely import from the module graph it configures). Those two are
 * the only reads of NEXT_PUBLIC_BASE_PATH in the repo. Keep them in step.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Origin of the RiceDAO game server (apps/server) that runs the live Telegram
 * meme-sync bot and exposes /api/telegram-media. The /memes gallery here is a
 * clone of the RiceDAO memes page and is fed by THAT already-running backend —
 * we proxy to it same-origin (below) so there's no CORS and, crucially, no
 * second Telegram bot (getUpdates is exclusive per token; a duplicate poller
 * would break the existing one). Runs on the same host, so localhost by default.
 */
const memesApiOrigin = process.env.MEMES_API_ORIGIN ?? "http://127.0.0.1:1112";

/**
 * Cache-busting build stamp (resolved just below). The `pnpm build` script
 * mints a fresh one per build; direct `next build` falls back to the git SHA. So:
 *   - it becomes Next's build id (generateBuildId below), and
 *   - asset() (src/lib/asset.ts) appends it as `?v=<BUILD_ID>` to every public
 *     asset URL.
 * Because the value is baked in at BUILD time (env → DefinePlugin literals,
 * generateBuildId → .next/BUILD_ID file), server and client always agree within
 * a build even though this module is re-evaluated at `next start`. Every code
 * change ⇒ new build ⇒ new BUILD_ID ⇒ new asset URLs ⇒ caches update, while the
 * headers() rules below let browsers cache the *previous* URLs forever.
 */
function resolveBuildId(): string {
  // Preferred: a stamp set ONCE by the `build` script (see package.json), so
  // every compiler pass in a single build agrees. Falls back to the git commit
  // so `next build`/`next start` invoked directly still get a stable, per-commit
  // id, and finally to a timestamp. NOT a bare Date.now() at module scope: Next
  // evaluates this config in several workers per build, and divergent stamps
  // between the client and server bundles cause hydration mismatches.
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  try {
    return require("node:child_process")
      .execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return String(Date.now());
  }
}

const BUILD_ID = resolveBuildId();

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  // Build/deploy separation (see deploy/build.sh): when NEXT_DIST_DIR is set, the
  // build is written there (builds/<sha>) instead of ./.next, so a build never
  // touches what the live `next start` process serves. Unset — i.e. every normal
  // or live invocation — leaves Next's default ".next" untouched (the key is not
  // even present), so live behaviour is byte-identical.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  generateBuildId: () => BUILD_ID,
  // Expose the resolved basePath + build stamp to components so asset()
  // (src/lib/asset.ts) can prefix image sources and version them. next/image
  // does NOT auto-prepend basePath to src, hence asset() in the first place.
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Long-lived caching, safe because URLs change when content does:
  //   - /_next/static/* is content-hashed by Next → immutable forever.
  //   - Public assets requested WITH a ?v= stamp (via asset()) are immutable
  //     forever too; the stamp changes every build so a new build serves new
  //     URLs rather than stale bytes.
  //   - Public assets requested WITHOUT a stamp (favicon, og image, manifest,
  //     anything referenced outside asset()) get a short TTL + revalidation so
  //     they can never go stale for long.
  // HTML documents are intentionally left to Next's own headers so a new build
  // is reflected on the very next request.
  async headers() {
    const immutable = [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ];
    // path-to-regexp alternation suffix (Next's documented static-asset form:
    // `/:all*(svg|jpg|png)`). A brace list `{a,b}` is NOT alternation here.
    const assetMatch =
      "/:all*(png|jpg|jpeg|gif|webp|avif|svg|ico|woff|woff2|ttf|otf|mp3|wav|ogg|mp4|webm)";
    return [
      { source: "/_next/static/:path*", headers: immutable },
      {
        // Versioned public asset (has ?v=…) → cache forever.
        source: assetMatch,
        has: [{ type: "query", key: "v" }],
        headers: immutable,
      },
      {
        // Unversioned public asset → short cache, revalidate in the background.
        // `missing` the ?v= stamp so this never overrides the immutable rule
        // above (both sources match a versioned request; the later rule wins).
        source: assetMatch,
        missing: [{ type: "query", key: "v" }],
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
  // Phase 7 (2026-08-05) moved the site's information architecture: `/` became the
  // home page, the three games moved under `/games`, and the home page gave up
  // `/home`. Every path below RESOLVED before that change, so every one of them
  // redirects rather than 404s — the rule is that nothing which worked yesterday
  // is a dead link today.
  //
  // `permanent: true` is a 308, which preserves the method and (in every browser)
  // the fragment, so `/home#tokenomics` still lands on the tokenomics section.
  //
  // NOT redirected, deliberately: `/` itself. It still returns 200; it just serves
  // the home page instead of the Grains Game. That is a change to what a shared
  // link SHOWS, not a broken link, and a redirect there would send every existing
  // bookmark and inbound link somewhere it did not ask to go.
  async redirects() {
    return [
      // Catch A Grain. Public since it shipped — this is the one the brief called out.
      { source: "/play", destination: "/games/catch", permanent: true },
      // RICE CHOMP. Never shared and nobody knows the path, but it returned 200,
      // and "no path that resolved yesterday 404s today" is worth more as a rule
      // with no exceptions than as a rule with one.
      { source: "/chomp", destination: "/games/chomp", permanent: true },
      // The home page moved to `/`. Heavily linked — the nav logo, the footer
      // wordmark and every `#tokenomics` anchor pointed here — so it redirects
      // rather than serving a second copy of a page that now lives at the root.
      { source: "/home", destination: "/", permanent: true },
    ];
  },
  // Same-origin proxy for the meme gallery's data + token-hiding media stream.
  // The browser only ever talks to this site; Next forwards to the game server.
  async rewrites() {
    // Only the media STREAM endpoints are a straight proxy. The list endpoint
    // (/api/telegram-media) is a route handler here so it can drop blocked ids.
    return [
      {
        source: "/api/telegram-media/file/:path*",
        destination: `${memesApiOrigin}/api/telegram-media/file/:path*`,
      },
      {
        source: "/api/telegram-media/thumb/:path*",
        destination: `${memesApiOrigin}/api/telegram-media/thumb/:path*`,
      },
    ];
  },
  images: {
    // Serve images directly instead of through the optimizer. Required under a
    // basePath: the optimizer resolves local sources against the root origin
    // (/hero-grain.svg) and 404s, while direct <img> tags get the basePath
    // prefix and load fine. Placeholder memes are SVGs (the optimizer passes
    // those through unchanged anyway), so nothing of value is lost.
    unoptimized: true,
    // Kept for when real raster memes are dropped in and SVGs are served inline.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
