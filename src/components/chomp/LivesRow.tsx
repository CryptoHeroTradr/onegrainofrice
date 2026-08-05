"use client";

import { useEffect, useRef } from "react";
import { drawPlayerIcon } from "./engine/render";

/**
 * Lives, as rice grains.
 *
 * The HUD used to spend a `◆` per life. This draws the PLAYER — through `drawPlayerIcon`,
 * which is the same sprite code the board runs, hat and outline and all — for the same
 * reason `BonusIcons` routes the level indicator through `drawBonusItem`: an icon drawn
 * separately is an icon that drifts, and the one thing this character has to do is stay
 * recognisable. A player glancing at the lives row should see the thing they are steering.
 *
 * The count is the accessible text; the canvases are decoration and are hidden from it.
 */

/**
 * Displayed size, on the same fluid ramp as the HUD text beside it (Phase 5.6) —
 * 22px on a phone, growing to 37px on a large display. Matches BonusIcons' strip.
 */
const ICON_CSS = "clamp(22px, 17px + 1.27vmin, 37px)";
/**
 * The backing store is drawn once at the TOP of that ramp and CSS-scaled down, so a
 * viewport change never needs a re-draw and the icon is only ever downsampled. The
 * sprite is vector, so drawing large and showing small is free; the reverse is not.
 */
const RENDER_PX = 37;
/** Cap on the backing store, matching the game canvas and the bonus strip. */
const MAX_DPR = 2;

function LifeGrain() {
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
    // Slightly under the box, so the hat's olive outline is never clipped by the edge —
    // and that outline is the character's distinctness feature, so clipping it is not a
    // cosmetic loss.
    drawPlayerIcon(ctx, RENDER_PX * 0.94);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: ICON_CSS, height: ICON_CSS, display: "block" }}
    />
  );
}

export function LivesRow({ lives }: { lives: number }) {
  const n = Math.max(0, lives);
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={n === 1 ? "1 life left" : `${n} lives left`}
      translate="no"
    >
      {n === 0 ? (
        <span className="font-mono text-sm text-steamed/40">—</span>
      ) : (
        Array.from({ length: n }, (_, i) => <LifeGrain key={i} />)
      )}
    </div>
  );
}
