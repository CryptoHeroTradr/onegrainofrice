"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import type { EmblaCarouselType, EmblaEventType } from "embla-carousel";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StickerCard } from "@/components/primitives/StickerCard";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { site } from "@/config/site";
import type { Meme } from "@/config/memes";

/** Coverflow tuning — how hard the deck bends around the center card. */
const MAX_ROTATE_Y = 35; // deg
const MIN_SCALE = 0.8;
const MAX_TRANSLATE_Z = -120; // px
const MIN_OPACITY = 0.6;

/** Deterministic sticker tilt so SSR and client agree (no Math.random). */
const TILTS = [-2.5, 1.5, -1, 2, -1.5, 2.5, -2];

/**
 * Presentational. It renders the deck it is handed and fetches nothing.
 *
 * It used to fetch the pool itself, which meant the meme wall had two sources of
 * truth — the carousel on the pool, the collage on the hardcoded list — and a meme
 * removed by an admin would disappear from one and survive in the other. The fetch
 * now happens once, in MemeWallSurfaces, and every surface is fed from it.
 *
 * @param memes The deck to render: pool memes, or the hardcoded fallback.
 */
export function MemeCarousel({ memes: deck }: { memes: Meme[] }) {
  const reducedMotion = usePrefersReducedMotion();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tweenNodes = useRef<HTMLElement[]>([]);

  const plugins = useMemo(
    () =>
      site.memeWall.autoplay && !reducedMotion
        ? [
            Autoplay({
              delay: site.memeWall.autoplayDelayMs,
              stopOnInteraction: true,
              stopOnMouseEnter: true,
              stopOnFocusIn: true,
            }),
          ]
        : [],
    [reducedMotion],
  );

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, align: "center", skipSnaps: false },
    plugins,
  );

  const setTweenNodes = useCallback((api: EmblaCarouselType) => {
    tweenNodes.current = api
      .slideNodes()
      .map((slide) => slide.querySelector(".embla-slide-inner") as HTMLElement);
  }, []);

  /**
   * Rolodex depth: on every scroll frame, measure each slide's distance from
   * the center snap (loop-aware) and bend it back — scale, rotateY, translateZ,
   * opacity, z-index. Under reduced motion only opacity is tweened.
   */
  const tweenDepth = useCallback(
    (api: EmblaCarouselType, eventName?: EmblaEventType) => {
      const engine = api.internalEngine();
      const scrollProgress = api.scrollProgress();
      const slidesInView = api.slidesInView();
      const snapCount = api.scrollSnapList().length;

      api.scrollSnapList().forEach((scrollSnap, snapIndex) => {
        let diffToTarget = scrollSnap - scrollProgress;
        const slidesInSnap = engine.slideRegistry[snapIndex];

        slidesInSnap.forEach((slideIndex) => {
          if (eventName === "scroll" && !slidesInView.includes(slideIndex)) return;

          if (engine.options.loop) {
            engine.slideLooper.loopPoints.forEach((loopItem) => {
              const target = loopItem.target();
              if (slideIndex === loopItem.index && target !== 0) {
                const sign = Math.sign(target);
                if (sign === -1) diffToTarget = scrollSnap - (1 + scrollProgress);
                if (sign === 1) diffToTarget = scrollSnap + (1 - scrollProgress);
              }
            });
          }

          // Distance from center in slide units: 0 = centered, ±1 = neighbor.
          const dist = diffToTarget * snapCount;
          const t = Math.min(Math.abs(dist), 1);
          const node = tweenNodes.current[slideIndex];
          if (!node) return;

          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          node.style.opacity = String(1 - (1 - MIN_OPACITY) * t);
          node.style.transform = reduce
            ? "none"
            : `translateZ(${MAX_TRANSLATE_Z * t}px) rotateY(${
                Math.max(-1, Math.min(1, dist)) * MAX_ROTATE_Y
              }deg) scale(${1 - (1 - MIN_SCALE) * t})`;

          const slideNode = api.slideNodes()[slideIndex];
          slideNode.style.zIndex = String(100 - Math.round(Math.abs(dist) * 10));
        });
      });
    },
    [],
  );

  useEffect(() => {
    if (!emblaApi) return;

    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap());
    const onReInit = (api: EmblaCarouselType) => {
      setTweenNodes(api);
      tweenDepth(api);
      onSelect();
    };

    onReInit(emblaApi);
    emblaApi
      .on("reInit", onReInit)
      .on("scroll", tweenDepth)
      .on("slideFocus", tweenDepth)
      .on("select", onSelect);

    return () => {
      emblaApi.off("reInit", onReInit).off("scroll", tweenDepth).off("slideFocus", tweenDepth).off("select", onSelect);
    };
  }, [emblaApi, setTweenNodes, tweenDepth]);

  // The deck arrives asynchronously and is a different LENGTH than the fallback.
  // Embla measures its snap points once at init, so it must be told to remeasure —
  // otherwise it keeps the old count and the last slides are unreachable.
  useEffect(() => {
    emblaApi?.reInit();
  }, [emblaApi, deck]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext],
  );

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={`${site.ticker} meme wall`}
      onKeyDown={onKeyDown}
      className="relative"
    >
      <div className="carousel-3d overflow-hidden py-8 sm:py-10" ref={emblaRef}>
        <div className="embla-container flex touch-pan-y touch-pinch-zoom">
          {deck.map((meme, i) => (
            <div
              key={meme.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${deck.length}: ${meme.caption ?? meme.alt}`}
              className="embla-slide min-w-0 flex-[0_0_72%] px-3 sm:flex-[0_0_45%] sm:px-4 md:flex-[0_0_320px]"
            >
              <div className="embla-slide-inner">
                <StickerCard
                  src={meme.src}
                  alt={meme.alt}
                  caption={meme.caption}
                  rotation={meme.rotation ?? TILTS[i % TILTS.length]}
                  tape={i % 2 === 0}
                  variant={meme.photo ? "photo" : "cutout"}
                  aspect={meme.photo ? "aspect-[4/3]" : "aspect-[4/5]"}
                  srcIsFinal={meme.pooled}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="mt-2 flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={scrollPrev}
          aria-label="Previous meme"
          className="flex min-h-11 min-w-11 items-center justify-center border-2 border-olive text-olive transition-colors hover:bg-olive hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
        >
          <ChevronLeft size={24} aria-hidden="true" />
        </button>

        {/* Dot indicator */}
        <div className="flex items-center gap-1" aria-hidden="true">
          {deck.map((meme, i) => (
            <button
              key={meme.id}
              type="button"
              tabIndex={-1}
              onClick={() => scrollTo(i)}
              className={`h-2.5 w-2.5 rounded-full border border-olive transition-colors ${
                i === selectedIndex ? "bg-olive" : "bg-transparent"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={scrollNext}
          aria-label="Next meme"
          className="flex min-h-11 min-w-11 items-center justify-center border-2 border-olive text-olive transition-colors hover:bg-olive hover:text-bone focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
        >
          <ChevronRight size={24} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
