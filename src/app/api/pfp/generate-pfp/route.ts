import { NextResponse } from "next/server";
import { getOpenAI, editImage, PFP_PFP_MODEL, PFP_BASE_PROMPT } from "@/lib/pfp/openai";

// POST /api/pfp/generate-pfp — full realistic re-render + generative-fill of the
// flattened composition (the "Generate New PFP" modal in LayerComposer).
// Reimplements RiceDAO's Express endpoint; OpenAI key is server-side only.
// onegrainofrice has no wallet/DB, so generations are returned but not persisted
// (the client's per-wallet history is skipped when no wallet is connected).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!getOpenAI()) {
    return NextResponse.json(
      { error: "PFP generation requires an OpenAI API key. Add OPENAI_API_KEY to server config." },
      { status: 503 },
    );
  }

  let body: { imageBase64?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { imageBase64, prompt } = body;
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json(
      { error: "imageBase64 (the flattened composition) is required" },
      { status: 400 },
    );
  }

  const extra = (prompt ?? "").trim();
  const fullPrompt = extra ? `${PFP_BASE_PROMPT} ${extra}` : PFP_BASE_PROMPT;

  try {
    const dataUrl = await editImage(PFP_PFP_MODEL, imageBase64, fullPrompt);
    return NextResponse.json({
      id: null,
      image: dataUrl,
      prompt: extra,
      createdAt: new Date().toISOString(),
      saved: false,
    });
  } catch (err) {
    const message = (err as Error).message || "PFP generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
