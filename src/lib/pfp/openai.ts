// Server-only PFP AI helper. Mirrors RiceDAO's apps/server/src/routes/pfp.ts
// (same prompts, same model calls) but as a plain module the Next route handlers
// import — the OpenAI key is read here from process.env and NEVER shipped to the
// browser. Do NOT import this from a client component.

import OpenAI from "openai";

export const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
export const aiEnabled = !!OPENAI_KEY;

// Models — same defaults as RiceDAO (all gpt-image-1), overridable via env.
export const PFP_EDIT_MODEL = process.env.PFP_EDIT_MODEL ?? "gpt-image-1";
export const PFP_GEN_MODEL = process.env.PFP_GEN_MODEL ?? "gpt-image-1";
export const PFP_PFP_MODEL = process.env.PFP_PFP_MODEL ?? "gpt-image-1";

let client: OpenAI | null = null;
/** Lazily construct the OpenAI client (only when a key is present). */
export function getOpenAI(): OpenAI | null {
  if (!aiEnabled) return null;
  if (!client) client = new OpenAI({ apiKey: OPENAI_KEY });
  return client;
}

export type EnhanceStyle = "realistic" | "anime" | "painting" | "pixel" | "custom";

const ENHANCE_PROMPTS: Record<Exclude<EnhanceStyle, "custom">, string> = {
  realistic:
    "Make this character portrait photorealistic. Keep all elements: hat, accessories, bowl. Improve lighting, shadows, and make the positioning natural and believable. Cinematic portrait photography style.",
  anime:
    "Convert this to anime/manga art style. Keep all character elements and accessories. Clean lines, expressive eyes, vibrant colors.",
  painting:
    "Transform into a traditional Asian watercolor painting. Keep the character elements. Soft brushstrokes, warm colors, artistic.",
  pixel:
    "Convert to pixel art style, 32x32 grid aesthetic. Keep character recognizable. Game sprite feel.",
};

export function buildEnhancePrompt(style: EnhanceStyle, customPrompt?: string): string {
  if (style === "custom") return (customPrompt ?? "").trim();
  return ENHANCE_PROMPTS[style];
}

// ── Art generator prompt construction ────────────────────────────────────────
const ART_STYLE_PROMPTS: Record<string, string> = {
  "sacred-grain":
    "Cosmic, spiritual composition with a DNA-helix motif and divine light.",
  "paddy-fields":
    "Aerial rice-field photography aesthetic, terraced paddies, golden hour.",
  "degen-rice":
    "Chaotic meme energy, bold saturated colors, internet-degenerate vibe.",
  "ancient-scroll":
    "Aged parchment with ink-brush art and traditional calligraphic flourishes.",
  "neon-rice":
    "Cyberpunk neon, glowing grains against a dark moody background.",
};

const COLOR_PALETTES: Record<string, string> = {
  golden: "warm golds and amber",
  midnight: "deep blues and silvers",
  crimson: "crimson red and black",
  jade: "jade greens and gold",
  custom: "a custom color palette",
};

export function buildArtPrompt(opts: {
  style: string;
  grainStyle: string;
  colorPalette: string;
  customPrompt?: string;
}): string {
  const stylePrompt =
    opts.style === "custom"
      ? (opts.customPrompt ?? "").trim()
      : ART_STYLE_PROMPTS[opts.style] ?? "";
  const palette = COLOR_PALETTES[opts.colorPalette] ?? opts.colorPalette;
  const grain = opts.grainStyle || "white rice";
  return [
    `A ${opts.style.replace(/-/g, " ")} artistic image featuring ${grain} rice grains`,
    `in a ${palette} color palette.`,
    stylePrompt,
    "Suitable for a crypto project profile picture. High quality digital art.",
  ]
    .filter(Boolean)
    .join(" ");
}

export const PFP_BASE_PROMPT =
  "Render this character as a high-quality, realistic profile picture for the $RICE rice-farming crypto project. " +
  "Keep every element from the composition — the character/photo, hats, rice bowls, and any accessories — but place, " +
  "scale and angle them naturally and believably for one cohesive portrait. Extend and complete the scene with a full, " +
  "immersive background that fits a golden, mystical rice-harvest theme — fill the ENTIRE frame edge to edge with no " +
  "empty, flat or transparent areas (generative fill). Cinematic lighting, rich detail, cohesive art direction, 1:1 square.";

// dall-e-3 supports 1024x1024, 1024x1792 (portrait), 1792x1024 (landscape).
// gpt-image-1 uses 1536×1024 / 1024×1536.
export type ImgSize =
  | "1024x1024"
  | "1024x1792"
  | "1792x1024"
  | "1536x1024"
  | "1024x1536";

export function mapSize(size: string, model: string): ImgSize {
  const gpt = model.startsWith("gpt-image");
  if (size === "16:9") return gpt ? "1536x1024" : "1792x1024";
  if (size === "4:5") return gpt ? "1024x1536" : "1024x1792";
  return "1024x1024";
}

function stripDataUrl(b64: string): string {
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + "base64,".length) : b64;
}

// Normalize an OpenAI image response to a data URL. gpt-image-1 returns
// b64_json; dall-e returns a temporary URL which we download and inline so
// callers always get a persistent data URL.
async function resultToDataUrl(result: {
  data?: Array<{ b64_json?: string | null; url?: string | null }> | null;
}): Promise<string> {
  const item = result.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) {
    const resp = await fetch(item.url);
    if (!resp.ok) throw new Error(`Failed to download generated image (${resp.status})`);
    const buf = Buffer.from(await resp.arrayBuffer());
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  throw new Error("No image returned from OpenAI");
}

export async function editImage(
  model: string,
  imageBase64: string,
  prompt: string,
  size: string = "1024x1024",
): Promise<string> {
  const openai = getOpenAI();
  if (!openai) throw new Error("AI is not configured");
  const buffer = Buffer.from(stripDataUrl(imageBase64), "base64");
  const image = await OpenAI.toFile(buffer, "pfp.png", { type: "image/png" });
  const result = await openai.images.edit({
    model,
    image,
    prompt,
    n: 1,
    size: size as OpenAI.Images.ImageEditParams["size"],
  });
  return resultToDataUrl(result);
}

export async function generateImage(model: string, prompt: string, size: ImgSize): Promise<string> {
  const openai = getOpenAI();
  if (!openai) throw new Error("AI is not configured");
  const result = await openai.images.generate({ model, prompt, n: 1, size });
  return resultToDataUrl(result);
}
