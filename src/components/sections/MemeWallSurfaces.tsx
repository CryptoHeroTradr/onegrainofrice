"use client";

import { MemeCollage, COLLAGE_SLOTS } from "@/components/MemeCollage";
import { MemeCarousel } from "@/components/MemeCarousel";
import { usePoolMemes } from "@/hooks/usePoolMemes";
import type { Meme } from "@/config/memes";

/**
 * ONE pool fetch, ONE fallback chain, for every surface on the meme wall.
 *
 * The carousel used to fetch the pool by itself while the collage stayed on the
 * hardcoded deck. That is not merely untidy, it is incorrect: once an admin can
 * remove a meme from a DM (Phase 8.5), a removal that only reaches the carousel is
 * not a removal. The meme vanishes from one surface and lives forever in the other,
 * and the button lies. Whatever is displayed anywhere must come from one source.
 *
 * So the fetch happens HERE, once, and the result is handed down. The collage and the
 * carousel are back to being what they should be: presentational components that
 * render the deck they are given.
 */
export function MemeWallSurfaces({ fallback }: { fallback: Meme[] }) {
  const deck = usePoolMemes(fallback);

  /**
   * The collage is a hand-placed band of exactly COLLAGE_SLOTS memes. A pool with
   * fewer than that cannot fill it without leaving holes in a designed layout, so it
   * takes a DETERMINISTIC slice when the pool can satisfy its shape, and the
   * hardcoded deck when it cannot.
   *
   * The slice is `deck.slice(0, n)` and the deck is ordered newest-first by the pool
   * client, so it is stable across renders (no shuffling on every paint) and a newly
   * curated meme lands in the band immediately.
   *
   * NOTE THE CONSEQUENCE, because it is a real gap and not a rounding error: while
   * the pool holds fewer than COLLAGE_SLOTS memes, the collage still shows the
   * hardcoded deck — so a meme removed from the pool WILL still appear there. The fix
   * is to keep at least COLLAGE_SLOTS memes in the pool, which is also just what the
   * band needs in order to look like itself.
   */
  const collage = deck.length >= COLLAGE_SLOTS ? deck.slice(0, COLLAGE_SLOTS) : fallback;

  return (
    <>
      {/* Row 1 — static collage */}
      <div className="mt-10">
        <MemeCollage memes={collage} />
      </div>

      {/* Row 2 — interactive carousel */}
      <div className="mt-10">
        <p className="mb-1 font-mono text-xs font-bold tracking-widest text-ink/50 uppercase">
          swipe the gallery →
        </p>
        <MemeCarousel memes={deck} />
      </div>
    </>
  );
}
