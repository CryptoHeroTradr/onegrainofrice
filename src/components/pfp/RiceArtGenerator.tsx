"use client";

// Rice Art Generator panel — text-to-image generation via /api/pfp/generate-art
// (DALL·E 3). Style / palette / grain / size selectors build the prompt; the
// result can be downloaded, regenerated, refined, or added to the main Layer
// Composer canvas as an editable layer. Each generation saves the current layer
// layout + image to the connected wallet's history.

import { useEffect, useState } from "react";
import { C, SERIF, GAME_API } from "@/components/landing/ui";
import { downloadUrl } from "./imaging";

const STYLES: { key: string; label: string; hint: string }[] = [
  { key: "sacred-grain", label: "Sacred Grain", hint: "cosmic, spiritual, DNA helix" },
  { key: "paddy-fields", label: "Paddy Fields", hint: "aerial rice-field photography" },
  { key: "degen-rice", label: "Degen Rice", hint: "chaotic meme energy, bold colors" },
  { key: "ancient-scroll", label: "Ancient Scroll", hint: "parchment, ink art, traditional" },
  { key: "neon-rice", label: "Neon Rice", hint: "cyberpunk, glowing grains, dark" },
  { key: "custom", label: "Custom", hint: "your own prompt" },
];

const PALETTES: { key: string; label: string; colors: string[] }[] = [
  { key: "golden", label: "Golden", colors: ["#E7CC78", "#9C7E2E"] },
  { key: "midnight", label: "Midnight", colors: ["#3A6EA5", "#BFC3CC"] },
  { key: "crimson", label: "Crimson", colors: ["#B23A3A", "#0A0805"] },
  { key: "jade", label: "Jade", colors: ["#2E8B57", "#C9A84C"] },
  { key: "custom", label: "Custom", colors: ["#C9A84C", "#F5F0E8"] },
];

const GRAINS = [
  "White Rice",
  "Brown Rice",
  "Black Rice",
  "Golden Grain",
  "Crystal",
  "Glowing",
];

const SIZES: { key: string; label: string }[] = [
  { key: "1:1", label: "1:1 Square" },
  { key: "4:5", label: "4:5 Portrait" },
  { key: "16:9", label: "16:9 Landscape" },
];

