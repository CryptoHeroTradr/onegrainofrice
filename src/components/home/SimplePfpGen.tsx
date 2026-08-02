"use client";

/**
 * The one-shot PFP/meme generator on /home.
 *
 * Two inputs — a photo and a few words — and one button. Everything the full
 * studio at /pfp offers (layers, looks, canvas size, masks) is deliberately
 * absent; the instruction is fixed server-side, so this page always does the
 * same thing: rice hat on, steaming bowl in hand, art style untouched.
 *
 * It posts to the SAME endpoint as the full generator (/api/pfp/generate) with
 * `mode: "simple"`, so both go through one process and one OpenAI call path.
 */

import { useRef, useState } from "react";
import { GAME_API } from "@/components/landing/ui";
import { downloadUrl, fileToPngDataUrl } from "@/components/pfp/imaging";

export function SimplePfpGen() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      // Re-encoded to PNG here, not on the server — see fileToPngDataUrl.
      setPhoto(await fileToPngDataUrl(file));
      setResult(null);
    } catch {
      setError("Could not read that image. Try a PNG, JPEG or WebP.");
    }
  };

  const generate = async () => {
    if (!photo) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${GAME_API}/api/pfp/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: photo, prompt: prompt.trim(), mode: "simple" }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Generation failed.");
      else setResult(data.image);
    } catch (err) {
      setError((err as Error).message || "Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto mt-8 w-full max-w-xl border-2 border-nori/15 bg-white/60 p-5 text-left sm:p-6">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />

      <div className="grid grid-cols-2 gap-3">
        <Frame label="Your photo">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="Uploaded" className="h-full w-full object-contain" />
          ) : (
            <span className="px-2 text-center font-mono text-xs text-nori/50">
              No photo yet
            </span>
          )}
        </Frame>
        <Frame label="Result">
          {loading ? (
            <span className="px-2 text-center font-mono text-xs text-nori/60">
              🌾 Generating… ~10–20s
            </span>
          ) : result ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result} alt="Generated PFP" className="h-full w-full object-contain" />
          ) : (
            <span className="px-2 text-center font-mono text-xs text-nori/50">
              Rice hat &amp; bowl go here
            </span>
          )}
        </Frame>
      </div>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center border-2 border-nori/25 bg-white/70 px-5 font-mono text-sm font-bold tracking-widest text-nori uppercase transition-colors hover:border-bamboo hover:text-bamboo"
      >
        ⬆ {photo ? "Change photo" : "Upload photo"}
      </button>

      <label
        htmlFor="simple-pfp-prompt"
        className="mt-4 block font-mono text-xs font-bold tracking-widest text-nori/70 uppercase"
      >
        Add a few words <span className="font-normal normal-case">(optional)</span>
      </label>
      <input
        id="simple-pfp-prompt"
        type="text"
        value={prompt}
        maxLength={120}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. sunset behind them, wearing sunglasses"
        className="mt-1.5 w-full border-2 border-nori/20 bg-white/80 px-3 py-2.5 font-mono text-sm text-nori placeholder:text-nori/40 focus-visible:border-bamboo focus-visible:outline-none"
      />

      {error && (
        <p className="mt-3 border-2 border-tuna/40 bg-tuna/10 px-3 py-2 font-mono text-xs text-tuna">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!photo || loading}
          className="inline-flex min-h-11 flex-1 items-center justify-center bg-bamboo px-6 font-display-round text-base font-bold text-steamed transition-transform hover:scale-105 disabled:cursor-default disabled:opacity-50 disabled:hover:scale-100"
        >
          {loading ? "Generating…" : result ? "🔁 Generate again" : "🌾 Generate"}
        </button>
        {result && (
          <button
            type="button"
            onClick={() => downloadUrl(result, "rice-pfp.png")}
            className="inline-flex min-h-11 items-center justify-center border-2 border-nori/25 px-5 font-mono text-sm font-bold tracking-widest text-nori uppercase transition-colors hover:border-bamboo hover:text-bamboo"
          >
            ⬇ Save
          </button>
        )}
      </div>
    </div>
  );
}

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[0.68rem] tracking-widest text-nori/50 uppercase">
        {label}
      </div>
      <div className="flex aspect-square items-center justify-center overflow-hidden border-2 border-nori/15 bg-white/70">
        {children}
      </div>
    </div>
  );
}
