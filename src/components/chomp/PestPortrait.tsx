"use client";

import { useEffect, useRef } from "react";
import { drawPestIcon } from "./engine/render";

/**
 * One pest, standing still, for the attract screen's roll call.
 *
 * Same trick as BonusIcons: it goes through `drawPestIcon`, which is the SAME art
 * the board uses. The point is that the four silhouettes a player is shown before
 * the game starts are pixel-for-pixel the four things that will be chasing them —
 * a separate set of menu portraits would drift, and the whole legibility argument
 * in the spec rests on the silhouettes being learnable.
 */

/**
 * Displayed size, on the same fluid ramp as the copy beside it (Phase 5.6) — 44px on
 * a phone, growing to 75px on a large display. Drawn once at the top of the ramp and
 * CSS-scaled down, so a viewport change needs no re-draw. Same pattern as BonusIcons.
 */
const ICON_CSS = "clamp(44px, 34px + 2.55vmin, 75px)";
const RENDER_PX = 75;
/** Cap on the backing store, matching the game canvas. */
const MAX_DPR = 2;

export function PestPortrait({ kind }: { kind: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(RENDER_PX * dpr);
    canvas.height = Math.round(RENDER_PX * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, RENDER_PX, RENDER_PX);
    ctx.translate(RENDER_PX / 2, RENDER_PX / 2);
    // Slightly under the box so the nori outline is never clipped by the edge.
    drawPestIcon(ctx, kind, RENDER_PX * 0.9);
  }, [kind]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: ICON_CSS, height: ICON_CSS, display: "block", flexShrink: 0 }}
    />
  );
}
