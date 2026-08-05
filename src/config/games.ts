/**
 * The arcade. One entry per game, read by the `/games` index and by
 * `test/play-surfaces.test.ts`.
 *
 * Added in Phase 7 (2026-08-05), when the three games — which had been at `/`,
 * `/chomp` and `/play`, i.e. nowhere near each other — moved under one `/games`
 * parent. The list is data rather than three hardcoded cards because the index
 * page, the route-existence test and (one day) game four all need the same
 * answer to "what games are there", and three copies of that answer is how a
 * fourth game ships with a page nobody can reach.
 *
 * `href` is a plain route: `usePathname()` and `<Link>` are both basePath-aware,
 * so nothing here carries a prefix. See `src/lib/playSurfaces.ts` for why being a
 * game and being a "play surface" are NOT the same question — only RICE CHOMP is
 * both.
 */
export const games = [
  {
    slug: "chomp",
    href: "/games/chomp",
    emoji: "👾",
    title: "Rice Chomp",
    tagline: "Clear the paddy before the pests clear you.",
    blurb:
      "An arcade maze chase. Steer a grain of rice through the paddy, eat it clean, and stay ahead of a rat, a sparrow, a weevil and a locust that each hunt you differently.",
  },
  {
    slug: "grains",
    href: "/games/grains",
    emoji: "🍚",
    title: "Grains Game",
    tagline: "Tap. The whole world is tapping with you.",
    blurb:
      "One tap, one grain, one live global total. Every grain you drop counts toward your country's score on a board that never stops moving.",
  },
  {
    slug: "catch",
    href: "/games/catch",
    emoji: "🥢",
    title: "Catch A Grain",
    tagline: "Chopsticks at the ready.",
    blurb:
      "Falling grains, one pair of chopsticks, and no floor to spare. The site's chopstick cursor is the controller.",
  },
] as const;

export type Game = (typeof games)[number];
