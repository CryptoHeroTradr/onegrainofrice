// The PFP generator's prompt vocabulary — the ONE place a look is defined.
//
// This used to be three separate features with three prompt tables, three
// endpoints and three UIs: "AI Enhance" (restyle the portrait), the "Rice Art
// Generator" (text-to-image rice art), and "Generate New PFP" (full re-render
// with generative fill). They are now one Generate process, so their prompts
// are one table and the difference between them is a `look` the user picks.
//
// Deliberately free of any server import (no `openai`), so the browser can read
// the look list for the picker while the route handler builds the final prompt.

export type LookGroup = "portrait" | "art";

export interface Look {
  id: string;
  label: string;
  emoji: string;
  /** One-line description shown under the label in the picker. */
  hint: string;
  group: LookGroup;
  /** The instruction sent to the model. Empty for `custom` — the user writes it. */
  prompt: string;
}

/**
 * Portrait looks act on what you composed; art looks reimagine it. The first
 * entry is the default, and is the old "Generate New PFP" behaviour verbatim.
 */
export const LOOKS: Look[] = [
  {
    id: "rice-pfp",
    label: "Rice PFP",
    emoji: "🌾",
    hint: "full re-render, generative-fill background",
    group: "portrait",
    prompt:
      "Render this character as a high-quality, realistic profile picture for the $RICE rice-farming crypto project. " +
      "Keep every element from the composition — the character/photo, hats, rice bowls, and any accessories — but place, " +
      "scale and angle them naturally and believably for one cohesive portrait. Extend and complete the scene with a full, " +
      "immersive background that fits a golden, mystical rice-harvest theme — fill the ENTIRE frame edge to edge with no " +
      "empty, flat or transparent areas (generative fill). Cinematic lighting, rich detail, cohesive art direction, 1:1 square.",
  },
  {
    id: "realistic",
    label: "Realistic",
    emoji: "📷",
    hint: "photoreal, cinematic lighting",
    group: "portrait",
    prompt:
      "Make this character portrait photorealistic. Keep all elements: hat, accessories, bowl. Improve lighting, shadows, and make the positioning natural and believable. Cinematic portrait photography style.",
  },
  {
    id: "anime",
    label: "Anime",
    emoji: "🎌",
    hint: "clean lines, vibrant colour",
    group: "portrait",
    prompt:
      "Convert this to anime/manga art style. Keep all character elements and accessories. Clean lines, expressive eyes, vibrant colors.",
  },
  {
    id: "painting",
    label: "Painting",
    emoji: "🎨",
    hint: "Asian watercolour, soft brush",
    group: "portrait",
    prompt:
      "Transform into a traditional Asian watercolor painting. Keep the character elements. Soft brushstrokes, warm colors, artistic.",
  },
  {
    id: "pixel",
    label: "Pixel Art",
    emoji: "👾",
    hint: "32×32 game-sprite feel",
    group: "portrait",
    prompt:
      "Convert to pixel art style, 32x32 grid aesthetic. Keep character recognizable. Game sprite feel.",
  },
  {
    id: "sacred-grain",
    label: "Sacred Grain",
    emoji: "✨",
    hint: "cosmic, spiritual, DNA helix",
    group: "art",
    prompt:
      "A sacred grain artistic image featuring white rice grains in warm golds and amber. Cosmic, spiritual composition with a DNA-helix motif and divine light. Suitable for a crypto project profile picture. High quality digital art.",
  },
  {
    id: "paddy-fields",
    label: "Paddy Fields",
    emoji: "🌅",
    hint: "aerial rice fields, golden hour",
    group: "art",
    prompt:
      "A paddy fields artistic image featuring white rice grains in warm golds and amber. Aerial rice-field photography aesthetic, terraced paddies, golden hour. Suitable for a crypto project profile picture. High quality digital art.",
  },
  {
    id: "degen-rice",
    label: "Degen Rice",
    emoji: "🚀",
    hint: "meme energy, bold saturated colour",
    group: "art",
    prompt:
      "A degen rice artistic image featuring white rice grains in bold saturated colors. Chaotic meme energy, internet-degenerate vibe. Suitable for a crypto project profile picture. High quality digital art.",
  },
  {
    id: "ancient-scroll",
    label: "Ancient Scroll",
    emoji: "📜",
    hint: "parchment, ink brush, calligraphy",
    group: "art",
    prompt:
      "An ancient scroll artistic image featuring white rice grains in aged parchment tones. Ink-brush art with traditional calligraphic flourishes. Suitable for a crypto project profile picture. High quality digital art.",
  },
  {
    id: "neon-rice",
    label: "Neon Rice",
    emoji: "🌃",
    hint: "cyberpunk neon on dark",
    group: "art",
    prompt:
      "A neon rice artistic image featuring glowing rice grains in cyberpunk neon against a dark moody background. Suitable for a crypto project profile picture. High quality digital art.",
  },
  {
    id: "custom",
    label: "Custom",
    emoji: "✏️",
    hint: "your prompt, nothing else",
    group: "portrait",
    prompt: "",
  },
];

export const DEFAULT_LOOK = LOOKS[0]!.id;

export function findLook(id: string | undefined): Look {
  return LOOKS.find((l) => l.id === id) ?? LOOKS[0]!;
}

/**
 * The one-shot prompt for the simplified generator on /home. That page offers a
 * photo and a few words — everything else is fixed, so the instruction lives
 * here on the server side and the browser cannot vary it.
 */
export const SIMPLE_PROMPT =
  "add a rice farmer hat and add a bowl of white steamy rice in characters hand. " +
  "Keep the same style of art the uploaded image has. Change nothing else";

/**
 * The final instruction sent to the model.
 *
 * `hasReference` matters only for art looks: with a composition to work from
 * they reimagine it rather than inventing a scene, which is what the old Rice
 * Art Generator did when the canvas was not empty.
 */
export function buildGeneratePrompt(opts: {
  look?: string;
  prompt?: string;
  hasReference: boolean;
}): string {
  const look = findLook(opts.look);
  const extra = (opts.prompt ?? "").trim();

  if (look.id === "custom") return extra;

  const base =
    look.group === "art" && opts.hasReference
      ? `Reimagine the subject and elements from the provided reference image as: ${look.prompt} ` +
        "Keep the main subject clearly recognizable and fill the entire frame."
      : look.prompt;

  return extra ? `${base} ${extra}` : base;
}
