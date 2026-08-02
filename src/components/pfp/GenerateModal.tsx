"use client";

// The one Generate modal.
//
// Replaces AiEnhanceModal ("AI Enhance"), RiceArtGenerator ("Rice Art
// Generator") and GeneratePfpModal ("Generate New PFP") — three buttons, three
// panels and three endpoints that all flattened the canvas and asked an image
// model for a picture. What actually differed between them was the prompt, so
// that is now a LOOK you pick here, and everything else is one process:
// flatten → POST /api/pfp/generate → keep it, drop it on the canvas, or save it.

import { useCallback, useEffect, useState } from "react";
import { C, SERIF, GAME_API } from "@/components/landing/ui";
import { LOOKS, DEFAULT_LOOK, findLook } from "@/lib/pfp/prompts";
import { downloadUrl } from "./imaging";

const SIZES: { key: string; label: string }[] = [
  { key: "1:1", label: "1:1 Square" },
  { key: "4:5", label: "4:5 Portrait" },
  { key: "16:9", label: "16:9 Landscape" },
];

interface Result {
  image: string;
  prompt: string;
  createdAt: string;
}

export function GenerateModal({
  source,
  onClose,
  onAddLayer,
}: {
  /** Flattened composition (PNG data URL). Empty canvas → generated from the prompt alone. */
  source: string;
  onClose: () => void;
  /** Drop the result onto the composer canvas as an editable layer. */
  onAddLayer: (dataUrl: string) => void;
}) {
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [look, setLook] = useState(DEFAULT_LOOK);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1:1");
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Results from this session. The old modal advertised a wallet-attached
  // history, but the endpoints it read (/api/pfp/history) do not exist in this
  // app, so it was permanently empty. A session strip is what it can honestly be.
  const [session, setSession] = useState<Result[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${GAME_API}/api/pfp/status`)
      .then((r) => (r.ok ? r.json() : { aiEnabled: false }))
      .then((d) => !cancelled && setAiEnabled(!!d.aiEnabled))
      .catch(() => !cancelled && setAiEnabled(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape closes, like every other overlay on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const generate = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${GAME_API}/api/pfp/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: source, look, prompt: prompt.trim(), size }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed.");
      } else {
        const result: Result = {
          image: data.image,
          prompt: data.prompt,
          createdAt: data.createdAt,
        };
        setCurrent(result);
        setSession((s) => [result, ...s]);
      }
    } catch (err) {
      setError((err as Error).message || "Network error.");
    } finally {
      setLoading(false);
    }
  }, [source, look, prompt, size]);

  const activeLook = findLook(look);
  const needsPrompt = activeLook.id === "custom" && !prompt.trim();

  return (
    <div className="gen-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <GenStyles />
      <div className="gen-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="gen-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h3 style={{ color: C.gold, fontFamily: SERIF, fontSize: "1.5rem", margin: "0 0 0.25rem" }}>
          🌟 Generate
        </h3>
        <p style={{ color: C.muted, fontSize: "0.85rem", margin: "0 0 1rem" }}>
          Pick a look, add a prompt if you want to steer it, and generate. Your composition is the
          starting point — an empty canvas generates from the prompt alone.
        </p>

        {aiEnabled === false ? (
          <div className="gen-error">
            Generation requires an OpenAI API key. Add <code>OPENAI_API_KEY</code> to the server
            config and restart.
          </div>
        ) : (
          <div className="gen-grid">
            <div className="gen-main">
              <div className="gen-canvas">
                {loading ? (
                  <div className="gen-ph">🌾 Generating your grain… this can take ~10–20s</div>
                ) : current ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current.image} alt="Generated result" />
                ) : (
                  <div className="gen-ph">Your generated image will appear here</div>
                )}
              </div>

              {error && <div className="gen-error">{error}</div>}

              <div className="gen-actions">
                <button
                  type="button"
                  className="gen-btn gen-btn-gold"
                  disabled={loading || aiEnabled === null || needsPrompt}
                  onClick={generate}
                >
                  {loading ? "Generating…" : current ? "🔁 Regenerate" : "🌟 Generate"}
                </button>
                <button
                  type="button"
                  className="gen-btn"
                  disabled={!current}
                  onClick={() => current && onAddLayer(current.image)}
                >
                  ➕ Add to Canvas
                </button>
                <button
                  type="button"
                  className="gen-btn"
                  disabled={!current}
                  onClick={() => current && downloadUrl(current.image, "rice-pfp.png")}
                >
                  ⬇ Download
                </button>
              </div>

              {session.length > 1 && (
                <div className="gen-strip">
                  {session.map((r, i) => (
                    <button
                      key={`${r.createdAt}-${i}`}
                      type="button"
                      className="gen-thumb"
                      onClick={() => setCurrent(r)}
                      title={new Date(r.createdAt).toLocaleTimeString()}
                      style={current === r ? { borderColor: C.gold } : undefined}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.image} alt="Earlier result" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Look + prompt + size */}
            <div className="gen-side">
              <div className="gen-group-title">Look</div>
              <div className="gen-looks">
                {LOOKS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="gen-look"
                    onClick={() => setLook(l.id)}
                    style={
                      look === l.id
                        ? { borderColor: C.gold, background: "rgba(201,168,76,0.15)" }
                        : undefined
                    }
                  >
                    <span className="gen-look-emoji">{l.emoji}</span>
                    <span>
                      <strong>{l.label}</strong>
                      <small>{l.hint}</small>
                    </span>
                  </button>
                ))}
              </div>

              <label className="gen-label" htmlFor="gen-prompt">
                Prompt{" "}
                <span>{activeLook.id === "custom" ? "(required)" : "(optional — steers it)"}</span>
              </label>
              <textarea
                id="gen-prompt"
                className="gen-input"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. golden hour lighting, samurai armor, ancient temple courtyard…"
              />

              <div className="gen-group-title" style={{ marginTop: "0.9rem" }}>
                Size
              </div>
              <div className="gen-sizes">
                {SIZES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className="gen-btn gen-btn-sm"
                    onClick={() => setSize(s.key)}
                    style={
                      size === s.key
                        ? { background: C.gold, color: C.dark, borderColor: C.gold }
                        : undefined
                    }
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GenStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
        .gen-backdrop { position:fixed; inset:0; z-index:200; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; padding:1rem; }
        .gen-modal { position:relative; width:100%; max-width:900px; max-height:92vh; overflow-y:auto; background:${C.bg}; border:1px solid rgba(201,168,76,0.4); border-radius:16px; padding:1.5rem; }
        .gen-close { position:absolute; top:0.75rem; right:0.75rem; background:transparent; border:none; color:${C.gold}; font-size:1.1rem; cursor:pointer; }
        .gen-grid { display:grid; grid-template-columns: 1fr 280px; gap:1.25rem; align-items:start; }
        .gen-canvas { width:100%; aspect-ratio:1/1; border:1px solid rgba(201,168,76,0.4); border-radius:12px; overflow:hidden; background:${C.dark}; display:flex; align-items:center; justify-content:center; }
        .gen-canvas img { width:100%; height:100%; object-fit:contain; }
        .gen-ph { color:${C.muted}; font-size:0.9rem; text-align:center; padding:1rem; }
        .gen-actions { display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.75rem; }
        .gen-btn { background:rgba(26,15,10,0.8); color:${C.white}; border:1px solid rgba(201,168,76,0.4); border-radius:8px; padding:0.55rem 0.9rem; font-size:0.82rem; cursor:pointer; }
        .gen-btn:hover:not(:disabled) { border-color:${C.gold}; color:${C.gold}; }
        .gen-btn:disabled { opacity:0.5; cursor:default; }
        .gen-btn-gold { background:${C.gold}; color:${C.dark}; border-color:${C.gold}; font-weight:600; }
        .gen-btn-gold:hover:not(:disabled) { color:${C.dark}; }
        .gen-btn-sm { padding:0.35rem 0.6rem; font-size:0.75rem; }
        .gen-strip { display:flex; gap:0.4rem; margin-top:0.75rem; overflow-x:auto; padding-bottom:0.25rem; }
        .gen-thumb { flex:0 0 auto; width:56px; height:56px; padding:0; border:1px solid rgba(201,168,76,0.3); border-radius:8px; overflow:hidden; background:${C.dark}; cursor:pointer; }
        .gen-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
        .gen-side { border:1px solid rgba(201,168,76,0.2); border-radius:12px; padding:0.85rem; background:rgba(10,8,5,0.5); }
        .gen-group-title { color:${C.gold}; font-family:${SERIF}; font-size:0.9rem; margin-bottom:0.5rem; }
        .gen-looks { display:flex; flex-direction:column; gap:0.3rem; max-height:260px; overflow-y:auto; }
        .gen-look { display:flex; align-items:center; gap:0.55rem; text-align:left; background:rgba(26,15,10,0.6); border:1px solid rgba(201,168,76,0.25); border-radius:8px; padding:0.45rem 0.55rem; cursor:pointer; color:${C.white}; }
        .gen-look:hover { border-color:${C.gold}; }
        .gen-look-emoji { font-size:1.1rem; line-height:1; }
        .gen-look strong { display:block; font-size:0.8rem; font-weight:600; }
        .gen-look small { display:block; color:${C.muted}; font-size:0.68rem; line-height:1.3; }
        .gen-label { display:block; margin-top:0.85rem; margin-bottom:0.3rem; color:${C.gold}; font-size:0.82rem; font-weight:600; }
        .gen-label span { color:${C.muted}; font-weight:400; }
        .gen-input { width:100%; background:rgba(0,0,0,0.35); border:1px solid rgba(201,168,76,0.35); border-radius:8px; color:${C.white}; padding:0.6rem; font-size:0.85rem; resize:vertical; font-family:system-ui,sans-serif; }
        .gen-sizes { display:flex; flex-wrap:wrap; gap:0.35rem; }
        .gen-error { color:${C.white}; background:rgba(178,58,58,0.15); border:1px solid rgba(178,58,58,0.5); border-radius:10px; padding:0.75rem 0.9rem; font-size:0.82rem; margin-top:0.75rem; }
        @media (max-width: 780px) { .gen-grid { grid-template-columns:1fr; } .gen-looks { max-height:none; } }
      `,
      }}
    />
  );
}
