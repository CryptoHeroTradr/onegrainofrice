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

  it("every play-surface route is one of the games", () => {
    const gameRoutes = new Set<string>(games.map((g) => g.href));
    for (const route of PLAY_SURFACE_ROUTES) {
      expect(gameRoutes.has(route), `${route} is a play surface but not in src/config/games.ts`).toBe(true);
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
