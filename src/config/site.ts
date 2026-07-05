/**
 * Central site config — ALL copy, links, and numbers live here.
 * Nothing in `src/components/` hardcodes content.
 */

/** Rice grains per kilogram — tunable. Drives grainsDonated in the charity DTO. */
export const GRAINS_PER_KG = 50000;

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

  /** $RICE mint (Solana mainnet). Override via NEXT_PUBLIC_TOKEN_ADDRESS. */
  tokenAddress:
    process.env.NEXT_PUBLIC_TOKEN_ADDRESS ??
    "2wQq3MrFFHPQnapMt1wnZ2vGkVZDv5ENDCrdLCqFpump",

  /** On-chain charity wallet — every donation is public and verifiable. */
  charityWallet: "7SY8eauzB9bSJvM3tShxZEGnf354UiAucq9yDWZb3kVj",

  /** Preserved original homepage. Rendered at /onegrainofrice/classic under basePath. */
  classicUrl: "/classic",

  charity: {
    heading: { lead: "every grain,", accent: "one real meal." },
    sub: "Each grain in the bowl is one meal funded on-chain. As the community gives, the pile grows — and every transfer settles to a public charity wallet you can watch yourself.",
    walletLabel: "on-chain charity wallet",
    grainsLabel: "grains donated",
    stats: {
      totalKg: "kg in the pantry",
      fedToday: "fed today",
      fedAllTime: "fed all-time",
    },
  },

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

  /** RiceDAO village/game. Override with NEXT_PUBLIC_VILLAGE_URL. */
  villageUrl: process.env.NEXT_PUBLIC_VILLAGE_URL ?? "http://209.141.52.60/RiceDAO/",

  nav: {
    logo: "🌾 one grain of rice",
    classicLabel: "classic site",
    // Hrefs: same-page anchors, plus Village (external) resolved in the component.
    links: [
      { label: "Memes", href: "#memes" },
      { label: "Charity", href: "#donate" },
      { label: "Token", href: "#token" },
      { label: "Village", href: "village" }, // sentinel → site.villageUrl
    ],
  },

  hero: {
    ctaPrimary: "Get $RICE",
    ctaSecondary: "Enter the Village",
  },

  /** Four-beat scroll journey; the bowl doubles SEED→GROW→HARVEST→DONATE. */
  journey: {
    seed: {
      heading: { lead: "it starts with", accent: "one grain." },
      body: "A single seed, held in an open palm. No whales, no gatekeepers — just a community planting something real.",
    },
    grow: {
      heading: { lead: "the field", accent: "grows." },
      body: "Every holder is a farmer. Memes are the water, the community is the sun. Row by row, the paddy fills in.",
    },
    harvest: {
      heading: { lead: "the harvest", accent: "doubles." },
      body: "Grain by grain the bowl fills — then fills again. Momentum compounds, and the pile begins to overflow.",
    },
    donate: {
      heading: { lead: "the bowl", accent: "gives back." },
      body: "What overflows, we give. Every surplus grain becomes a real meal, settled on-chain to a public charity wallet.",
    },
  },
} as const;

/** Config-gated ambient farm loop behind the hero (needs a local asset). */
export const HERO_FARM_AMBIENT = process.env.NEXT_PUBLIC_HERO_FARM_AMBIENT === "true";

export type SocialId = "x" | "telegram" | "discord" | "globe";
export type AboutIcon = "users" | "shield" | "droplet" | "heart" | "scan";
export type StatIcon = "bowl" | "water" | "love";
