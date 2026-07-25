"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * The rice mascot, as a rice FARMER — conical straw hat, sickle in hand.
 *
 * Drawn as inline SVG rather than the old flat mascot-512.png, because the PNG
 * bakes in the face and chopsticks: you cannot swing a tool it isn't holding or
 * change an expression that's part of the bitmap. As SVG every piece is its own
 * node, so `react()` can swing the sickle arm and pop a "wow" face on each grain.
 *
 * Geometry follows the original mascot (512×512 viewBox, cream body, ink outline,
 * khaki blush) so it still reads as the same character.
 */

export interface RiceFarmerHandle {
  /** Swing the sickle and flash the wow face. Called on every grain dropped. */
  react: () => void;
  /**
   * Break into a VERY HAPPY face — the rapid-fire firehose moment. Holds longer
   * than a wow, and outranks it: the `react()` calls still streaming in from the
   * mash keep swinging the sickle but can't stomp the celebration back to wow.
   */
  celebrate: () => void;
  /**
   * Viewport coords of the sickle BLADE, so the rapid-fire spray can erupt from
   * the blade itself rather than from the pointer. Reads the live bounding box,
   * so it's correct mid-swing and at any mascot size. Null before mount.
   */
  sicklePoint: () => { x: number; y: number } | null;
}

type Mood = "idle" | "wow" | "happy";

const INK = "#14110d";
const BODY = "#FBF7EE";
const STRAW = "#C4B370";
const STRAW_DARK = "#A08F55";
const BLUSH = "#DDD6AB";
const BLADE = "#D6DAE1";
const WOOD = "#8B5E3C";

/** How long the wow face holds after a click. */
const WOW_MS = 340;
/** How long the celebration face holds after a rapid-fire firehose. */
const HAPPY_MS = 1400;

