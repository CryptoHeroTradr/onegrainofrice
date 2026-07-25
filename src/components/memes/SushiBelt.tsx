"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StickerCard } from "@/components/primitives/StickerCard";
import { useRice } from "@/components/rice/RiceParticles";
import { asset } from "@/lib/asset";
import { isSoundOn, subscribeSound } from "@/lib/sound";
import { plateTint, type Meme, type PlateTint } from "@/config/memes";

/**
 * Sushi-belt meme reel. Whenever motion is allowed it auto-scrolls as a seamless
 * RAF-driven belt — on touch devices too, so mobile rides the same moving belt
 * as desktop. Drag (mouse) or swipe (touch) grabs the belt and scrubs it, and a
 * flick coasts on inertia, so you can browse far more memes than the 42px/s
 * auto-scroll delivers; letting go resumes the auto-scroll. On desktop, hovering
 * a plate also eases the belt to ~15% and pops that plate forward. Under reduced
 * motion it degrades to an accessible, horizontally scrollable strip with 44px+
 * arrow buttons and per-slide aria.
 *
 * Presentational: `memes` must arrive with already-resolved `src` (the server
 * wrapper SushiBeltSection does the placeholder resolution).
 */

const BELT_SPEED = 42; // px/s steady
const HOVER_FACTOR = 0.15;
const EASE = 8; // speed lerp responsiveness

/** How many plates load eagerly (no lazy-load wait) as soon as the belt renders. */
const EAGER_PLATES = 10;
/** Past this much movement a pointer gesture counts as a drag, not a click. */
const DRAG_THRESHOLD = 6;
/** Flick inertia: cap (px/s) and per-frame decay, so a fast swipe coasts. */
const MAX_FLICK = 2600;
const FLICK_DECAY = 0.94;

/** A belt item — a curated/config meme, optionally carrying a video to autoplay. */
type BeltMeme = Meme & { videoSrc?: string; poster?: string };

function Plate({
  meme,
  tint,
  index,
  count,
  onOpen,
  onError,
  priority = false,
}: {
  meme: BeltMeme;
  tint: PlateTint;
  index: number;
  count: number;
  /** Open the full, uncropped meme in the lightbox (click / tap). */
  onOpen?: (meme: BeltMeme) => void;
  /** Fired if this meme's image/video fails to load (belt then skips it). */
  onError?: () => void;
  /** Load this plate's image eagerly (the first screenful — no lazy wait). */
  priority?: boolean;
}) {
  return (
    <div
      className={`belt-plate belt-plate-${tint} shrink-0`}
      data-grab
      onClick={() => onOpen?.(meme)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.(meme);
        }
      }}
      aria-label={`View meme ${index + 1} of ${count}: ${meme.caption ?? meme.alt}`}
    >
      <div className="belt-dish" aria-hidden="true" />
      <div className="belt-meme">
        {/* No `caption` (that renders the olive overlay bar over the art) and no
            `videoSrc`: a belt plate is always a still. Video memes are 12–13MB
            each and the belt would stream every one of them, so plates show the
            ~10KB thumbnail instead — the video itself only loads in the lightbox
            when you actually click the meme. Keeps the reel to just the memes. */}
        <StickerCard
          src={meme.src}
          alt={meme.alt}
          tape={false}
          variant={meme.photo ? "photo" : "cutout"}
          aspect={meme.photo ? "aspect-[4/3]" : "aspect-[4/5]"}
          sizes="360px"
          priority={priority}
          onError={onError}
          // Media-pool memes are already final URLs: content-addressed, served from
          // the server root, cached immutable. asset() would prefix a basePath they
          // do not live under and stamp ?v=<build> onto a file that cannot change.
          srcIsFinal={meme.pooled}
        />
      </div>
    </div>
  );
}

// Total memes riding the belt (it loops, so this is a teaser reel, not the full
// 300+ — keeps the homepage light). Pulled a few per topic then mixed.
const BELT_LIMIT = 24;
const PER_CATEGORY = 6;
// The belt LEADS with Pop Culture: the first POP_LEAD plates are pop-culture, so
// everything eagerly loaded (EAGER_PLATES) is pop-culture, and the topic-diverse
// mix follows behind it. The belt is a 24-plate loop and can't hold all 94
// pop-culture images — the full set leads the /memes gallery instead, which the
// API now sorts pop-culture-first.
const LEAD_CATEGORY = "pop-culture";
const POP_LEAD = 12;

/** A media item from the /api/telegram-media feed (same shape the gallery uses). */
interface TgMedia {
  id: string;
  mediaType: "photo" | "video" | "animation";
  fileUrl: string;
  thumbUrl?: string | null;
  caption: string | null;
}