export function RiceArtGenerator({
  onAddImage,
  getLayers,
  getSource,
  walletAddress = null,
}: {
  /** Add the generated art to the main composer canvas as an editable layer. */
  onAddImage?: (src: string) => void;
  /** Snapshot of the current composer layout (saved with each generation). */
  getLayers?: () => unknown[];
  /** Flattened composer composition (used as the AI reference image). */
  getSource?: () => string;
  walletAddress?: string | null;
}) {
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [style, setStyle] = useState("sacred-grain");
  const [customPrompt, setCustomPrompt] = useState("");
  const [palette, setPalette] = useState("golden");
  const [customColor, setCustomColor] = useState("#C9A84C");
  const [grain, setGrain] = useState("White Rice");
  const [size, setSize] = useState("1:1");
  const [refine, setRefine] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const generate = async (extra?: string) => {
    setError(null);
    setLoading(true);
    try {
      const cp = [
        style === "custom" ? customPrompt : "",
        palette === "custom" ? `Use colors around ${customColor}.` : "",
        extra || "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      const res = await fetch(`${GAME_API}/api/pfp/generate-art`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style,
          grainStyle: grain,
          colorPalette: palette,
          customPrompt: cp || undefined,
          size,
          walletAddress: walletAddress || undefined,
          layers: getLayers ? getLayers() : [],
          // Use the current composition as a reference so the rice art is built
          // FROM the layer-editor scene (img2img), not generated from scratch.
          imageBase64: getSource ? getSource() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Generation failed.");
      else setResult(data.imageBase64 || data.imageUrl);
    } catch (err) {
      setError((err as Error).message || "Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rag">
      <GeneratorStyles />

      {aiEnabled === false && (
        <div className="rag-disabled">
          AI art generation requires an OpenAI API key. Add <code>OPENAI_API_KEY</code> to the server
          config (apps/server/.env) and restart the server.
        </div>
      )}

      <div className="rag-grid">
        {/* Controls */}
        <div className="rag-controls">
          <Group title="Style">
            <div className="rag-cards">
              {STYLES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="rag-card"
                  onClick={() => setStyle(s.key)}
                  style={sel(style === s.key)}
                >
                  <strong>{s.label}</strong>
                  <small>{s.hint}</small>
                </button>
              ))}
            </div>
            {style === "custom" && (
              <textarea
                className="rag-input"
                rows={2}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Describe the rice art you want…"
              />
            )}
          </Group>

          <Group title="Color Palette">
            <div className="rag-palettes">
              {PALETTES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="rag-palette"
                  onClick={() => setPalette(p.key)}
                  style={sel(palette === p.key)}
                  title={p.label}
                >
                  <span
                    className="rag-swatch"
                    style={{ background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})` }}
                  />
                  {p.label}
                </button>
              ))}
            </div>
            {palette === "custom" && (
              <input
                type="color"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                className="rag-color"
              />
            )}
          </Group>

          <Group title="Grain Style">
            <div className="rag-chips">
              {GRAINS.map((g) => (
                <button key={g} type="button" className="rag-chip" onClick={() => setGrain(g)} style={sel(grain === g)}>
                  {g}
                </button>
              ))}
            </div>
          </Group>

          <Group title="Size">
            <div className="rag-chips">
              {SIZES.map((s) => (
                <button key={s.key} type="button" className="rag-chip" onClick={() => setSize(s.key)} style={sel(size === s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </Group>

          <button
            type="button"
            className="rag-generate"
            onClick={() => generate()}
            disabled={loading || aiEnabled === null || (style === "custom" && !customPrompt.trim())}
          >
            {loading ? "🌾 Generating your grain art…" : "🚀 Generate"}
          </button>
        </div>

        {/* Result */}
        <div className="rag-result">
          <div className="rag-canvas">
            {loading ? (
              <div className="rag-placeholder">🌾 Painting…</div>
            ) : result ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result} alt="Generated rice art" />
            ) : (
              <div className="rag-placeholder">Your generated art appears here</div>
            )}
          </div>

          {error && <div className="rag-error">{error}</div>}

          {result && !loading && (
            <>
              <div className="rag-actions">
                <button type="button" className="rag-btn" onClick={() => downloadUrl(result, "rice-art.png")}>
                  ⬇ Download
                </button>
                <button type="button" className="rag-btn" onClick={() => generate()}>
                  🔄 Regenerate
                </button>
              </div>
              {onAddImage && (
                <button
                  type="button"
                  className="rag-btn rag-btn-gold"
                  onClick={() => onAddImage(result)}
                  title="Add this image to the composer canvas as an editable layer"
                >
                  ➕ Add to Composer Canvas
                </button>
              )}
              <div className="rag-refine">
                <input
                  type="text"
                  className="rag-input"
                  value={refine}
                  onChange={(e) => setRefine(e.target.value)}
                  placeholder="✨ Refine: add details, change mood…"
                />
                <button
                  type="button"
                  className="rag-btn"
                  onClick={() => refine.trim() && generate(refine)}
                  disabled={!refine.trim()}
                >
                  Refine
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function sel(active: boolean) {
  return {
    borderColor: active ? C.gold : "rgba(201,168,76,0.25)",
    background: active ? "rgba(201,168,76,0.15)" : "rgba(26,15,10,0.6)",
    color: active ? C.gold : C.white,
  } as const;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rag-group">
      <div className="rag-group-title">{title}</div>
      {children}
    </div>
  );
}

function GeneratorStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
        .rag-disabled, .rag-error {
          color:${C.white}; background:rgba(178,58,58,0.15); border:1px solid rgba(178,58,58,0.5);
          border-radius:10px; padding:0.85rem 1rem; font-size:0.85rem; margin-bottom:1rem; line-height:1.5;
        }
        .rag-error { margin:0.75rem 0 0; }
        .rag-grid { display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; align-items:start; }
        .rag-group { margin-bottom:1.1rem; }
        .rag-group-title { color:${C.gold}; font-family:${SERIF}; font-size:0.95rem; margin-bottom:0.5rem; }
        .rag-cards { display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; }
        .rag-card {
          display:flex; flex-direction:column; gap:0.15rem; text-align:left;
          border:1px solid rgba(201,168,76,0.25); border-radius:10px; padding:0.55rem 0.7rem; cursor:pointer;
        }
        .rag-card strong { font-size:0.85rem; }
        .rag-card small { color:${C.muted}; font-size:0.68rem; }
        .rag-palettes { display:flex; flex-wrap:wrap; gap:0.5rem; }
        .rag-palette {
          display:flex; align-items:center; gap:0.4rem; border:1px solid rgba(201,168,76,0.25);
          border-radius:999px; padding:0.35rem 0.7rem; font-size:0.8rem; cursor:pointer;
        }
        .rag-swatch { width:16px; height:16px; border-radius:50%; display:inline-block; }
        .rag-color { width:48px; height:32px; margin-top:0.5rem; background:transparent; border:none; cursor:pointer; }
        .rag-chips { display:flex; flex-wrap:wrap; gap:0.4rem; }
        .rag-chip {
          border:1px solid rgba(201,168,76,0.25); border-radius:999px; padding:0.35rem 0.8rem;
          font-size:0.8rem; cursor:pointer;
        }
        .rag-input {
          width:100%; margin-top:0.5rem; background:rgba(0,0,0,0.35);
          border:1px solid rgba(201,168,76,0.35); border-radius:8px; color:${C.white};
          padding:0.55rem; font-size:0.85rem; font-family:system-ui,sans-serif; resize:vertical;
        }
        .rag-generate {
          width:100%; margin-top:0.5rem; background:${C.gold}; color:${C.dark}; font-weight:600;
          border:none; border-radius:10px; padding:0.8rem; font-size:0.95rem; cursor:pointer;
        }
        .rag-generate:disabled { opacity:0.6; cursor:default; }
        .rag-canvas {
          width:100%; aspect-ratio:1/1; border:1px solid rgba(201,168,76,0.4); border-radius:12px;
          overflow:hidden; background:${C.dark}; display:flex; align-items:center; justify-content:center;
        }
        .rag-canvas img { width:100%; height:100%; object-fit:contain; }
        .rag-placeholder { color:${C.muted}; font-size:0.9rem; text-align:center; padding:1rem; }
        .rag-actions { display:flex; gap:0.6rem; margin-top:0.75rem; }
        .rag-btn {
          flex:1; background:rgba(26,15,10,0.8); color:${C.white}; border:1px solid rgba(201,168,76,0.4);
          border-radius:8px; padding:0.55rem; font-size:0.82rem; cursor:pointer;
        }
        .rag-btn:hover { border-color:${C.gold}; color:${C.gold}; }
        .rag-btn:disabled { opacity:0.5; cursor:default; }
        .rag-btn-gold { width:100%; margin-top:0.6rem; background:${C.gold}; color:${C.dark}; border-color:${C.gold}; font-weight:600; }
        .rag-btn-gold:hover { color:${C.dark}; background:#dcc06a; }
        .rag-divider { height:1px; background:rgba(201,168,76,0.25); margin:2rem 0 1.25rem; }
        .rag-composer-title { color:${C.gold}; font-family:${SERIF}; font-size:1.3rem; margin-bottom:0.25rem; }
        .rag-composer-sub { color:${C.muted}; font-size:0.85rem; margin-bottom:1.25rem; max-width:680px; }
        .rag-refine { display:flex; gap:0.5rem; margin-top:0.6rem; }
        .rag-refine .rag-input { margin-top:0; }
        .rag-refine .rag-btn { flex:0 0 auto; padding:0.55rem 1rem; }
        @media (max-width:820px) { .rag-grid { grid-template-columns:1fr; } }
      `,
      }}
    />
  );
}
