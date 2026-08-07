/**
 * The play-surface list, pinned against a route move.
 *
 * *Added 2026-08-05, Phase 7, when `/chomp` became `/games/chomp`.*
 *
 * `src/lib/playSurfaces.ts` matches route paths EXACTLY, and five things read it:
 * the chopstick cursor, the Konami rice dump, the rice-particle field, the
 * translate provider and `JourneyNav`. So moving a game route without moving its
 * entry there fails in the worst available way — silently. Nothing throws, the
 * page still renders, every other test stays green, and two things quietly come
 * back: the Google Translate script (which breaks the spec's "zero third-party
 * network requests" criterion for the maze game) and the ambient decorations
 * (which drape a pointer trail and a hidden cursor over a live board).
 *
 * There is nothing to notice. That is the entire reason this file exists.
 *
 * The suite deliberately asserts the status of EVERY game by name — including the
 * two that must NOT be play surfaces — because the failure this guards against
 * runs in both directions. Adding `/games/catch` here would delete that game's
 * controller (you catch grains with the chopstick cursor); adding `/games/grains`
 * would do the same and strip the particles that are part of the page. "Is a
 * game" and "is a play surface" are different questions, and a test that only
 * checked the maze game would let a well-meaning future edit answer them the same
 * way.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PLAY_SURFACE_ROUTES, isPlaySurface } from "@/lib/playSurfaces";
import { games } from "@/config/games";

const APP_DIR = join(__dirname, "..", "src", "app");

/** The route → page.tsx mapping Next's App Router uses. */
function pageFileFor(route: string): string {
  return join(APP_DIR, ...route.split("/").filter(Boolean), "page.tsx");
}

/**
 * Every game, and whether it is a play surface. This table is the thing a route
 * move has to update, and it is written out longhand rather than derived from
 * `games` so that a slug rename cannot quietly satisfy it.
 */
const EXPECTED: ReadonlyArray<{ route: string; playSurface: boolean; why: string }> = [
  {
    route: "/games/chomp",
    playSurface: true,
    why: "arrow keys are its controls, and the translate script is a third-party request it may not make",
  },
  {
    route: "/games/grains",
    playSurface: false,
    why: "the chopstick cursor and the rice particles are part of the page",
  },
  {
    route: "/games/catch",
    playSurface: false,
    why: "you catch the grains WITH the chopstick cursor — scoping it off removes the controller",
  },
  {
    route: "/games/grainsnake",
    playSurface: true,
    why: "arrow keys are its controls, and the translate script is a third-party request it may not make",
  },
];

describe("play surfaces", () => {
  it("RICE CHOMP is a play surface, at the route it actually lives at", () => {
    // The assertion that would have caught the Phase 7 move on its own.
    expect(isPlaySurface("/games/chomp")).toBe(true);
  });

  it.each(EXPECTED)("$route play-surface status is $playSurface — $why", ({ route, playSurface }) => {
    expect(isPlaySurface(route)).toBe(playSurface);
  });

  it("every game in the config has a page on disk", () => {
    for (const game of games) {
      expect(existsSync(pageFileFor(game.href)), `${game.href} has no page.tsx`).toBe(true);
    }
  });

  it("every play-surface route is a route that exists", () => {
    // A stale entry is the other half of the same bug: the list still names the
    // old path, so nothing matches and the decorations come back everywhere.
    for (const route of PLAY_SURFACE_ROUTES) {
      expect(existsSync(pageFileFor(route)), `${route} is in PLAY_SURFACE_ROUTES but has no page.tsx`).toBe(true);
    }
  });

  /**
   * Play surfaces that are LIVE but deliberately not announced in
   * `src/config/games.ts`.
   *
   * *Added 2026-08-07, promoting GRAINSNAKE without its card.* The assertion below
   * used to read "every play-surface route is one of the games", which was written
   * when being a play surface and being a listed game were assumed to coincide. A
   * route can be promoted and reachable while its card is held back — the card is an
   * announcement (four surfaces plus the computed count word), and shipping the code
   * and announcing it are separate acts.
   *
   * This is an ALLOWLIST rather than a deleted assertion on purpose: an unlisted play
   * surface has to be named here, so it stays a decision somebody made rather than a
   * route that quietly fell out of the games list. Emptying this list restores the
   * original, stricter invariant.
   *
   * REMOVE an entry in the same commit that adds its card.
   */
  const UNLISTED_PLAY_SURFACES: ReadonlyArray<{ route: string; why: string }> = [
    // EMPTY, which restores the original stricter invariant: every play surface is a
    // listed game. GRAINSNAKE's entry was removed 2026-08-07 when its leaderboard
    // shipped and its card went into src/config/games.ts.
  ];

  it("every play-surface route is a game, or is a NAMED unlisted route", () => {
    const gameRoutes = new Set<string>(games.map((g) => g.href));
    const unlisted = new Set(UNLISTED_PLAY_SURFACES.map((u) => u.route));
    for (const route of PLAY_SURFACE_ROUTES) {
      expect(
        gameRoutes.has(route) || unlisted.has(route),
        `${route} is a play surface but is neither in src/config/games.ts nor named in UNLISTED_PLAY_SURFACES`,
      ).toBe(true);
    }
  });

  it("nothing lingers in the unlisted allowlist once its card ships", () => {
    // The other direction: an entry left here after the card lands would silently
    // weaken the invariant for a route that no longer needs the exemption.
    const gameRoutes = new Set<string>(games.map((g) => g.href));
    for (const { route } of UNLISTED_PLAY_SURFACES) {
      expect(
        gameRoutes.has(route),
        `${route} now HAS a card — delete it from UNLISTED_PLAY_SURFACES`,
      ).toBe(false);
    }
  });

  it("an unlisted play surface still has a page on disk", () => {
    for (const { route } of UNLISTED_PLAY_SURFACES) {
      expect(existsSync(pageFileFor(route)), `${route} has no page.tsx`).toBe(true);
    }
  });

  it("does not match by prefix — /games alone is not a play surface", () => {
    // The index page is an ordinary marketing page: it wants the cursor, the
    // particles and translation. If the match ever loosens to a prefix test,
    // this is what goes red.
    expect(isPlaySurface("/games")).toBe(false);
    expect(isPlaySurface("/")).toBe(false);
    expect(isPlaySurface("/games/chomp/")).toBe(false);
  });

  it("survives a null or empty pathname", () => {
    expect(isPlaySurface(null)).toBe(false);
    expect(isPlaySurface(undefined)).toBe(false);
    expect(isPlaySurface("")).toBe(false);
  });
});
