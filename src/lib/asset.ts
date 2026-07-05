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

export function asset(path: string): string {
  // Leave absolute URLs and already-relative paths untouched.
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
}
