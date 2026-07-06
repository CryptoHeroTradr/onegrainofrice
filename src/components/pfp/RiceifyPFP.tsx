"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ImagePlus, RefreshCw, Sparkles } from "lucide-react";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";
import { useRice } from "@/components/rice/RiceParticles";

/**
 * Client-only PFP compositor. The user's image is read locally (FileReader) and
 * composited on a canvas with fixed overlay layers from public/pfp/ (chopsticks,
 * rice bowl, $RICE badge). Nothing is ever uploaded — "Download PNG" exports via
 * canvas.toBlob. Overlays are same-origin transparent PNGs (taint-free export).
 */

const SIZE = 512;

type LayerKey = "chopsticks" | "bowl" | "badge";

const LAYERS: { key: LayerKey; label: string; variants: string[] }[] = [
  { key: "chopsticks", label: "Chopsticks", variants: ["/pfp/chopsticks-1.png", "/pfp/chopsticks-2.png"] },
  { key: "bowl", label: "Rice bowl", variants: ["/pfp/bowl-1.png", "/pfp/bowl-2.png"] },
  { key: "badge", label: "$RICE badge", variants: ["/pfp/badge.png"] },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function RiceifyPFP() {
  const { pour } = useRice();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlays = useRef<Record<string, HTMLImageElement>>({});
  const userImg = useRef<HTMLImageElement | null>(null);

  const [hasImage, setHasImage] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [enabled, setEnabled] = useState<Record<LayerKey, boolean>>({
    chopsticks: true,
    bowl: true,
    badge: true,
  });
  const [variant, setVariant] = useState<Record<LayerKey, number>>({
    chopsticks: 0,
    bowl: 0,
    badge: 0,
  });
  const [nonce, setNonce] = useState(0); // redraw trigger

  // Preload overlays once (same-origin, no third-party calls).
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const layer of LAYERS) {
        for (const v of layer.variants) {
          try {
            const img = await loadImage(asset(v));
            if (alive) overlays.current[v] = img;
          } catch {
            /* placeholder missing — layer just won't draw */
          }
        }
      }
      if (alive) setNonce((n) => n + 1);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Composite whenever image / layers / variants change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);

    const img = userImg.current;
    if (img) {
      const scale = Math.max(SIZE / img.width, SIZE / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    } else {
      ctx.fillStyle = "#e7edf6";
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    for (const layer of LAYERS) {
      if (!enabled[layer.key]) continue;
      const ov = overlays.current[layer.variants[variant[layer.key]]];
      if (ov) ctx.drawImage(ov, 0, 0, SIZE, SIZE);
    }
  }, [enabled, variant, nonce]);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        userImg.current = await loadImage(String(reader.result));
        setHasImage(true);
        setNonce((n) => n + 1);
      } catch {
        /* ignore unreadable image */
      }
    };
    reader.readAsDataURL(file); // local only — never uploaded
  }

  function onDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "rice-pfp.png";
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch {
      /* toBlob throws only on a tainted canvas — same-origin PNGs avoid this */
    }
  }

  const toggle = (k: LayerKey) => setEnabled((s) => ({ ...s, [k]: !s[k] }));
  const cycle = (k: LayerKey, count: number) =>
    setVariant((s) => ({ ...s, [k]: (s[k] + 1) % count }));

  return (
    <section id="pfp" className="grain-paper bg-steamed py-20 text-nori sm:py-28">
      <div className="mx-auto grid max-w-[1180px] items-start gap-10 px-6 lg:grid-cols-[1fr_1fr]">
        {/* Preview + dropzone (explicit solid border — not a dashed StickerCard) */}
        <div>
          <label
            htmlFor="pfp-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            className={`block cursor-pointer border-2 p-4 text-center transition-colors ${
              dragOver ? "border-tuna bg-bone" : "border-porcelain bg-bone/60"
            }`}
          >
            <canvas
              ref={canvasRef}
              width={SIZE}
              height={SIZE}
              className="mx-auto aspect-square w-full max-w-md bg-[#e7edf6]"
              role="img"
              aria-label="Your rice-ified profile picture preview"
            />
            {!hasImage && (
              <span className="mt-4 flex items-center justify-center gap-2 font-mono text-sm font-bold text-nori/70">
                <ImagePlus size={18} aria-hidden="true" />
                {site.pfp.dropLabel}
              </span>
            )}
            <span className="mt-1 block font-mono text-xs text-nori/50">{site.pfp.dropHint}</span>
          </label>
          <input
            id="pfp-file"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>

        {/* Controls */}
        <div>
          <h2 className="font-display-round text-4xl font-bold sm:text-5xl">
            {site.pfp.heading.lead} <span className="text-bamboo">{site.pfp.heading.accent}</span>
          </h2>
          <p className="mt-3 max-w-md font-mono text-sm text-nori/70">{site.pfp.sub}</p>

          <div className="mt-8 space-y-3">
            {LAYERS.map((layer) => (
              <div
                key={layer.key}
                className="flex items-center justify-between gap-4 border-2 border-porcelain/50 bg-bone px-4 py-3"
              >
                <label className="flex items-center gap-3 font-mono text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={enabled[layer.key]}
                    onChange={() => toggle(layer.key)}
                    className="h-4 w-4 accent-bamboo"
                  />
                  {layer.label}
                </label>
                {layer.variants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => cycle(layer.key, layer.variants.length)}
                    disabled={!enabled[layer.key]}
                    aria-label={`Cycle ${layer.label} style`}
                    className="flex min-h-9 items-center gap-1.5 border-2 border-porcelain px-3 font-mono text-xs font-bold text-porcelain transition-colors hover:bg-porcelain hover:text-steamed disabled:opacity-40"
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    style {variant[layer.key] + 1}/{layer.variants.length}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={(e) => {
                setNonce((n) => n + 1);
                pour({ x: e.clientX, y: e.clientY, count: 24 });
              }}
              className="flex min-h-11 items-center gap-2 bg-tuna px-6 font-display-round text-base font-bold text-steamed transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-porcelain"
            >
              <Sparkles size={18} aria-hidden="true" />
              {site.pfp.riceifyLabel}
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={!hasImage}
              className="flex min-h-11 items-center gap-2 border-2 border-bamboo px-6 font-mono text-sm font-bold tracking-widest text-bamboo transition-colors hover:bg-bamboo hover:text-steamed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bamboo"
            >
              <Download size={16} aria-hidden="true" />
              {site.pfp.downloadLabel}
            </button>
          </div>

          <p className="mt-5 font-mono text-xs text-nori/50">{site.pfp.privacyNote}</p>

          <p className="mt-4 font-mono text-sm">
            {site.pfp.aiPrompt}{" "}
            <a
              href={site.villagePfpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-tuna underline underline-offset-4 hover:text-bamboo"
            >
              {site.pfp.aiLinkLabel} →
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
