// Server-only PFP AI helper: the OpenAI client and the two calls that reach it.
// The key is read here from process.env and NEVER shipped to the browser — do
// NOT import this from a client component.
//
// Prompts deliberately live elsewhere (lib/pfp/prompts), because the browser
// needs the look list to render the picker and must not pull `openai` in to
// get it.

import OpenAI from "openai";

export const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
export const aiEnabled = !!OPENAI_KEY;

// The image model. There used to be three env knobs (PFP_EDIT_MODEL /
// PFP_GEN_MODEL / PFP_PFP_MODEL) for three endpoints that all defaulted to
// gpt-image-1; there is one process now, so there is one knob. PFP_PFP_MODEL is
// still honoured so an existing deployment's setting keeps working.
export const PFP_PFP_MODEL =
  process.env.PFP_MODEL ?? process.env.PFP_PFP_MODEL ?? "gpt-image-1";

let client: OpenAI | null = null;
/** Lazily construct the OpenAI client (only when a key is present). */
export function getOpenAI(): OpenAI | null {
  if (!aiEnabled) return null;
  if (!client) client = new OpenAI({ apiKey: OPENAI_KEY });
  return client;
}

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

/**
 * The formats the images API accepts as an edit reference, and the filename
 * extension each has to arrive with.
 *
 * This used to be a hardcoded `image/png`, which was true only because the
 * browser always sent PNG. It no longer always does: the client falls back to
 * JPEG when a PNG will not fit under the upload ceiling (see
 * `components/pfp/imaging.ts`), and mislabelling a JPEG as PNG is rejected on
 * the far side. Read the type the bytes actually have.
 */
const UPLOAD_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function typeFromDataUrl(dataUrl: string): { mime: string; ext: string } {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(dataUrl);
  const mime = match?.[1]?.toLowerCase() ?? "";
  const ext = UPLOAD_TYPES[mime];
  // A bare base64 string with no data-URL prefix is PNG by the old convention,
  // and an unrecognised type is more likely to be a mislabelled PNG than
  // something the API can use — either way, the previous behaviour.
  return ext ? { mime, ext } : { mime: "image/png", ext: "png" };
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
  const { mime, ext } = typeFromDataUrl(imageBase64);
  const image = await OpenAI.toFile(buffer, `pfp.${ext}`, { type: mime });
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
