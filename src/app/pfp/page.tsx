"use client";

// /pfp — the $RICE PFP Generator. The Layer Composer is the whole page: its
// tools live behind one 🧰 Canvas Tools dropdown and its AI work behind one
// 🌟 Generate button, so this file is just the frame around it.
//
// It was previously two modes — the composer plus a "Rice Art Generator" panel
// toggled above it — with AI Enhance, Rice Art and Generate New PFP as three
// separate processes. They are now one process; see components/pfp/GenerateModal.
// The AI is backed by a Next route handler at /onegrainofrice/api/pfp/generate.

import { JourneyNav } from "@/components/journey/JourneyNav";
import { HomeFooter } from "@/components/journey/HomeFooter";
import { C, SERIF } from "@/components/landing/ui";
import { asset } from "@/lib/asset";
import { LayerComposer } from "@/components/pfp/LayerComposer";

export default function PfpPage() {
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
          {/* Privacy note — the one line that matters, next to the tools. */}
          <p className="pfp-privacy">
            🔒 Composing and downloading run fully in your browser and never leave your device.
            Only <b>Generate</b> sends your image anywhere — it goes to OpenAI.
          </p>

          <LayerComposer />
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
        .pfp-privacy {
          color:${C.muted}; font-size:0.82rem; line-height:1.55; margin:0 0 1.25rem;
          border:1px solid rgba(201,168,76,0.3); border-radius:12px; padding:0.85rem 1rem;
          background:rgba(10,8,5,0.55);
        }
        .pfp-privacy b { color:${C.gold}; }
      `,
      }}
    />
  );
}
