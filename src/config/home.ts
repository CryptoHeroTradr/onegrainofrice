/**
 * New-home CURATION layer. The new `/` renders a scrubbed subset of the shared
 * `src/config/site.ts` data (no game/village/charity/donation). Classic
 * (`/classic`) keeps reading `site.ts` in full — nothing here mutates it.
 *
 * FAQ items and roadmap milestones have no id fields, so we key by their
 * question text / title (the only stable identifiers) rather than editing the
 * shared arrays.
 */

/**
 * The site nav. Home is `/` and the section anchors are written absolute against
 * it (`/#…`) so they work from any page. "Memes" is the /memes gallery route.
 *
 * `emoji` is rendered by the 🌾 Menu dropdown (see components/journey/SiteMenu).
 *
 * **This is the WHOLE menu.** *Phase 7, 2026-08-05.* It used to be most of it:
 * `SiteMenu` prepended a hardcoded "🍚 Grains Game → /" entry because the Grains
 * Game was the landing page and therefore could not be a nav link like the
 * others. That special case is gone with the swap — every route in the menu is
 * now an entry in this one array, in this order, and there is no second list to
 * keep in step.
 *
 * The three games collapsed into ONE "🎮 Games" entry pointing at the `/games`
 * index, replacing the single "Rice Chomp" link (the other two games were never
 * in the menu at all — the Grains Game was the special case above and Catch A
 * Grain was reachable only by knowing the URL).
 */
export const homeNavLinks = [
  { label: "Home", href: "/", emoji: "🏠" },
  { label: "Memes", href: "/memes", emoji: "😂" },
  { label: "Games", href: "/games", emoji: "🎮" },
  { label: "PFP & Meme Gen", href: "/pfp", emoji: "🎨" },
  { label: "Charity", href: "/charity", emoji: "❤️" },
  { label: "Token", href: "/#tokenomics", emoji: "💰" },
] as const;

/**
 * FAQ questions surfaced on the new home, keyed by `site.faq.items[].q`.
 * Everything mentioning the game, village, donations, or charity is scrubbed,
 * which leaves only the how-to-buy answer clean.
 * TODO(lito): add fresh token/meme FAQ copy so this isn't a single item.
 */
export const homeFaqIds: string[] = [
  "How do I buy?",
];

/**
 * Roadmap milestones surfaced on the new home, keyed by `site.roadmap[].title`.
 * Milestones naming the game/village ("Grow the village"), charity/donation
 * ("First harvest", "Terrace the hills") are scrubbed.
 */
export const homeRoadmapTitles: string[] = [
  "Plant the seed",
  "Fill every bowl",
];
