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

/** Cap on the backing store, matching the game canvas. */
const MAX_DPR = 2;

export function PestPortrait({ kind, size = 44 }: { kind: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    // Slightly under the box so the nori outline is never clipped by the edge.
    drawPestIcon(ctx, kind, size * 0.9);
  }, [kind, size]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: size, height: size, display: "block", flexShrink: 0 }}
    />
  );
}
