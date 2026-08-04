/**
 * Routes that own the whole viewport as a play surface.
 *
 * The site mounts several ambient decorations globally in `app/layout.tsx` — the
 * chopstick cursor, the Konami rice dump, the rice-particle field. Each is charming on a
 * marketing page and wrong on a game: they hide the native cursor site-wide, listen on
 * `window` for keys that are now primary game controls, and drape grains over the play
 * area. None of them can see where they are, so the route list lives here and each one
 * checks it.
 *
 * One list, three consumers — a decoration that needs scoping off a game should be a
 * one-line addition here, not a fourth private copy of the same array.
 *
 * Compare against `usePathname()`, which is basePath-stripped, so these are plain routes.
 */
export const PLAY_SURFACE_ROUTES: readonly string[] = ["/chomp"];

/** True when this route is a game that should be left alone by ambient decoration. */
export function isPlaySurface(pathname: string | null | undefined): boolean {
  return !!pathname && PLAY_SURFACE_ROUTES.includes(pathname);
}
