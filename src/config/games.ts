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

/**
 * The games as nav rows, for the 🎮 Games dropdown in the bar
 * (`components/journey/SiteMenu`).
 *
 * Derived rather than written out, so a fourth game appears in the dropdown by
 * being added to `games` above — the same reason the cards are derived. A
 * hand-kept copy of this list is how the menu ends up advertising two of the
 * three games, which is the state the site was in before Phase 7.
 */
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"];
/** "Three" — spelled out, because "3 games" reads like a spec sheet. */
const count = COUNT_WORDS[games.length] ?? String(games.length);
const Count = count[0]!.toUpperCase() + count.slice(1);
/** "Rice Chomp, Grains Game and Catch A Grain". */
const titleList = games
  .map((g) => g.title)
  .join(", ")
  .replace(/, ([^,]+)$/, " and $1");

/**
 * The arcade's own heading and one-line lede, shared by the `/games` index and
 * the home page's Games section — same reason as the cards: two surfaces
 * introducing the same games in two different sentences is drift that nobody
 * notices until the numbers disagree.
 *
 * The COUNT is computed, not typed. "Three games, no install" was written by
 * hand on both surfaces and in the route's meta description, and the failure mode
 * of a fourth game is not a broken page — it is three sentences that confidently
 * say three while four cards sit underneath them.
 */
export const gamesIntro = {
  headingLead: "the $RICE",
  headingAccent: "arcade",
  lede: `${Count} games, no install, no wallet needed. Pick one.`,
} as const;

/**
 * `/games` route metadata. Here rather than in the page for the same reason as
 * everything else in this file: it names every game, and a list of games that
 * lives next to the games cannot fall behind them.
 */
export const gamesMeta = {
  title: "Games — One Grain of Rice",
  description: `${Count} $RICE games: ${titleList}. All free, all in the browser, nothing to install.`,
} as const;

export const gamesNavLinks = games.map((game) => ({
  label: game.title,
  href: game.href,
  emoji: game.emoji,
}));
