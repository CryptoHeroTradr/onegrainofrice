"use client";

import { useEffect, useRef } from "react";
import { drawBonusItem } from "./engine/render";
import { BONUS_BY_LEVEL, bonusForLevel } from "./engine/levels";

/**
 * The level indicator, drawn as the run of bonus items earned so far — the arcade's own
 * way of saying "how deep are you" without a number.
 *
 * These are the SAME drawing functions the board uses, at a smaller size. That is the
 * point of routing both through `drawBonusItem`: the icon a player learns in the corner of
 * the HUD is pixel-for-pixel the thing they will see appear under the pen, so recognising
 * one teaches them the other. A separate set of HUD glyphs would quietly drift.
 *
 * It is also where the silhouette rule gets its cheapest test. Six items at 22px in a row,
 * side by side, is the hardest possible read — if two of them are confusable, it shows up
 * here first.
 */

/** How many levels of history to show before the strip starts scrolling. */
const MAX_ICONS = 7;
/**
 * Displayed size, on the same fluid ramp as the HUD text beside it (Phase 5.6) —
 * 22px on a phone, growing to 37px on a large display.
 */
const ICON_CSS = "clamp(22px, 17px + 1.27vmin, 37px)";
/**
 * Drawn once at the TOP of that ramp and CSS-scaled down, so the strip never needs a
 * re-draw on resize and is only ever downsampled. See LivesRow, which does the same.
 */
const RENDER_PX = 37;
/** Cap on the backing store, matching the game canvas. */
const MAX_DPR = 2;

function BonusIcon({ kind, dim }: { kind: number; dim: boolean }) {
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
    drawBonusItem(ctx, kind, RENDER_PX * 0.92);
  }, [kind]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        width: ICON_CSS,
        height: ICON_CSS,
        display: "block",
        opacity: dim ? 0.35 : 1,
      }}
    />
  );
}

/**
 * The strip. Shows the current level's item last and brightest, with the levels behind it
 * dimmed — so the newest item is the one the eye lands on, which is the one that is about
 * to appear on the board.
 */
export function BonusIcons({ level }: { level: number }) {
  const highest = Math.max(1, Math.min(level, BONUS_BY_LEVEL.length));
  const from = Math.max(1, highest - MAX_ICONS + 1);
  const levels: number[] = [];
  for (let lv = from; lv <= highest; lv++) levels.push(lv);

  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`Level ${level}`}
      translate="no"
    >
      {levels.map((lv) => (
        <BonusIcon key={lv} kind={bonusForLevel(lv).kind} dim={lv !== highest} />
      ))}
    </div>
  );
}
