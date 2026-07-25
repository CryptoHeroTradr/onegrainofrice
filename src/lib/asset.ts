/**
 * Prefix a root-relative public asset path with the app's basePath.
 *
 * next/image (and plain <img>) do NOT prepend Next's `basePath` to `src`, so an
 * image at /memes/x.svg would be requested at the server root and 404 when the
 * app is mounted under /onegrainofrice. Wrap every image src in asset().
 *
 * Kept in sync with next.config.ts via NEXT_PUBLIC_BASE_PATH.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/onegrainofrice";

// Per-build cache-busting stamp (see next.config.ts). Appended as `?v=…` so a
// new build serves new asset URLs, letting the browser cache each URL forever
// (Cache-Control: immutable) without ever going stale across deploys.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

export function asset(path: string): string {
  // Leave absolute URLs, protocol-relative URLs (//host/…) and already-relative
  // paths untouched — only root-relative local assets get the prefix + stamp.
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  // API routes serve dynamic content keyed by id (e.g. the Telegram media proxy
  // behind the meme belt), not build output. Stamping them with ?v=<build> gives
  // every meme a brand-new URL on every deploy, which throws away the browser's
  // cached copy of each image even though the upstream sends max-age=86400 — so
  // the belt refetches everything cold. Prefix only, never stamp.
  if (path.startsWith("/api/")) return `${BASE_PATH}${path}`;
  if (!BUILD_ID) return `${BASE_PATH}${path}`;
  // Preserve any existing query string.
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE_PATH}${path}${sep}v=${BUILD_ID}`;
}
