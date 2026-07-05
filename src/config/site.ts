/**
 * Central site config — ALL copy, links, and numbers live here.
 * Nothing in `src/components/` hardcodes content.
 */

export const site = {
  name: "One Grain of Rice",
  ticker: "$RICE",
  wordmark: "♥ $RICE",
  tagline: "A meme coin for culture, community, and real-world impact.",
  heroTitle: { pre: "1 Grain of", accent: "$RICE." },
  heroTag: "just hold ONE grain.",

  /**
   * TODO: set your real buy link (Jupiter / pump.fun / Raydium) in .env.local
   * as NEXT_PUBLIC_BUY_URL, or replace the fallback below.
   */
  buyUrl: process.env.NEXT_PUBLIC_BUY_URL ?? "https://jup.ag/#TODO-set-buy-url",

  /**
   * TODO: set the real mint address in .env.local as NEXT_PUBLIC_TOKEN_ADDRESS,
   * or replace the fallback below. Shown in the UI with a copy button.
   */
  tokenAddress:
    process.env.NEXT_PUBLIC_TOKEN_ADDRESS ??
    "TODOxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1",

  /** Preserved original homepage. Rendered at /onegrainofrice/classic under basePath. */
  classicUrl: "/classic",

  socials: [
    { id: "x", label: "Follow $RICE on X", href: "https://x.com/TODO" },
    { id: "telegram", label: "Join the $RICE Telegram", href: "https://t.me/TODO" },
    { id: "discord", label: "Join the $RICE Discord", href: "https://discord.gg/TODO" },
    // Add more here — supported ids: "x" | "telegram" | "discord" | "globe"
  ] as { id: SocialId; label: string; href: string }[],

  memeWall: {
    heading: { lead: "meme fuel.", accent: "real impact." },
    sub: "Built by degen meme lords who give a f*ck.",
    /** Gentle autoplay for the carousel. Default OFF; never runs under reduced motion. */
    autoplay: false,
    autoplayDelayMs: 4000,
  },

  about: {
    heading: { lead: "from degen", accent: "to donor." },
    intro: "$RICE turns meme energy into meals, clean water, and lasting change.",
    columns: [
      {
        icon: "users",
        title: "Community-powered",
        body: "Built by degenerates. Run by the community.",
      },
      {
        icon: "shield",
        title: "Transparent on-chain",
        body: "Open books. Verifiable impact.",
      },
      {
        icon: "droplet",
        title: "Impact that matters",
        body: "A portion of every tx supports food and water causes.",
      },
    ] as { icon: AboutIcon; title: string; body: string }[],
  },

  impact: {
    heading: { lead: "one grain.", accent: "bigger than us." },
    sub: "Small in your hand. Huge in the world.",
    /** Stamp block bottom-left of the impact image. */
    stamp: ["for the culture.", "for the people.", "for the planet."],
    stats: [
      { icon: "bowl", value: 23741, label: "meals funded" },
      { icon: "water", value: 1582311, label: "liters of clean water" },
      { icon: "love", value: "∞", label: "degen love" },
    ] as { icon: StatIcon; value: number | string; label: string }[],
  },

  tokenomics: {
    heading: { lead: "honest", accent: "tokenomics." },
    sub: "Simple math, printed on paper. No hidden pockets.",
    /** TODO: replace ALL placeholder values below with the real allocation. */
    totalSupply: "1,000,000,000 $RICE", // TODO
    allocations: [
      { label: "Liquidity pool", pct: 80, note: "locked — TODO: link proof" }, // TODO
      { label: "Charity wallet", pct: 10, note: "on-chain, public" }, // TODO
      { label: "Community & memes", pct: 10, note: "airdrops, bounties, raids" }, // TODO
    ],
  },

  faq: {
    heading: { lead: "questions from", accent: "the rice fields." },
    items: [
      {
        q: "What is $RICE?",
        a: "A meme coin with a pulse. $RICE is community-run internet money that channels meme culture into real-world impact — meals funded, water delivered, receipts on-chain.",
      },
      {
        q: "How does the charity mechanic work?",
        a: "A fixed share of the supply sits in a public charity wallet. The community votes on drops; donations are executed on-chain so anyone can audit every grain from wallet to world.",
      },
      {
        q: "How do I buy?",
        a: "Get a Solana wallet, load it with SOL, and smash the BUY $RICE button up top — it takes you straight to the swap. Hold ONE grain, you're family.",
      },
      {
        q: "Is it verifiable on-chain?",
        a: "Everything. The mint address is printed on this page, the charity wallet is public, and every transfer is a permanent on-chain record. Don't trust — verify.",
      },
    ],
  },

  footer: {
    line: "♥ $RICE — the meme coin with a pulse.",
    disclaimer:
      "$RICE is a meme coin. Nothing on this page is financial advice. Do your own research and never risk what you can't afford to lose.",
  },
} as const;

export type SocialId = "x" | "telegram" | "discord" | "globe";
export type AboutIcon = "users" | "shield" | "droplet" | "heart" | "scan";
export type StatIcon = "bowl" | "water" | "love";
