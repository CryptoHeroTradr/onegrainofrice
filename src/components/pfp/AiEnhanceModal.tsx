"use client";

// AI Enhance modal — flattens the current PFP, posts it to /api/pfp/enhance, and
// shows a before/after so the user can keep the original or adopt the AI version.
// Gracefully reports when the server has no OpenAI key configured.

import { useEffect, useState } from "react";
import { C, SERIF, GAME_API } from "@/components/landing/ui";
import { downloadUrl } from "./imaging";

type Style = "realistic" | "anime" | "painting" | "pixel" | "custom";

const STYLES: { key: Style; emoji: string; label: string }[] = [
  { key: "realistic", emoji: "📷", label: "Realistic" },
  { key: "anime", emoji: "🎌", label: "Anime" },
  { key: "painting", emoji: "🎨", label: "Painting" },
  { key: "pixel", emoji: "👾", label: "Pixel Art" },
  { key: "custom", emoji: "✏️", label: "Custom" },
];

export function AiEnhanceModal({
  source,
  layers = [],
  walletAddress = null,
  onClose,
  onUse,
}: {
  source: string;
  layers?: unknown[];
  walletAddress?: string | null;
  onClose: () => void;
  onUse: (dataUrl: string) => void;
}) {
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [style, setStyle] = useState<Style>("realistic");
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${GAME_API}/api/pfp/status`)
      .then((r) => (r.ok ? r.json() : { aiEnabled: false }))
      .then((d) => {
        if (!cancelled) setAiEnabled(!!d.aiEnabled);
      })
      .catch(() => {
        if (!cancelled) setAiEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = async () => {
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${GAME_API}/api/pfp/enhance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: source,
          style,
          customPrompt: style === "custom" ? custom : undefined,
          walletAddress: walletAddress || undefined,
          layers,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "AI enhancement failed.");
      } else {
        setResult(data.imageBase64 || data.imageUrl);
      }
    } catch (err) {
      setError((err as Error).message || "Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pfp-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <ModalStyles />
      <div className="pfp-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pfp-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h3 style={{ color: C.gold, fontFamily: SERIF, fontSize: "1.5rem", margin: "0 0 0.25rem" }}>
          ✨ Enhance your PFP with AI
        </h3>

        {aiEnabled === false ? (
          <div className="pfp-ai-disabled">
            AI enhancement requires an OpenAI API key. Add <code>OPENAI_API_KEY</code> to the server
            config (apps/server/.env) and restart the server.
          </div>
        ) : (
          <>
            <p style={{ color: C.muted, fontSize: "0.85rem", margin: "0 0 1rem" }}>
              Pick a style — the AI keeps your hat, bowl & accessories and restyles the portrait.
            </p>

            <div className="pfp-style-grid">
              {STYLES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="pfp-style-card"
                  onClick={() => setStyle(s.key)}
                  style={{
                    borderColor: style === s.key ? C.gold : "rgba(201,168,76,0.25)",
                    background: style === s.key ? "rgba(201,168,76,0.15)" : "rgba(26,15,10,0.6)",
                  }}
                >
                  <span style={{ fontSize: "1.4rem" }}>{s.emoji}</span>
                  <span style={{ fontSize: "0.75rem", color: C.white }}>{s.label}</span>
                </button>
              ))}
            </div>

            {style === "custom" && (
              <textarea
                className="pfp-custom-input"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Make it look like a Japanese woodblock print with gold accents..."
                rows={2}
              />
            )}

            <div className="pfp-ba">
              <Figure label="Before" src={source} />
              <Figure
                label={result ? "After" : loading ? "Generating…" : "After"}
                src={result ?? undefined}
                loading={loading}
              />
            </div>

            {error && <div className="pfp-ai-error">{error}</div>}

            {!result ? (
              <div className="pfp-modal-actions">
                <button
                  type="button"
                  className="pfp-btn pfp-btn-gold"
                  onClick={generate}
                  disabled={loading || aiEnabled === null || (style === "custom" && !custom.trim())}
                >
                  {loading ? "AI is painting your grain…" : "🚀 Generate"}
                </button>
              </div>
            ) : (
              <div className="pfp-modal-actions">
                <button type="button" className="pfp-btn" onClick={onClose}>
                  ← Keep Original
                </button>
                <button
                  type="button"
                  className="pfp-btn"
                  onClick={() => downloadUrl(result, "pfp-ricedao-ai.png")}
                >
                  ⬇ Download
                </button>
                <button type="button" className="pfp-btn pfp-btn-gold" onClick={() => onUse(result)}>
                  ✓ Use AI Version
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Figure({ label, src, loading }: { label: string; src?: string; loading?: boolean }) {
  return (
    <div className="pfp-figure">
      <div className="pfp-figure-img">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} />
        ) : (
          <div className="pfp-figure-empty">{loading ? "⏳" : "—"}</div>
        )}
      </div>
      <span>{label}</span>
    </div>
  );
}

function ModalStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
        .pfp-modal-backdrop {
          position:fixed; inset:0; z-index:200; background:rgba(0,0,0,0.85);
          display:flex; align-items:center; justify-content:center; padding:1rem;
        }
        .pfp-modal {
          position:relative; width:100%; max-width:560px; max-height:90vh; overflow-y:auto;
          background:${C.bg}; border:1px solid rgba(201,168,76,0.4); border-radius:16px; padding:1.5rem;
        }
        .pfp-modal-close {
          position:absolute; top:0.75rem; right:0.75rem; background:transparent; border:none;
          color:${C.gold}; font-size:1.1rem; cursor:pointer;
        }
        .pfp-ai-disabled, .pfp-ai-error {
          color:${C.white}; background:rgba(178,58,58,0.15); border:1px solid rgba(178,58,58,0.5);
          border-radius:10px; padding:0.85rem 1rem; font-size:0.85rem; margin-top:0.75rem; line-height:1.5;
        }
        .pfp-ai-error { margin-top:1rem; }
        .pfp-style-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:0.5rem; }
        .pfp-style-card {
          display:flex; flex-direction:column; align-items:center; gap:0.3rem;
          border:1px solid rgba(201,168,76,0.25); border-radius:10px; padding:0.6rem 0.3rem; cursor:pointer;
        }
        .pfp-custom-input {
          width:100%; margin-top:0.75rem; background:rgba(0,0,0,0.35);
          border:1px solid rgba(201,168,76,0.35); border-radius:8px; color:${C.white};
          padding:0.6rem; font-size:0.85rem; resize:vertical; font-family:system-ui,sans-serif;
        }
        .pfp-ba { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-top:1.25rem; }
        .pfp-figure { display:flex; flex-direction:column; align-items:center; gap:0.4rem; }
        .pfp-figure-img {
          width:100%; aspect-ratio:1/1; border:1px solid rgba(201,168,76,0.3); border-radius:10px;
          overflow:hidden; background:${C.dark};
        }
        .pfp-figure-img img { width:100%; height:100%; object-fit:contain; }
        .pfp-figure-empty { width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:${C.muted}; font-size:1.5rem; }
        .pfp-figure span { color:${C.muted}; font-size:0.78rem; }
        .pfp-modal-actions { display:flex; flex-wrap:wrap; gap:0.6rem; justify-content:flex-end; margin-top:1.25rem; }
        @media (max-width:480px) { .pfp-style-grid { grid-template-columns:repeat(3,1fr); } }
      `,
      }}
    />
  );
}
