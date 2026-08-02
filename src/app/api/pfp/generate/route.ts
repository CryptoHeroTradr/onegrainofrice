import { NextResponse } from "next/server";
import { getOpenAI, editImage, generateImage, mapSize, PFP_PFP_MODEL } from "@/lib/pfp/openai";
import { buildGeneratePrompt, SIMPLE_PROMPT } from "@/lib/pfp/prompts";

/**
 * POST /api/pfp/generate — the ONE generate process.
 *
 * It replaces /enhance, /generate-art and /generate-pfp, which were three
 * endpoints doing the same two model calls with different prompt tables. The
 * prompt table is now `lib/pfp/prompts`, the look is a parameter, and the only
 * real branch left is the honest one: with an image to work from this is an
 * edit, without one it is a generation.
 *
 * `mode: "simple"` is the /home generator. It ignores `look` and pins the
 * instruction to SIMPLE_PROMPT server-side, so that page cannot be turned into
 * an open-ended image endpoint by editing the request.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A flattened-but-empty canvas is a few hundred bytes; real content is far larger. */
const MIN_REFERENCE_BYTES = 5000;

/**
 * Is there something to work FROM?
 *
 * The studio flattens its canvas on every generate, so an untouched canvas still
 * arrives as a perfectly valid PNG — size is the only thing separating it from
 * real work, hence the threshold. /home has no canvas: a photo was attached or
 * it wasn't, and a flat or tiny image is still the photo the user chose. Judging
 * it by byte count there would reject the upload as "no photo".
 */
function hasReferenceImage(imageBase64: unknown, mode: string): imageBase64 is string {
  if (typeof imageBase64 !== "string" || imageBase64.length === 0) return false;
  return mode === "simple" || imageBase64.length > MIN_REFERENCE_BYTES;
}

export async function POST(req: Request) {
  if (!getOpenAI()) {
    return NextResponse.json(
      { error: "Image generation requires an OpenAI API key. Add OPENAI_API_KEY to server config." },
      { status: 503 },
    );
  }

  let body: {
    imageBase64?: string;
    look?: string;
    prompt?: string;
    size?: string;
    mode?: "full" | "simple";
  };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { imageBase64, look, prompt, size = "1:1", mode = "full" } = body;
  const hasReference = hasReferenceImage(imageBase64, mode);

  if (mode === "simple" && !hasReference) {
    return NextResponse.json({ error: "Upload a photo first." }, { status: 400 });
  }

  const extra = (prompt ?? "").trim();
  const fullPrompt =
    mode === "simple"
      ? extra
        ? `${SIMPLE_PROMPT}. ${extra}`
        : SIMPLE_PROMPT
      : buildGeneratePrompt({ look, prompt: extra, hasReference });

  if (!fullPrompt) {
    return NextResponse.json(
      { error: "Write a prompt, or pick a look other than Custom." },
      { status: 400 },
    );
  }

  try {
    const image = hasReference
      ? await editImage(
          PFP_PFP_MODEL,
          imageBase64 as string,
          fullPrompt,
          mapSize(size, PFP_PFP_MODEL),
        )
      : await generateImage(PFP_PFP_MODEL, fullPrompt, mapSize(size, PFP_PFP_MODEL));

    return NextResponse.json({
      image,
      prompt: fullPrompt,
      look: mode === "simple" ? "simple" : (look ?? null),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = (err as Error).message || "Generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