export const RiceFarmer = forwardRef<RiceFarmerHandle, { className?: string }>(
  function RiceFarmer({ className }, ref) {
    const armRef = useRef<SVGGElement>(null);
    const bladeRef = useRef<SVGPathElement>(null);
    const [mood, setMood] = useState<Mood>("idle");
    const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // While celebrating, react() must not knock the happy face back to wow.
    const happyUntil = useRef(0);

    useEffect(
      () => () => {
        if (moodTimer.current) clearTimeout(moodTimer.current);
      },
      [],
    );

    /** Restart the sickle swing, even if one is already mid-flight. */
    const swing = () => {
      const arm = armRef.current;
      if (!arm) return;
      arm.classList.remove("sickle-swing");
      void arm.getBoundingClientRect(); // force reflow so the browser re-runs it
      arm.classList.add("sickle-swing");
    };

    const setMoodFor = (next: Mood, ms: number) => {
      setMood(next);
      if (moodTimer.current) clearTimeout(moodTimer.current);
      moodTimer.current = setTimeout(() => setMood("idle"), ms);
    };

    useImperativeHandle(ref, () => ({
      react() {
        swing();
        // Mid-celebration the sickle keeps swinging, but the face stays happy.
        if (performance.now() < happyUntil.current) return;
        setMoodFor("wow", WOW_MS);
      },
      celebrate() {
        happyUntil.current = performance.now() + HAPPY_MS;
        setMoodFor("happy", HAPPY_MS);
      },
      sicklePoint() {
        const blade = bladeRef.current;
        if (!blade) return null;
        const r = blade.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
    }));

    // viewBox height is 426, NOT 512: his soles sit at y≈425, so the box now ends
    // exactly AT his feet with no dead space beneath them. The game pins this
    // element's bottom EDGE to the pile surface, so cropping the box to the sole
    // line makes "bottom edge" and "feet" the same thing and he stands ON the rice.
    // A square 512 box left ~17% of empty space below him and he hovered by that
    // much (~76px at desktop size).
    //
    // The caller MUST size this by WIDTH only (w-40, no h-*). Forcing a square
    // height would letterbox the 512×426 art inside it and put the gap straight
    // back. Height then follows from the viewBox aspect automatically.
    return (
      <svg
        viewBox="0 0 512 426"
        className={className}
        role="img"
        aria-label="One Grain of Rice farmer mascot"
      >
        {/* ---- body ---- */}
        <ellipse cx="256" cy="258" rx="82" ry="146" fill={BODY} stroke={INK} strokeWidth="9" />
        {/* soft highlight down the left flank, as in the original */}
        <path
          d="M205 175 Q193 230 199 285"
          fill="none"
          stroke="#fff"
          strokeWidth="9"
          strokeLinecap="round"
          opacity="0.75"
        />

        {/* ---- feet ---- */}
        <ellipse cx="230" cy="412" rx="27" ry="13" fill={INK} />
        <ellipse cx="282" cy="412" rx="27" ry="13" fill={INK} />

        {/* ---- left arm (free hand) ---- */}
        <path
          d="M178 300 Q142 322 132 358"
          fill="none"
          stroke={INK}
          strokeWidth="8"
          strokeLinecap="round"
        />

        {/* ---- right arm + sickle: ONE group, pivoting at the shoulder, so the
               whole arm swings the blade rather than the blade detaching ---- */}
        <g
          ref={armRef}
          className="sickle-arm"
          style={{ transformBox: "view-box", transformOrigin: "334px 298px" }}
        >
          <path
            d="M334 298 Q372 318 384 344"
            fill="none"
            stroke={INK}
            strokeWidth="8"
            strokeLinecap="round"
          />
          {/* wooden handle */}
          <path
            d="M382 350 L404 312"
            stroke={WOOD}
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path
            d="M382 350 L404 312"
            stroke={INK}
            strokeWidth="14"
            strokeLinecap="round"
            opacity="0.18"
          />
          {/* crescent blade, hooking up and back over the handle */}
          <path
            ref={bladeRef}
            d="M402 312 C441 300 462 258 448 214 C446 262 424 292 392 300 Z"
            fill={BLADE}
            stroke={INK}
            strokeWidth="6"
            strokeLinejoin="round"
          />
        </g>

        {/* ---- face ---- */}
        <ellipse cx="212" cy="278" rx="14" ry="11" fill={BLUSH} />
        <ellipse cx="300" cy="278" rx="14" ry="11" fill={BLUSH} />

        {mood === "wow" && (
          <>
            {/* wide eyes */}
            <circle cx="228" cy="238" r="16" fill={BODY} stroke={INK} strokeWidth="5" />
            <circle cx="284" cy="238" r="16" fill={BODY} stroke={INK} strokeWidth="5" />
            <circle cx="228" cy="240" r="8" fill={INK} />
            <circle cx="284" cy="240" r="8" fill={INK} />
            {/* open "wow" mouth */}
            <ellipse cx="256" cy="303" rx="14" ry="18" fill={INK} />
          </>
        )}

        {mood === "happy" && (
          <>
            {/* wide OPEN sparkling eyes — beaming, not squeezed shut */}
            <circle cx="228" cy="238" r="17" fill={BODY} stroke={INK} strokeWidth="5" />
            <circle cx="284" cy="238" r="17" fill={BODY} stroke={INK} strokeWidth="5" />
            <circle cx="228" cy="240" r="10" fill={INK} />
            <circle cx="284" cy="240" r="10" fill={INK} />
            <circle cx="233" cy="234" r="4" fill="#fff" />
            <circle cx="289" cy="234" r="4" fill="#fff" />
            {/* big open beaming grin, with a tongue */}
            <path
              d="M218 290 Q256 344 294 290 Z"
              fill={INK}
              stroke={INK}
              strokeWidth="7"
              strokeLinejoin="round"
            />
            <path d="M243 320 Q256 338 269 320 Z" fill="#E8798B" />
          </>
        )}

        {mood === "idle" && (
          <>
            <circle cx="228" cy="240" r="9" fill={INK} />
            <circle cx="284" cy="240" r="9" fill={INK} />
            <path
              d="M228 293 Q256 316 284 293"
              fill="none"
              stroke={INK}
              strokeWidth="7"
              strokeLinecap="round"
            />
          </>
        )}

        {/* ---- conical straw hat (drawn last so it sits over the head) ----
             ONE closed path: the two cone sides, then the brim's bottom arc back
             to the start. Drawing the brim as a separate ellipse leaves its top
             arc stroked across the middle of the cone; folding both into a single
             outline means there is no internal edge to show through. */}
        <g>
          <path
            d="M138 130
               Q205 96 256 40
               Q307 96 374 130
               A118 22 0 0 1 138 130 Z"
            fill={STRAW}
            stroke={INK}
            strokeWidth="8"
            strokeLinejoin="round"
          />
          {/* woven straw seams, fanning from the crown down to the brim */}
          <path
            d="M256 54 L192 124 M256 54 L320 124 M256 54 L256 128"
            stroke={STRAW_DARK}
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.75"
          />
        </g>
      </svg>
    );
  },
);
