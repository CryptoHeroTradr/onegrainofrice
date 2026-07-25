"use client";

import { useEffect, useState } from "react";
import type { Meme } from "@/config/memes";
import { fetchPoolMemes } from "@/lib/mediaPool";

/**
 * The meme deck: the shared media pool if it answers, the hardcoded deck if it
 * does not.
 *
 * It starts on `fallback` and only ever moves off it on success, which means:
 *
 *  - the server renders the hardcoded deck, so there is no blank first paint and
 *    no hydration mismatch — the client starts from exactly what the server sent;
 *  - a pool that is down, slow, empty or malformed is indistinguishable from a
 *    pool that does not exist. The site just keeps showing the memes it shipped
 *    with, and nobody sees an error.
 *
 * Fetched once per mount. The manifest is served `no-cache`, so a reload always
 * sees the current pool — which is what makes "add a meme, no deploy" true — but
 * a meme added while the tab is open does not appear until the next navigation.
 * That is the right trade: polling a live site forever to catch a rare curation
 * event is a lot of requests to save one refresh.
 */
export function usePoolMemes(fallback: Meme[]): Meme[] {
  const [memes, setMemes] = useState<Meme[]>(fallback);

  useEffect(() => {
    const ctrl = new AbortController();

    void fetchPoolMemes(ctrl.signal).then((pool) => {
      // null = any failure at all. Keep the fallback; say nothing.
      if (pool) setMemes(pool);
    });

    return () => ctrl.abort();
  }, []);

  return memes;
}
