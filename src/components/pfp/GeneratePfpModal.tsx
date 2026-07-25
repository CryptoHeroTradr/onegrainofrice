"use client";

// "Generate New PFP" modal. Sends the flattened composition to
// /api/pfp/generate-pfp (a full realistic re-render + generative-fill
// background), shows the result, and lets the user edit the prompt &
// regenerate, generate again, download, and browse their wallet-attached
// history (persisted in the DB).

import { useCallback, useEffect, useState } from "react";
import { C, SERIF, GAME_API } from "@/components/landing/ui";
import { downloadUrl } from "./imaging";

interface Generation {
  id: string | null;
  image: string;
  prompt: string;
  style?: string | null;
  parentId?: string | null;
  createdAt: string;
}

export function GeneratePfpModal({
  source,
  layers,
  walletAddress,
  onClose,
}: {
  source: string; // flattened composition (data URL)
  layers: unknown[]; // layer manifest snapshot
  walletAddress: string | null;
  onClose: () => void;
}) {
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<Generation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);

  const loadHistory = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const r = await fetch(`${GAME_API}/api/pfp/history?wallet=${encodeURIComponent(walletAddress)}`);
      if (r.ok) {
        const d = await r.json();
        setHistory(Array.isArray(d.generations) ? d.generations : []);
      }
    } catch {
      /* ignore */
    }
  }, [walletAddress]);

  const generate = useCallback(
    async (opts: { parentId?: string | null } = {}) => {
      setError(null);
      setLoading(true);
      try {
        const res = await fetch(`${GAME_API}/api/pfp/generate-pfp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: source,
            prompt: prompt.trim() || undefined,
            walletAddress: walletAddress || undefined,
            layers,
            parentId: opts.parentId ?? current?.id ?? undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Generation failed.");
        } else {
          const gen: Generation = {
            id: data.id,
            image: data.image,
            prompt: data.prompt,
            createdAt: data.createdAt,
          };
          setCurrent(gen);
          if (data.saved) {
            setHistory((h) => [gen, ...h]);
          }
        }
      } catch (err) {
        setError((err as Error).message || "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [source, prompt, walletAddress, layers, current],
  );

  // On open: check AI availability and load history. We do NOT auto-generate —
  // the user enters their custom prompt first, then clicks Generate.
  useEffect(() => {
    let cancelled = false;
    fetch(`${GAME_API}/api/pfp/status`)
      .then((r) => (r.ok ? r.json() : { aiEnabled: false }))
      .then((d) => !cancelled && setAiEnabled(!!d.aiEnabled))
      .catch(() => !cancelled && setAiEnabled(false));
    loadHistory();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = useCallback(
    async (id: string | null) => {
      if (!id || !walletAddress) return;
      try {
        await fetch(`${GAME_API}/api/pfp/generation/${id}?wallet=${encodeURIComponent(walletAddress)}`, {
          method: "DELETE",
        });
        setHistory((h) => h.filter((g) => g.id !== id));
        if (current?.id === id) setCurrent(null);
      } catch {
        /* ignore */
      }
    },
    [walletAddress, current],
  );

  return (
    <div className="gpfp-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <GenStyles />
      <div className="gpfp-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="gpfp-close" onClick={onClose} aria-label="Close">✕</button>
        <h3 style={{ color: C.gold, fontFamily: SERIF, fontSize: "1.5rem", margin: "0 0 0.25rem" }}>
          ✨ Generate New PFP
        </h3>
        <p style={{ color: C.muted, fontSize: "0.85rem", margin: "0 0 1rem" }}>
          AI re-renders your composition realistically — natural placement of every layer, with a full
          generative-fill background.
        </p>

        {aiEnabled === false ? (
          <div className="gpfp-error">
            PFP generation requires an OpenAI API key. Add <code>OPENAI_API_KEY</code> to the server
            config (apps/server/.env) and restart the server.
          </div>
        ) : (
          <div className="gpfp-grid">
            {/* Result + controls */}
            <div className="gpfp-main">
              <div className="gpfp-canvas">
                {loading ? (
                  <div className="gpfp-ph">🌾 Generating your grain… this can take ~10–20s</div>
                ) : current ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current.image} alt="Generated PFP" />
                ) : (
                  <div className="gpfp-ph">Your generated PFP will appear here</div>
                )}
              </div>

              {error && <div className="gpfp-error">{error}</div>}

              <label className="gpfp-label">
                Custom prompt <span>(optional — steers the look)</span>
              </label>
              <textarea
                className="gpfp-input"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. golden hour lighting, samurai armor, ancient temple courtyard, photorealistic…"
              />

              <div className="gpfp-actions">
                <button type="button" className="gpfp-btn gpfp-btn-gold" disabled={loading || aiEnabled === null} onClick={() => generate()}>
                  {loading ? "Generating…" : current ? "🔁 Regenerate" : "🚀 Generate"}
                </button>
                <button type="button" className="gpfp-btn" disabled={loading} onClick={() => generate({ parentId: null })}>
                  ✨ Generate Again
                </button>
                <button type="button" className="gpfp-btn" disabled={!current} onClick={() => current && downloadUrl(current.image, "pfp-ricedao-ai.png")}>
                  ⬇ Download
                </button>
              </div>

              {!walletAddress && (
                <div className="gpfp-note">Connect your wallet to save generations to your history.</div>
              )}
            </div>

            {/* History */}
            <div className="gpfp-history">
              <div className="gpfp-history-title">History {walletAddress ? `(${history.length})` : ""}</div>
              {!walletAddress ? (
                <div className="gpfp-note">Wallet not connected.</div>
              ) : history.length === 0 ? (
                <div className="gpfp-note">No saved generations yet.</div>
              ) : (
                <div className="gpfp-history-list">
                  {history.map((g) => (
                    <div key={g.id ?? g.createdAt} className="gpfp-hist-item">
                      <button
                        type="button"
                        className="gpfp-hist-thumb"
                        onClick={() => {
                          setCurrent(g);
                          setPrompt(g.prompt || "");
                        }}
                        title={new Date(g.createdAt).toLocaleString()}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={g.image} alt="history" loading="lazy" />
                      </button>
                      <button type="button" className="gpfp-hist-del" onClick={() => remove(g.id)} title="Delete">🗑</button>
                    </div>
                  ))}
                </div>
              )}
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
        .gpfp-backdrop { position:fixed; inset:0; z-index:200; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; padding:1rem; }
        .gpfp-modal { position:relative; width:100%; max-width:840px; max-height:92vh; overflow-y:auto; background:${C.bg}; border:1px solid rgba(201,168,76,0.4); border-radius:16px; padding:1.5rem; }
        .gpfp-close { position:absolute; top:0.75rem; right:0.75rem; background:transparent; border:none; color:${C.gold}; font-size:1.1rem; cursor:pointer; }
        .gpfp-grid { display:grid; grid-template-columns: 1fr 180px; gap:1.25rem; align-items:start; }
        .gpfp-canvas { width:100%; aspect-ratio:1/1; border:1px solid rgba(201,168,76,0.4); border-radius:12px; overflow:hidden; background:${C.dark}; display:flex; align-items:center; justify-content:center; }
        .gpfp-canvas img { width:100%; height:100%; object-fit:contain; }
        .gpfp-ph { color:${C.muted}; font-size:0.9rem; text-align:center; padding:1rem; }
        .gpfp-label { display:block; margin-top:0.85rem; margin-bottom:0.3rem; color:${C.gold}; font-size:0.82rem; font-weight:600; }
        .gpfp-label span { color:${C.muted}; font-weight:400; }
        .gpfp-input { width:100%; background:rgba(0,0,0,0.35); border:1px solid rgba(201,168,76,0.35); border-radius:8px; color:${C.white}; padding:0.6rem; font-size:0.85rem; resize:vertical; font-family:system-ui,sans-serif; }
        .gpfp-actions { display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.75rem; }
        .gpfp-btn { background:rgba(26,15,10,0.8); color:${C.white}; border:1px solid rgba(201,168,76,0.4); border-radius:8px; padding:0.55rem 0.9rem; font-size:0.82rem; cursor:pointer; }
        .gpfp-btn:hover { border-color:${C.gold}; color:${C.gold}; }
        .gpfp-btn:disabled { opacity:0.5; cursor:default; }
        .gpfp-btn-gold { background:${C.gold}; color:${C.dark}; border-color:${C.gold}; font-weight:600; }
        .gpfp-note { color:${C.muted}; font-size:0.78rem; margin-top:0.6rem; }
        .gpfp-error { color:${C.white}; background:rgba(178,58,58,0.15); border:1px solid rgba(178,58,58,0.5); border-radius:10px; padding:0.75rem 0.9rem; font-size:0.82rem; margin-top:0.75rem; }
        .gpfp-history { border:1px solid rgba(201,168,76,0.2); border-radius:12px; padding:0.6rem; background:rgba(10,8,5,0.5); }
        .gpfp-history-title { color:${C.gold}; font-family:${SERIF}; font-size:0.9rem; margin-bottom:0.5rem; }
        .gpfp-history-list { display:flex; flex-direction:column; gap:0.5rem; max-height:420px; overflow-y:auto; }
        .gpfp-hist-item { position:relative; }
        .gpfp-hist-thumb { display:block; width:100%; padding:0; border:1px solid rgba(201,168,76,0.25); border-radius:8px; overflow:hidden; cursor:pointer; background:${C.dark}; }
        .gpfp-hist-thumb:hover { border-color:${C.gold}; }
        .gpfp-hist-thumb img { width:100%; aspect-ratio:1/1; object-fit:cover; display:block; }
        .gpfp-hist-del { position:absolute; top:4px; right:4px; background:rgba(10,8,5,0.8); border:1px solid rgba(201,168,76,0.4); border-radius:6px; color:${C.white}; font-size:0.7rem; cursor:pointer; padding:2px 5px; }
        @media (max-width: 720px) { .gpfp-grid { grid-template-columns:1fr; } .gpfp-history-list { flex-direction:row; flex-wrap:wrap; } .gpfp-hist-item { width:72px; } }
      `,
      }}
    />
  );
}
