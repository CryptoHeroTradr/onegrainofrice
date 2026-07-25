import { NextResponse } from "next/server";
import {
  getOpenAI,
  buildEnhancePrompt,
  editImage,
  PFP_EDIT_MODEL,
  type EnhanceStyle,
} from "@/lib/pfp/openai";

// POST /api/pfp/enhance — AI image edit over a flattened PFP composition.
// Reimplements RiceDAO's Express endpoint as a Next route handler: the OpenAI
// key is read server-side only. Disabled gracefully (503) with no key.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!getOpenAI()) {
    return NextResponse.json(
      { error: "AI enhancement requires an OpenAI API key. Add OPENAI_API_KEY to server config." },
      { status: 503 },
    );
  }

  let body: {
    imageBase64?: string;
    customPrompt?: string;
    style?: EnhanceStyle;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { imageBase64, customPrompt, style } = body;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
  }
  const styleKey: EnhanceStyle = style ?? "realistic";
  const prompt = buildEnhancePrompt(styleKey, customPrompt);
  if (!prompt) {
    return NextResponse.json({ error: "A prompt is required for custom style" }, { status: 400 });
  }

  try {
    const dataUrl = await editImage(PFP_EDIT_MODEL, imageBase64, prompt);
    return NextResponse.json({ imageUrl: dataUrl, imageBase64: dataUrl, id: null, saved: false });
  } catch (err) {
    const message = (err as Error).message || "AI enhancement failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
