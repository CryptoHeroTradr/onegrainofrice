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
 * Trimmed nav for the new home. The landing page (`/`) is now the Grains Game;
 * the full site lives at `/home`, so "Home" is a real route and the section
 * anchors are written absolute against it (`/home#…`) to work from any page.
 * "Memes" is the /memes gallery route.
 */
export const homeNavLinks = [
  { label: "Home", href: "/home" },
  { label: "Memes", href: "/memes" },
  { label: "PFP & Meme Gen", href: "/pfp" },
  { label: "Charity", href: "/charity" },
  { label: "Token", href: "/home#tokenomics" },
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