function isMotion(m: TgMedia): boolean {
  return m.mediaType === "video" || m.mediaType === "animation";
}

/**
 * Is this item light enough for the belt?
 *
 * The API exposes no file size, and probing each one costs an upstream round
 * trip — far too slow for a reel that has to paint immediately. But size tracks
 * media type almost perfectly here: photos run ~80KB while videos are 12–13MB,
 * and every video ships a ~10KB thumbnail. So the belt takes photos as-is and
 * represents videos by their thumbnail, which keeps every plate three orders of
 * magnitude under the 8MB ceiling. A video with NO thumbnail is dropped outright
 * rather than falling back to its multi-megabyte source file.
 */
function fitsBelt(m: TgMedia): boolean {
  return isMotion(m) ? !!m.thumbUrl : !!m.fileUrl;
}

/**
 * Map a gallery media item to a belt meme. Every plate is a still: photos use
 * their file, videos/GIFs their thumbnail. `videoSrc` is still carried so the
 * lightbox can play the real video on click — the belt just never streams it.
 */
function toBeltMeme(m: TgMedia): BeltMeme {
  const motion = isMotion(m);
  return {
    id: m.id,
    // /api/telegram-media/... paths — StickerCard runs them through asset().
    src: (motion ? m.thumbUrl : m.fileUrl) as string,
    ...(motion ? { videoSrc: m.fileUrl, poster: m.thumbUrl ?? undefined } : {}),
    alt: m.caption ?? "community meme",
    caption: m.caption ?? undefined,
    photo: true, // gallery memes are rectangular → framed treatment
  };
}

/** Fisher–Yates shuffle (client-side; Math.random is fine outside workflows). */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Fetch one page of a topic. The "videos" chip is a media-type filter. */
async function fetchTopic(category: string, limit: number, page: number): Promise<TgMedia[]> {
  const q =
    category === "videos"
      ? `type=video&limit=${limit}&page=${page}`
      : `category=${encodeURIComponent(category)}&limit=${limit}&page=${page}`;
  try {
    const r = await fetch(asset(`/api/telegram-media?${q}`));
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.media) ? (d.media as TgMedia[]) : [];
  } catch {
    return [];
  }
}

/**
 * Build the belt: Pop Culture leads, then a topic-diverse tail.
 *
 * The head is POP_LEAD pop-culture images (from a random page, so the reel isn't
 * identical every visit) — these are the plates that eager-load. Behind them
 * sits the original mix: a few items from a random page of every OTHER non-empty
 * topic (memes, videos, lore, sports, politics…), shuffled, so the belt still
 * spans every channel rather than just the newest posts.
 */
async function loadDiverseMemes(): Promise<BeltMeme[]> {
  const catRes = await fetch(asset(`/api/telegram-media?limit=1`));
  if (!catRes.ok) return [];
  const catData = await catRes.json();
  const categories: Array<{ category: string; count: number }> = Array.isArray(catData.categories)
    ? catData.categories
    : [];
  const active = categories.filter((c) => c.count > 0);
  if (!active.length) return [];

  const lead = active.find((c) => c.category === LEAD_CATEGORY);
  const others = active.filter((c) => c.category !== LEAD_CATEGORY);

  const [leadItems, perTopic] = await Promise.all([
    lead
      ? fetchTopic(
          LEAD_CATEGORY,
          POP_LEAD,
          1 + Math.floor(Math.random() * Math.max(1, Math.ceil(lead.count / POP_LEAD))),
        )
      : Promise.resolve([] as TgMedia[]),
    Promise.all(
      others.map((c) =>
        fetchTopic(
          c.category,
          PER_CATEGORY,
          1 + Math.floor(Math.random() * Math.max(1, Math.ceil(c.count / PER_CATEGORY))),
        ),
      ),
    ),
  ]);

  const seen = new Set<string>();
  const take = (m: TgMedia) => {
    if (seen.has(m.id) || !fitsBelt(m)) return false; // no thumb → would pull the full video
    seen.add(m.id);
    return true;
  };

  // Head: pop culture, in feed order, so it's what loads first.
  const belt: TgMedia[] = leadItems.filter(take).slice(0, POP_LEAD);

  // Tail: everything else, shuffled, filling the rest of the belt.
  const tail = perTopic.flat().filter(take);
  belt.push(...shuffle(tail).slice(0, Math.max(0, BELT_LIMIT - belt.length)));

  return belt.map(toBeltMeme);
}

