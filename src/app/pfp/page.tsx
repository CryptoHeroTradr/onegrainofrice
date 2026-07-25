"use client";

// /pfp — the $RICE PFP Generator, a faithful clone of RiceDAO's /pfp page.
// The Layer Composer is the MAIN, always-mounted editor; the Rice Art Generator
// is an optional panel toggled above it (toggling never unmounts the composer,
// so no layer settings are lost). Adapted for onegrainofrice: RiceDAO's Navbar /
// PageScroller / landing primitives are swapped for the site's own chrome, and
// image srcs resolve under the app basePath. The AI features are backed by Next
// route handlers under /onegrainofrice/api/pfp/*.

import { useRef, useState } from "react";
import { JourneyNav } from "@/components/journey/JourneyNav";
import { HomeFooter } from "@/components/journey/HomeFooter";
import { C, SERIF } from "@/components/landing/ui";
import { asset } from "@/lib/asset";
import { useGameWallet } from "@/components/WalletProvider";
import { LayerComposer, type LayerComposerHandle } from "@/components/pfp/LayerComposer";
import { RiceArtGenerator } from "@/components/pfp/RiceArtGenerator";

export default function PfpPage() {
  const [riceOpen, setRiceOpen] = useState(false);
  const composerRef = useRef<LayerComposerHandle>(null);
  const { walletAddress } = useGameWallet();

  return (
    <>
      <PageStyles />
      <JourneyNav />

      <main className="pfp-root">
        {/* ── HEADER ───────────────────────────────────────────────────────── */}
        <section
          className="pfp-hero"
          style={{
            backgroundImage: `linear-gradient(rgba(10,8,5,0.5), rgba(10,8,5,0.5)), url("${asset("/pfp/pfp-header.png")}")`,
          }}
        >
          <div className="pfp-header-card">
            <span className="pfp-goldlabel">$RICE PFP &amp; Meme Gen</span>
            <h1 className="pfp-heading">🌾 PFP &amp; Meme Gen</h1>
            <p className="pfp-body">make your $Rice Villager PFP or Rice Meme</p>
          </div>
        </section>

        {/* ── WORKSPACE ────────────────────────────────────────────────────── */}
        <section className="pfp-workspace">
          {/* Mode bar: composer is always on; rice art is a toggle. */}
          <div className="pfp-mode-bar">
            <span className="pfp-mode-main">🎨 Layer Composer</span>
            <button
              type="button"
              className="pfp-mode-toggle"
              onClick={() => setRiceOpen((v) => !v)}
              style={
                riceOpen ? { background: C.gold, color: C.dark, borderColor: C.gold } : undefined
              }
            >
              🌾 Rice Art Generator {riceOpen ? "▲" : "▼"}
            </button>
          </div>

          {/* Privacy note — surfaced near the AI features. */}
          <p className="pfp-privacy">
            🔒 The <b>Layer Composer</b> runs fully in your browser — composing &amp; downloading
            never leave your device, no API key needed. Images you send to <b>AI Enhance</b>, the{" "}
            <b>Rice Art Generator</b>, or <b>Generate PFP</b> are processed by OpenAI, so those
            images do leave your browser.
          </p>

          {/* Rice Art panel — toggled; the composer below stays mounted. */}
          {riceOpen && (
            <div className="pfp-rice-panel">
              <p className="pfp-rice-note">
                🌾 Rice art is built <b>from your current composition</b> as a reference (once
                you&apos;ve added a photo/layers). Empty canvas → generates from the prompt alone.
              </p>
              <RiceArtGenerator
                walletAddress={walletAddress}
                getLayers={() => composerRef.current?.getLayers() ?? []}
                getSource={() => composerRef.current?.getFlattened() ?? ""}
                onAddImage={(src) => composerRef.current?.addImage(src, "Rice Art")}
              />
            </div>
          )}

          {/* Main editor — always mounted (state preserved across rice toggle). */}
          <LayerComposer ref={composerRef} />
        </section>
      </main>

      <HomeFooter />
    </>
  );
}

function PageStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
        .pfp-root { background:${C.bg}; color:${C.white}; min-height:100vh; font-family:system-ui,sans-serif; }
        .pfp-hero {
          min-height:56vh; display:flex; align-items:center; justify-content:center;
          padding:6rem 1rem 3rem; background-size:cover; background-position:center;
        }
        .pfp-header-card {
          background-color:rgba(10,8,5,0.78); backdrop-filter:blur(8px);
          -webkit-backdrop-filter:blur(8px); border-radius:16px;
          padding:clamp(1.75rem,4vw,40px) clamp(1.5rem,4vw,48px);
          border:1px solid rgba(201,168,76,0.3); max-width:700px; text-align:center;
        }
        .pfp-goldlabel {
          display:inline-block; color:${C.gold}; font-family:${SERIF}; letter-spacing:0.18em;
          text-transform:uppercase; font-size:0.8rem; margin-bottom:0.75rem;
        }
        .pfp-heading {
          color:${C.white}; font-family:${SERIF}; font-weight:700; line-height:1.1;
          font-size:clamp(2rem, 6vw, 3.5rem); margin:0 0 0.75rem;
        }
        .pfp-body { color:${C.white}; opacity:0.85; margin:0 auto; text-align:center; max-width:52ch; line-height:1.6; }
        .pfp-workspace {
          background:${C.bg}; padding:clamp(1.25rem,4vw,2.5rem) clamp(0.75rem,3vw,2rem) clamp(3rem,8vh,5rem);
          max-width:1200px; margin:0 auto; width:100%;
        }
        .pfp-mode-bar { display:flex; flex-wrap:wrap; gap:0.75rem; align-items:center; margin-bottom:1.25rem; }
        .pfp-mode-main {
          color:${C.dark}; background:${C.gold}; border-radius:999px;
          padding:0.5rem 1.2rem; font-size:0.95rem; font-weight:600; font-family:system-ui,sans-serif;
        }
        .pfp-mode-toggle {
          border:1px solid ${C.gold}; border-radius:999px; padding:0.5rem 1.2rem;
          font-size:0.95rem; font-weight:600; cursor:pointer; color:${C.white};
          background:transparent; font-family:system-ui,sans-serif; transition:all .15s ease;
        }
        .pfp-mode-toggle:hover { color:${C.gold}; }
        .pfp-privacy {
          color:${C.muted}; font-size:0.82rem; line-height:1.55; margin:0 0 1.5rem;
          border:1px solid rgba(201,168,76,0.3); border-radius:12px; padding:0.85rem 1rem;
          background:rgba(10,8,5,0.55);
        }
        .pfp-privacy b { color:${C.gold}; }
        .pfp-rice-panel {
          border:1px solid rgba(201,168,76,0.3); border-radius:14px;
          padding:1.25rem; margin-bottom:1.5rem; background:rgba(10,8,5,0.55);
        }
        .pfp-rice-note { color:${C.muted}; font-size:0.85rem; margin:0 0 1rem; line-height:1.5; }
        .pfp-rice-note b { color:${C.gold}; }
      `,
      }}
    />
  );
}
