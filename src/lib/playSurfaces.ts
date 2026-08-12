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
 * The fifth is not a provider: `JourneyNav` is MOUNTED on `/games/chomp` (Phase 5.6) and reads
 * this list to know it is on a game — in flow rather than fixed, solid rather than
 * waiting for a scroll that never comes, and with no language control, because the
 * translate context on a play surface is inert by design.
 *
 * **CHECK EVERY NEW SITE-WIDE PROVIDER AGAINST THIS LIST.** *Added 2026-08-04.* Four
 * for four so far, and the fourth is the instructive one: translation was scoped off not
 * because it fought the game but because its script was the last thing standing between
 * the maze game and its zero-third-party-request acceptance criterion. Anything mounted in
 * `layout.tsx` is mounted on the games too, and "does this belong on a game?" is a
 * question that has to be asked at the time — nobody finds these later by reading
 * `layout.tsx`, they find them by measuring a built page and being surprised.
 *
 * Compare against `usePathname()`, which is basePath-stripped, so these are plain routes.
 *
 * ── THIS LIST IS NOT "THE GAMES". ─────────────────────────────────────────────
 * *Added 2026-08-05, Phase 7, when the three games moved under `/games` and the
 * obvious next step — "add every game route to it" — turned out to be wrong.*
 *
 * There are three games and exactly ONE of them belongs here. The list means
 * "turn the ambient decoration OFF on this route", which is a different question
 * from "is this a game":
 *
 *  - **`/games/catch` (Catch A Grain) is NOT here, deliberately.** You catch the
 *    grains WITH the chopstick cursor. Scoping the decoration off that route
 *    removes the game's controller. It also has no zero-third-party-request
 *    criterion, so translation costs it nothing.
 *  - **`/games/grains` (the Grains Game) is NOT here, deliberately.** Same cursor,
 *    and `globals.css`'s `.grains-play-area` styles a custom one for it. It is a
 *    page you tap, not a page you steer, and the rice particles are part of it.
 *  - **`/games/chomp` IS here**, because arrow keys are its primary control (and
 *    the Konami listener eats them), because a chopstick following the pointer
 *    over a maze HUD is wrong, and above all because the translate script was the
 *    last third-party request standing between that route and its acceptance
 *    criterion.
 *
 * So the rule for a new route is "does an ambient decoration fight this page?",
 * not "is it in `src/config/games.ts`".
 *
 * ── FOUR GAMES, TWO ON THE LIST. ──────────────────────────────────────────────
 * *Added 2026-08-07, when GRAINSNAKE shipped.* It IS here, and the answer came
 * from the rule above rather than from it being a game — three separate
 * decorations fight it, in descending order of how much they matter:
 *
 *  - **The Konami listener eats the arrow keys**, which are its primary control.
 *    Same argument as `/games/chomp`, and the one that would be noticed first.
 *  - **Translation would be a third-party request** on a route whose spec claims
 *    zero of them (`docs/grainsnake-spec.md`, *Acceptance criteria*). It is the
 *    only thing that would make that claim false.
 *  - **The chopstick cursor and the particle field are noise on the one channel
 *    the game communicates through** — the player reads occupied cells off the
 *    board, and this game has no controller to lose by scoping the cursor off.
 *
 * Note the asymmetry with `/games/catch`, which stays off the list for the exact
 * opposite reason: there, the cursor IS the controller.
 *
 * ── MOVING A ROUTE ON THIS LIST IS A TWO-FILE CHANGE. ─────────────────────────
 * The match is exact (`includes`), so renaming a route without renaming it here
 * fails SILENTLY and in the most expensive direction: nothing throws, no test
 * that isn't looking for it goes red, the page still renders — and the translate
 * script comes back, re-breaking a spec criterion, while the pointer trail
 * returns over the board. `/chomp` → `/games/chomp` in Phase 7 was exactly that
 * hazard, and `test/play-surfaces.test.ts` now exists so the next one cannot be
 * silent: it asserts every game route's play-surface status by name, and that
 * every entry here is a route that actually exists on disk.
 */
/**
 * ── A NON-GAME ROUTE IS ON THIS LIST, AND IT IS TEMPORARY. ────────────────────
 * *Added 2026-08-12.* `/dev/tetrice-gate` is a throwaway prototype page (see
 * `src/app/dev/tetrice-gate/page.tsx`) that exists to falsify the palette and
 * grain-axis decisions in `docs/tetrice-spec.md` before TETRICE's render phase
 * commits to them. It is here for the rule's own reason and not because it is a
 * game: the chopstick cursor and the rice-particle field would sit on top of the
 * exact pixels being judged, and a legibility gate read through a pointer trail
 * is measuring the instrument rather than the thing.
 *
 * It is named in `UNLISTED_PLAY_SURFACES` in `test/play-surfaces.test.ts`, which
 * is what keeps it a decision somebody made rather than a route that drifted onto
 * the list. **Delete both entries together with the page.**
 */
export const PLAY_SURFACE_ROUTES: readonly string[] = [
  "/games/chomp",
  "/games/grainsnake",
  "/games/tetrice",
  "/dev/tetrice-gate",
];

/** True when this route is a game that should be left alone by ambient decoration. */
export function isPlaySurface(pathname: string | null | undefined): boolean {
  return !!pathname && PLAY_SURFACE_ROUTES.includes(pathname);
}
