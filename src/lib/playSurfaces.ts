/**
 * Routes that own the whole viewport as a play surface.
 *
 * The site mounts several providers globally in `app/layout.tsx` — the chopstick cursor,
 * the Konami rice dump, the rice-particle field, page translation. Each is charming on a
 * marketing page and wrong on a game: they hide the native cursor site-wide, listen on
 * `window` for keys that are now primary game controls, drape grains over the play area,
 * and rewrite the text nodes of a live score. None of them can see where they are, so the
 * route list lives here and each one checks it.
 *
 * One list, five consumers — a provider that needs scoping off a game should be a
 * one-line addition here, not a sixth private copy of the same array.
 *
 * The fifth is not a provider: `JourneyNav` is MOUNTED on `/chomp` (Phase 5.6) and reads
 * this list to know it is on a game — in flow rather than fixed, solid rather than
 * waiting for a scroll that never comes, and with no language control, because the
 * translate context on a play surface is inert by design.
 *
 * **CHECK EVERY NEW SITE-WIDE PROVIDER AGAINST THIS LIST.** *Added 2026-08-04.* Four
 * for four so far, and the fourth is the instructive one: translation was scoped off not
 * because it fought the game but because its script was the last thing standing between
 * /chomp and its zero-third-party-request acceptance criterion. Anything mounted in
 * `layout.tsx` is mounted on the games too, and "does this belong on a game?" is a
 * question that has to be asked at the time — nobody finds these later by reading
 * `layout.tsx`, they find them by measuring a built page and being surprised.
 *
 * Compare against `usePathname()`, which is basePath-stripped, so these are plain routes.
 */
export const PLAY_SURFACE_ROUTES: readonly string[] = ["/chomp"];

/** True when this route is a game that should be left alone by ambient decoration. */
export function isPlaySurface(pathname: string | null | undefined): boolean {
  return !!pathname && PLAY_SURFACE_ROUTES.includes(pathname);
}
