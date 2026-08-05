/**
 * THERE IS ONE LIST OF GAMES, AND ONE SET OF WORDS ABOUT THEM.
 *
 * Three surfaces now advertise the three games: the `/games` index, the home
 * page's Games section, and the 🎮 Games dropdown in the nav. Before Phase 7
 * there was no list at all — the games were at `/`, `/chomp` and `/play`, and the
 * menu knew about one of them — which is the state this guards against
 * recurring, because it recurs by ADDITION rather than by breakage: someone
 * writes a second set of cards with slightly better copy, and a month later the
 * two disagree about what Rice Chomp is.
 *
 * So the assertion is not "the copy matches" (two copies that match today are
 * still two copies). It is that the second copy does not EXIST: every surface
 * renders from `src/config/games.ts`, and none of them contains a game's name,
 * tagline or blurb as a literal.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { games, gamesIntro, gamesNavLinks } from "@/config/games";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Comments stripped: the prose in these files legitimately names the games. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every surface that shows the games, and none of which may spell them out. */
const SURFACES = [
  "src/app/games/page.tsx",
  "src/app/page.tsx",
  "src/components/games/GameCards.tsx",
  "src/components/journey/JourneyNav.tsx",
];

describe("the nav dropdown", () => {
  it("lists every game, derived from the config", () => {
    expect(gamesNavLinks.map((l) => l.href)).toEqual(games.map((g) => g.href));
    expect(gamesNavLinks.map((l) => l.label)).toEqual(games.map((g) => g.title));
  });

  it("is the SAME component as the 🌾 Menu, with different props", () => {
    const nav = code("src/components/journey/JourneyNav.tsx");
    // Two <SiteMenu> mounts and no second dropdown implementation. A copied
    // component is the thing the brief for this ruled out by name.
    expect(nav.match(/<SiteMenu\b/g) ?? []).toHaveLength(2);
    expect(nav).toMatch(/items=\{gamesNavLinks\}/);
  });

  it("gives the two panels distinct ids, so aria-controls points somewhere", () => {
    const nav = code("src/components/journey/JourneyNav.tsx");
    const ids = [...nav.matchAll(/id="([a-z-]+-menu)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("the cards", () => {
  it("are one component, rendered by both the index and the home page", () => {
    for (const file of ["src/app/games/page.tsx", "src/app/page.tsx"]) {
      expect(code(file), `${file} should render <GameCards>`).toMatch(/<GameCards\b/);
    }
  });

  it("sit above the PFP section on the home page", () => {
    const home = code("src/app/page.tsx");
    const gamesAt = home.indexOf('id="games"');
    const pfpAt = home.indexOf('id="pfp"');
    expect(gamesAt).toBeGreaterThan(-1);
    expect(pfpAt).toBeGreaterThan(-1);
    expect(gamesAt).toBeLessThan(pfpAt);
  });
});

describe("no surface hardcodes the copy", () => {
  const strings = [
    ...games.flatMap((g) => [g.title, g.tagline, g.blurb]),
    gamesIntro.lede,
    gamesIntro.headingAccent,
  ];

  for (const file of SURFACES) {
    const src = code(file);
    it(`${file} contains no game copy as a literal`, () => {
      for (const s of strings) {
        expect(src, `${file} spells out ${JSON.stringify(s.slice(0, 40))}`).not.toContain(s);
      }
    });
  }
});
