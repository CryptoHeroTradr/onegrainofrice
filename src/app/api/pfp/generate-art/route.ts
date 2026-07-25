import { NextResponse } from "next/server";
import {
  getOpenAI,
  buildArtPrompt,
  editImage,
  generateImage,
  mapSize,
  PFP_GEN_MODEL,
} from "@/lib/pfp/openai";

// POST /api/pfp/generate-art — text-to-image (or img2img over the composition).
// Reimplements RiceDAO's Express endpoint; OpenAI key is server-side only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!getOpenAI()) {
    return NextResponse.json(
      { error: "AI art generation requires an OpenAI API key. Add OPENAI_API_KEY to server config." },
      { status: 503 },
    );
  }

  let body: {
    style?: string;
    grainStyle?: string;
    colorPalette?: string;
    customPrompt?: string;
    size?: string;
    imageBase64?: string; // flattened composition — used as a reference
  };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    style = "sacred-grain",
    grainStyle = "white rice",
    colorPalette = "golden",
    customPrompt,
    size = "1:1",
    imageBase64,
  } = body;

  const prompt = buildArtPrompt({ style, grainStyle, colorPalette, customPrompt });
  if (!prompt) {
    return NextResponse.json({ error: "A prompt is required" }, { status: 400 });
  }

  // Has the user composed anything? A flattened canvas with real content is
  // larger than a tiny empty/transparent PNG — only then use it as a reference.
  const hasReference = typeof imageBase64 === "string" && imageBase64.length > 5000;

  try {
    const dataUrl = hasReference
      ? await editImage(
          PFP_GEN_MODEL,
          imageBase64 as string,
          `Reimagine the subject and elements from the provided reference image as ${prompt} ` +
            `Keep the main subject clearly recognizable and fill the entire frame.`,
          mapSize(size, PFP_GEN_MODEL),
        )
      : await generateImage(PFP_GEN_MODEL, prompt, mapSize(size, PFP_GEN_MODEL));
    return NextResponse.json({ imageUrl: dataUrl, imageBase64: dataUrl, prompt, id: null, saved: false });
  } catch (err) {
    const message = (err as Error).message || "AI art generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
