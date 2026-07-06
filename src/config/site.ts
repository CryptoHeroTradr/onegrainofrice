/**
 * Central site config — ALL copy, links, and numbers live here.
 * Nothing in `src/components/` hardcodes content.
 */

import type { PlateTint } from "./memes";

/** Rice grains per kilogram — tunable. Drives grainsDonated in the charity DTO. */
export const GRAINS_PER_KG = 50000;

/** $RICE mint (Solana mainnet). Override via NEXT_PUBLIC_TOKEN_ADDRESS. */
const CONTRACT =
  process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? "2wQq3MrFFHPQnapMt1wnZ2vGkVZDv5ENDCrdLCqFpump";
/** Jupiter swap link. Override via NEXT_PUBLIC_BUY_URL. */
const BUY_URL = process.env.NEXT_PUBLIC_BUY_URL ?? `https://jup.ag/swap/SOL-${CONTRACT}`;
/** RiceDAO governance page — where votes actually happen. */
const DAO_URL = process.env.NEXT_PUBLIC_DAO_URL ?? "http://209.141.52.60/RiceDAO/dao";

export const site = {
  name: "One Grain of Rice",
  ticker: "$RICE",
  wordmark: "♥ $RICE",
  tagline: "A meme coin for culture, community, and real-world impact.",
  heroTitle: { pre: "1 Grain of", accent: "$RICE." },
  heroTag: "just hold ONE grain.",

  /** Canonical token facts. `tokenAddress`/`buyUrl` below alias these. */
  token: {
    name: "$RICE",
    contract: CONTRACT,
    buyUrl: BUY_URL,
    chain: "Solana",
  },

  buyUrl: BUY_URL,
  tokenAddress: CONTRACT,

  /** On-chain charity wallet — every donation is public and verifiable. */
  charityWallet: "7SY8eauzB9bSJvM3tShxZEGnf354UiAucq9yDWZb3kVj",

  /** Preserved original homepage. Rendered at /onegrainofrice/classic under basePath. */
  classicUrl: "/classic",

  charity: {
    heading: { lead: "every grain,", accent: "one real meal." },
    sub: "Each grain in the bowl is one meal funded on-chain. As the community gives, the pile grows — and every transfer settles to a public charity wallet you can watch yourself.",
    mission: "When we reach 100 $RICE, we donate to real hunger relief.",
    missionTag: "Real rice. Real kitchens. Real people.",
    walletLabel: "on-chain charity wallet",
    grainsLabel: "grains donated",
    stats: {
      totalKg: "kg in the pantry",
      fedToday: "fed today",
      fedAllTime: "fed all-time",
    },
  },

  /** Telegram handles (RiceDAO). */
  handles: {
    telegramMemes: "@ricecontent",
    telegramBot: "@RiceDAOgamebot",
  },

  socials: [
    { id: "telegram", label: "$RICE memes on Telegram (@ricecontent)", href: "https://t.me/ricecontent" },
    { id: "telegram", label: "Play the game — @RiceDAOgamebot", href: "https://t.me/RiceDAOgamebot" },
    { id: "x", label: "Follow $RICE on X", href: "https://x.com/TODO" },
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
    sub: "Every grain the store earns splits four ways — automatically, on-chain, in the open.",
    contractLabel: "contract address",
    /** Store-income split (four grains → four bowls). Must total 100. */
    split: [
      { label: "Buy $RICE (Jupiter)", pct: 40, plate: "green", note: "buys back on the open market" },
      { label: "Charity", pct: 30, plate: "blue", note: "to the public charity wallet" },
      { label: "Treasury", pct: 20, plate: "red", note: "keeps the village running" },
      { label: "Burn", pct: 10, plate: "green", note: "gone forever, supply tightens" },
    ] as { label: string; pct: number; plate: PlateTint; note: string }[],
    /** Kept for the /classic supply-allocation bar (do not remove). */
    totalSupply: "1,000,000,000 $RICE",
    allocations: [
      { label: "Liquidity pool", pct: 80, note: "locked" },
      { label: "Charity wallet", pct: 10, note: "on-chain, public" },
      { label: "Community & memes", pct: 10, note: "airdrops, bounties, raids" },
    ],
  },

  /** Earn loop (RiceDAO game economy). */
  earn: {
    heading: { lead: "feed the town,", accent: "earn $RICE." },
    perKg: 0.5,
    minClaim: 100,
    cooldownHours: 72,
    steps: [
      {
        title: "Donate rice",
        body: "Feed the village in the game. Every kilogram you contribute is tracked on-chain.",
      },
      {
        title: "Earn 0.5 $RICE per kg",
        body: "Your generosity mints rewards — half a $RICE for every kilogram donated.",
      },
      {
        title: "Claim & repeat",
        body: "Claim once you reach 100 $RICE, then a 72-hour cooldown resets the cycle.",
      },
    ],
  },

  /** Mythic origin — the one-grain folktale RiceDAO is built on. */
  lore: {
    heading: { lead: "the legend of", accent: "one grain." },
    body: [
      "A village was starving, and a clever girl asked only for rice: one grain today, doubled each day thereafter.",
      "One became two. Two became four. By the month's end a single grain had multiplied into millions — enough to fill every empty bowl in the land.",
      "$RICE is that grain, on-chain. Hold one, and you hold the whole idea: small things, compounded by a community, feed the world.",
    ],
    tag: "Real rice. Real kitchens. Real people.",
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
      {
        q: "Is this a real charity?",
        a: "Yes. When the community pool reaches 100 $RICE, we donate to real hunger relief — real rice, real kitchens, real people. The charity wallet is public so every drop is auditable.",
      },
      {
        q: "How do donations reach people?",
        a: "Surplus flows to the public charity wallet, then out to hunger-relief partners as rice and meals. Every hop is on-chain, and the pantry counters (kg, fed today, fed all-time) update live from the game.",
      },
      {
        q: "What is the Village?",
        a: "The Village is the RiceDAO game — a little town you feed. Donate rice there to earn $RICE (0.5 per kg), and watch the town go from famine to full. Enter it from the BUY / Village links up top.",
      },
      {
        q: "Is $RICE the same token as the game?",
        a: "Yes — one token. The $RICE you earn feeding the Village is the same mint you can buy on Jupiter, the same one that funds charity. One grain, everywhere.",
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

  /** RiceDAO full (AI) PFP generator. Override with NEXT_PUBLIC_VILLAGE_PFP_URL. */
  villagePfpUrl: process.env.NEXT_PUBLIC_VILLAGE_PFP_URL ?? "http://209.141.52.60/RiceDAO/pfp",

  /** DAO governance link + a fallback illustrative proposal (Phase 10). The
      RiceDAO proposals feed is wallet-gated, so with no public endpoint this
      example renders, clearly flagged `illustrative`. */
  daoVoteUrl: DAO_URL,
  dao: {
    heading: { lead: "grains decide,", accent: "the bowl gives." },
    sub: "Holders vote by weight — the heavier the bowl, the louder the will of the village.",
    voteCta: "Vote on RiceDAO",
    example: {
      id: "example",
      question: "Where does the next charity drop go?",
      options: [
        { label: "Rice for the coast", votes: 62, plate: "blue" },
        { label: "Clean-water wells", votes: 38, plate: "green" },
      ] as { label: string; votes: number; plate: PlateTint }[],
      illustrative: true,
    },
  },

  /** Roadmap terraces (Phase 10). `done` floods the paddy green. */
  roadmap: [
    { title: "Plant the seed", detail: "Fair launch on Solana. Liquidity locked, contract public.", done: true },
    { title: "Grow the village", detail: "RiceDAO game live — feed the town, earn $RICE.", done: true },
    { title: "First harvest", detail: "Charity milestone reached; first on-chain donation sent.", done: false },
    { title: "Terrace the hills", detail: "DAO routes surplus to real hunger-relief partners.", done: false },
    { title: "Fill every bowl", detail: "Sustained, compounding giving — one grain, worldwide.", done: false },
  ] as { title: string; detail: string; done: boolean }[],

  pfp: {
    heading: { lead: "rice-ify", accent: "your PFP." },
    sub: "Drop a picture, stack the toppings, download. It all happens in your browser.",
    dropLabel: "Drop your image here",
    dropHint: "or click to choose — PNG / JPG",
    riceifyLabel: "Rice-ify",
    downloadLabel: "Download PNG",
    aiPrompt: "Want the AI version?",
    aiLinkLabel: "Open the full generator",
    privacyNote: "100% in your browser. Your image never leaves your device.",
  },

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