export function SushiBelt({ memes }: { memes: Meme[] }) {
  // `memes` (curated, resolved server-side) is the SSR/no-JS fallback. On mount
  // we upgrade to a topic-diverse random mix of the SAME memes shown on the
  // /memes gallery page (the live @ricecontent Telegram feed).
  const [list, setList] = useState<BeltMeme[]>(memes);
  const [animated, setAnimated] = useState(false); // SSR + reduced-motion default: strip
  const [openMeme, setOpenMeme] = useState<BeltMeme | null>(null);
  // Ids whose image/video failed to load — skipped so no broken plates show.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const markFailed = useCallback((id: string) => {
    setFailed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const { pour } = useRice();

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const mixed = await loadDiverseMemes();
        if (!ignore && mixed.length) setList(mixed);
      } catch {
        // Feed unreachable — keep the curated fallback already on screen.
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, []);

  const beltMemes = list.filter((m) => m.belt !== false && !failed.has(m.id));

  // Auto-scroll whenever motion is allowed — on touch devices too (mobile now
  // rides the same animated belt as desktop). Reduced-motion falls back to the
  // accessible arrow strip.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAnimated(!reduce.matches);
    update();
    reduce.addEventListener("change", update);
    return () => reduce.removeEventListener("change", update);
  }, []);

  return (
    <>
      {animated ? (
        <BeltAnimated memes={beltMemes} pour={pour} onOpen={setOpenMeme} onError={markFailed} />
      ) : (
        <BeltStrip memes={beltMemes} onOpen={setOpenMeme} onError={markFailed} />
      )}
      {openMeme && <BeltLightbox meme={openMeme} onClose={() => setOpenMeme(null)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Lightbox — reveal the FULL, uncropped image/video on click                  */
/* -------------------------------------------------------------------------- */
function BeltLightbox({ meme, onClose }: { meme: BeltMeme; onClose: () => void }) {
  // Global site sound state (the header mute toggle). The opened video plays with
  // sound ONLY when the site is unmuted; otherwise it stays muted. Inline belt
  // videos are always muted regardless (see StickerCard).
  const soundOn = useSyncExternalStore(subscribeSound, isSoundOn, () => false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Apply the desired mute state to the actual element (React's `muted` prop is
  // unreliable) and (re)start playback, falling back to muted if the browser
  // blocks unmuted autoplay.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !soundOn;
    const p = v.play();
    if (p) {
      p.catch(() => {
        v.muted = true;
        void v.play().catch(() => {});
      });
    }
  }, [soundOn]);

  // Portal to <body> so the overlay escapes the #memes section's
  // `.grain-paper > *` rule (which forces position:relative on direct children)
  // and any transformed belt ancestors — otherwise it lays out below the belt.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 p-4 sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="fixed right-4 top-4 z-[110] flex h-11 w-11 items-center justify-center rounded-full border border-khaki/70 bg-black/60 text-xl text-khaki transition-colors hover:bg-khaki/20"
      >
        ✕
      </button>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-full max-w-full flex-col items-center">
        {meme.videoSrc ? (
          <video
            ref={videoRef}
            src={asset(meme.videoSrc)}
            poster={meme.poster ? asset(meme.poster) : undefined}
            controls
            loop
            playsInline
            className="max-h-[82vh] max-w-[92vw] rounded-lg border border-khaki/40 object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset(meme.src)}
            alt={meme.alt}
            className="max-h-[82vh] max-w-[92vw] rounded-lg border border-khaki/40 object-contain"
          />
        )}
        {meme.caption && (
          <p className="mt-4 max-w-2xl text-center font-mono text-sm text-bone">{meme.caption}</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Animated belt (RAF, seamless loop)                                          */
/* -------------------------------------------------------------------------- */
function BeltAnimated({
  memes,
  pour,
  onOpen,
  onError,
}: {
  memes: BeltMeme[];
  pour: (o: { x: number; y: number; count?: number }) => void;
  onOpen: (meme: BeltMeme) => void;
  onError: (id: string) => void;
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
  const dragged = useRef(false); // a real drag happened → suppress the click-open

  // Drag/swipe scrub state.
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const lastMoveX = useRef(0);
  const lastMoveT = useRef(0);
  const velocity = useRef(0); // px/s, sampled during the drag
  const inertia = useRef(0); // px/s, coasting after release

  const measure = useCallback(() => {
    if (copyRef.current) copyWidth.current = copyRef.current.offsetWidth;
  }, []);

  // The track is two identical copies, so any offset is equivalent to offset ± w.
  // Normalising into (-w, 0] keeps the numbers bounded and lets a drag jump the
  // seam without a visible snap.
  const wrap = useCallback((v: number) => {
    const w = copyWidth.current;
    if (w <= 0) return v;
    let x = v % w;
    if (x > 0) x -= w;
    return x;
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);

    const frame = (now: number) => {
      if (lastRef.current === 0) lastRef.current = now;
      let dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (dt > 0.1) dt = 0.1;

      // While the pointer is down the offset is driven directly by the drag
      // handler; the belt only self-advances (and coasts) when released.
      if (!grabbing.current) {
        curSpeed.current += (targetSpeed.current - curSpeed.current) * Math.min(1, dt * EASE);
        let delta = -curSpeed.current * dt;
        if (Math.abs(inertia.current) > 1) {
          delta += inertia.current * dt;
          inertia.current *= Math.pow(FLICK_DECAY, dt * 60);
        } else {
          inertia.current = 0;
        }
        offsetRef.current = wrap(offsetRef.current + delta);
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
  }, [measure, wrap]);

  // Re-measure the single-copy width whenever the deck changes (e.g. the gallery
  // mix loads in over the curated fallback), so the seamless loop wraps correctly.
  useEffect(() => {
    measure();
  }, [memes, measure]);

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

  // Drag / swipe to scrub the belt. Works for mouse, touch and pen alike: the
  // pointer grabs the whole track and scrolls it, and a flick coasts on inertia,
  // so you can fly through the reel far faster than the 42px/s auto-scroll. The
  // belt resumes auto-scrolling the moment you let go.
  //
  // touch-action: pan-y (set on the viewport) means the browser keeps vertical
  // scrolling for itself while handing us horizontal gestures — so swiping the
  // belt sideways never fights scrolling the page down.
  // Deliberately NOT using setPointerCapture: capturing retargets pointerup to
  // the viewport, which would move the synthesised `click` off the plate and
  // break tap-to-open-the-lightbox. Window listeners give us the same
  // drag-outside-the-element behaviour while leaving click dispatch alone.
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return; // primary button only
    grabbing.current = true;
    dragged.current = false;
    dragStartX.current = e.clientX;
    dragStartOffset.current = offsetRef.current;
    lastMoveX.current = e.clientX;
    lastMoveT.current = performance.now();
    velocity.current = 0;
    inertia.current = 0;
    setTarget();
    pour({ x: e.clientX, y: e.clientY, count: 8 });

    const move = (ev: PointerEvent) => {
      if (!grabbing.current) return;
      const dx = ev.clientX - dragStartX.current;
      if (Math.abs(dx) > DRAG_THRESHOLD) dragged.current = true;

      // Recompute from the grab anchor each move (absolute, not incremental), so
      // wrapping across the seam can't accumulate drift.
      offsetRef.current = wrap(dragStartOffset.current + dx);

      const now = performance.now();
      const dt = (now - lastMoveT.current) / 1000;
      if (dt > 0) {
        velocity.current = (ev.clientX - lastMoveX.current) / dt;
        lastMoveX.current = ev.clientX;
        lastMoveT.current = now;
      }
    };

    const up = () => {
      grabbing.current = false;
      // A stale sample (finger held still before lifting) shouldn't fling the belt.
      const idle = performance.now() - lastMoveT.current > 120;
      inertia.current = idle ? 0 : Math.max(-MAX_FLICK, Math.min(MAX_FLICK, velocity.current));
      setTarget();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    window.addEventListener("pointercancel", up, { passive: true });
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
          <Plate
            meme={m}
            tint={plateTint(m, i)}
            index={i}
            count={memes.length}
            // Eager-load the first screenful of the real copy so the belt is
            // populated the moment the page paints. The duplicate copy (which
            // only exists to make the loop seamless) always lazy-loads.
            priority={copyIndex === 0 && i < EAGER_PLATES}
            onOpen={(mm) => {
              if (!dragged.current) onOpen(mm);
            }}
            onError={() => onError(m.id)}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div
      className="belt-viewport belt-conveyor belt-draggable"
      role="group"
      aria-roledescription="carousel"
      aria-label="$RICE meme sushi belt — drag or swipe to browse"
      onPointerDown={onDragStart}
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
function BeltStrip({
  memes,
  onOpen,
  onError,
}: {
  memes: BeltMeme[];
  onOpen: (meme: BeltMeme) => void;
  onError: (id: string) => void;
}) {
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
          <div key={m.id}>
            <Plate
              meme={m}
              tint={plateTint(m, i)}
              index={i}
              count={memes.length}
              priority={i < EAGER_PLATES}
              onOpen={onOpen}
              onError={() => onError(m.id)}
            />
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
