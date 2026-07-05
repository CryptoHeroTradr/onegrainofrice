"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StickerCard } from "@/components/primitives/StickerCard";
import { useRice } from "@/components/rice/RiceParticles";
import { plateTint, type Meme, type PlateTint } from "@/config/memes";

/**
 * Sushi-belt meme reel. On a fine pointer with motion allowed it auto-scrolls
 * as a seamless RAF-driven belt; hovering a plate eases the belt to ~15% and
 * pops that plate forward, and pointer-down lifts a plate (springs back on
 * release — tactile only, no state). Under reduced motion / coarse pointer it
 * degrades to an accessible, horizontally scrollable strip with 44px+ arrow
 * buttons and per-slide aria semantics (drag/swipe via native overflow scroll).
 *
 * Presentational: `memes` must arrive with already-resolved `src` (the server
 * wrapper SushiBeltSection does the placeholder resolution).
 */

const BELT_SPEED = 42; // px/s steady
const HOVER_FACTOR = 0.15;
const EASE = 8; // speed lerp responsiveness

function Plate({
  meme,
  tint,
  index,
  count,
  onGrab,
}: {
  meme: Meme;
  tint: PlateTint;
  index: number;
  count: number;
  onGrab?: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`belt-plate belt-plate-${tint} shrink-0`}
      data-grab
      onPointerDown={onGrab}
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${count}: ${meme.caption ?? meme.alt}`}
    >
      <div className="belt-dish" aria-hidden="true" />
      <div className="belt-meme">
        <StickerCard
          src={meme.src}
          alt={meme.alt}
          caption={meme.caption}
          tape={false}
          variant={meme.photo ? "photo" : "cutout"}
          aspect={meme.photo ? "aspect-[4/3]" : "aspect-[4/5]"}
          sizes="180px"
        />
      </div>
    </div>
  );
}

export function SushiBelt({ memes }: { memes: Meme[] }) {
  const beltMemes = memes.filter((m) => m.belt !== false);
  const [animated, setAnimated] = useState(false); // SSR + reduced/touch default: strip
  const { pour } = useRice();

  // Eligibility: fine pointer + motion allowed → animated belt.
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAnimated(fine.matches && !reduce.matches);
    update();
    fine.addEventListener("change", update);
    reduce.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      reduce.removeEventListener("change", update);
    };
  }, []);

  return animated ? (
    <BeltAnimated memes={beltMemes} pour={pour} />
  ) : (
    <BeltStrip memes={beltMemes} />
  );
}

/* -------------------------------------------------------------------------- */
/* Animated belt (RAF, seamless loop)                                          */
/* -------------------------------------------------------------------------- */
function BeltAnimated({
  memes,
  pour,
}: {
  memes: Meme[];
  pour: (o: { x: number; y: number; count?: number }) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const curSpeed = useRef(BELT_SPEED);
  const targetSpeed = useRef(BELT_SPEED);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const copyWidth = useRef(0);
  const grabbing = useRef(false);

  const measure = useCallback(() => {
    if (copyRef.current) copyWidth.current = copyRef.current.offsetWidth;
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);

    const frame = (now: number) => {
      if (lastRef.current === 0) lastRef.current = now;
      let dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (dt > 0.1) dt = 0.1;
      curSpeed.current += (targetSpeed.current - curSpeed.current) * Math.min(1, dt * EASE);
      offsetRef.current -= curSpeed.current * dt;
      const w = copyWidth.current;
      if (w > 0) {
        while (offsetRef.current <= -w) offsetRef.current += w;
        while (offsetRef.current > 0) offsetRef.current -= w;
      }
      if (trackRef.current) {
        trackRef.current.style.transform = `translate3d(${offsetRef.current}px,0,0)`;
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener("resize", measure);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [measure]);

  const setTarget = () => {
    targetSpeed.current = grabbing.current ? 0 : hoverActive.current ? BELT_SPEED * HOVER_FACTOR : BELT_SPEED;
  };
  const hoverActive = useRef(false);

  const onPlateEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    hoverActive.current = true;
    setTarget();
    e.currentTarget.classList.add("belt-plate-pop");
  };
  const onPlateLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    hoverActive.current = false;
    setTarget();
    e.currentTarget.classList.remove("belt-plate-pop");
  };

  // Pinch-grab: lift the plate to follow the cursor, spring back on release.
  const onGrab = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    grabbing.current = true;
    setTarget();
    el.style.transition = "none";
    el.style.zIndex = "60";
    pour({ x: e.clientX, y: e.clientY, count: 12 });

    const move = (ev: PointerEvent) => {
      el.style.transform = `translate(${ev.clientX - startX}px, ${ev.clientY - startY}px) scale(1.1)`;
    };
    const up = () => {
      grabbing.current = false;
      setTarget();
      el.style.transition = "transform 420ms cubic-bezier(0.34,1.56,0.64,1)";
      el.style.transform = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.setTimeout(() => {
        el.style.zIndex = "";
        el.style.transition = "";
      }, 460);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
  };

  // Two identical copies → seamless wrap at one-copy width.
  const renderCopy = (copyIndex: number) => (
    <div
      ref={copyIndex === 0 ? copyRef : undefined}
      className="belt-copy"
      aria-hidden={copyIndex === 1 ? true : undefined}
    >
      {memes.map((m, i) => (
        <div key={`${copyIndex}-${m.id}`} onMouseEnter={onPlateEnter} onMouseLeave={onPlateLeave}>
          <Plate meme={m} tint={plateTint(m, i)} index={i} count={memes.length} onGrab={onGrab} />
        </div>
      ))}
    </div>
  );

  return (
    <div
      className="belt-viewport belt-conveyor"
      role="group"
      aria-roledescription="carousel"
      aria-label="$RICE meme sushi belt"
    >
      <div ref={trackRef} className="belt-track">
        {renderCopy(0)}
        {renderCopy(1)}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reduced-motion / touch strip (accessible, arrow + keyboard)                 */
/* -------------------------------------------------------------------------- */
function BeltStrip({ memes }: { memes: Meme[] }) {
  const stripRef = useRef<HTMLDivElement>(null);

  const scrollByPlate = (dir: 1 | -1) => {
    const strip = stripRef.current;
    if (!strip) return;
    const first = strip.querySelector<HTMLElement>(".belt-plate");
    const amount = first ? first.offsetWidth + 24 : strip.clientWidth * 0.8;
    strip.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  return (
    <div
      className="belt-conveyor relative"
      role="group"
      aria-roledescription="carousel"
      aria-label="$RICE meme sushi belt"
    >
      <div ref={stripRef} className="belt-strip">
        {memes.map((m, i) => (
          <div key={m.id} onPointerDown={undefined}>
            <Plate meme={m} tint={plateTint(m, i)} index={i} count={memes.length} />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={() => scrollByPlate(-1)}
          aria-label="Previous meme"
          className="flex min-h-11 min-w-11 items-center justify-center border-2 border-porcelain text-porcelain transition-colors hover:bg-porcelain hover:text-steamed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-porcelain"
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => scrollByPlate(1)}
          aria-label="Next meme"
          className="flex min-h-11 min-w-11 items-center justify-center border-2 border-porcelain text-porcelain transition-colors hover:bg-porcelain hover:text-steamed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-porcelain"
        >
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
