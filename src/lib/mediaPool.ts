/**
 * The shared rice media pool — a READ-ONLY consumer.
 *
 * The pool is one folder on the VPS, served by nginx at /media/ straight off
 * disk. It is the same folder the buy bot posts from, which is the whole point:
 * a meme curated once shows up in the bot AND on this site, with no deploy.
 *
 * This site never writes to the pool and knows nothing about what fills it.
 * It fetches a manifest and renders what it finds.
 *
 *   /media/manifest.json        the index. Cache-Control: no-cache (it mutates).
 *   /media/<tier>/<sha256>.<ext>  the bytes. Immutable, cached for a year.
 *
 * THE FALLBACK IS THE POINT. Every failure here returns null, and the caller
 * keeps rendering the hardcoded deck in src/config/memes.ts. A live site must
 * not go blank because a JSON file on another path is briefly unavailable — a
 * bad deploy of the bot, a half-second of nginx reload, a corrupt write, an
 * empty pool: all of them render the old memes, none of them render nothing.
 */
import type { Meme } from "@/config/memes";

/** Kept in lockstep with the generator (scripts/build-manifest.ts in RiceBuybot). */
type Tier = "regular" | "big" | "whale" | "massive";
type MediaKind = "photo" | "animation" | "video";

interface ManifestItem {
  sha256: string;
  tier: Tier;
  /** Relative to the pool ROOT, so it carries a leading `<mint>/` segment. */
  rel_path: string;
  /** The name the meme was curated under. A hint for humans; never an identity. */
  label?: string;
  kind: MediaKind;
  bytes: number;
  width: number;
  height: number;
  duration_ms?: number;
  added_at: number;
}

interface Manifest {
  version: number;
  mint: string;
  count: number;
  items: ManifestItem[];
}

export const MANIFEST_URL = "/media/manifest.json";

/**
 * The carousel renders each slide as an <img>. That is fine for stills and GIFs
 * and NOT fine for .mp4/.webm, which need a <video> element — so those are left
 * out rather than rendered as a broken image. They are pool media for Telegram,
 * where the bot sends them as a video; they are not carousel material.
 */
const RENDERABLE = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/**
 * Duck-type the payload before trusting it.
 *
 * `fetch` resolving is not the same as "the server sent a manifest". nginx could
 * serve an HTML error page with a 200, a half-written file could parse into
 * nonsense, or a future generator could change the shape. Anything that is not
 * recognisably a manifest is treated as a failed fetch, which means: fall back.
 */
function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<Manifest>;
  if (!Array.isArray(m.items)) return false;
  return m.items.every(
    (i) =>
      typeof i === "object" &&
      i !== null &&
      typeof (i as ManifestItem).sha256 === "string" &&
      typeof (i as ManifestItem).rel_path === "string" &&
      typeof (i as ManifestItem).tier === "string",
  );
}

/**
 * The public URL of a pool item.
 *
 * `rel_path` is relative to the pool root (`<mint>/massive/<sha>.gif`) but nginx
 * aliases /media/ at the MINT directory, so the mint segment is already implied
 * by the URL and must be dropped. Deriving the URL from `tier` + filename would
 * work too; taking it from rel_path keeps the manifest the single source of truth
 * about where a file actually lives.
 */
function urlOf(item: ManifestItem): string {
  const withoutMint = item.rel_path.split("/").slice(1).join("/");
  return `/media/${withoutMint}`;
}

function extOf(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  return dot === -1 ? "" : relPath.slice(dot).toLowerCase();
}

/**
 * A pool item as the carousel wants it.
 *
 * `id` is the sha256: stable across a rename or a re-tier, and unique, which is
 * exactly what React keys want. `alt` falls back to the label, then to the tier —
 * an empty alt on a meme is an accessibility hole, and the pool cannot promise a
 * caption for every file.
 */
function toMeme(item: ManifestItem): Meme {
  return {
    id: item.sha256,
    src: urlOf(item),
    alt: item.label ? `$RICE meme: ${item.label.replace(/\.[^.]+$/, "")}` : `$RICE ${item.tier} meme`,
    // Pool art is arbitrary — photos, screenshots, GIFs — not the transparent
    // cut-outs the "cutout" treatment is designed for. The framed photo card is
    // the honest container for it.
    photo: true,
    // Final URL: skip asset(). See the Meme type, and StickerCard's srcIsFinal.
    pooled: true,
  };
}

/**
 * Fetch the pool deck. Returns null on ANY failure — network, HTTP, bad JSON,
 * wrong shape, or an empty pool — and null means "use the hardcoded list".
 *
 * An EMPTY pool counts as a failure on purpose. A manifest with zero items is a
 * perfectly valid manifest (the pool starts empty, and it is emptied whenever it
 * is being reseeded), but rendering it would leave a live carousel with nothing
 * in it. "Valid but empty" and "unavailable" want the same answer here: show the
 * memes we shipped with.
 */
export async function fetchPoolMemes(signal?: AbortSignal): Promise<Meme[] | null> {
  try {
    const res = await fetch(MANIFEST_URL, { signal, cache: "no-store" });
    if (!res.ok) return null;

    const raw: unknown = await res.json();
    if (!isManifest(raw)) return null;

    const memes = raw.items
      .filter((i) => RENDERABLE.has(extOf(i.rel_path)))
      // Newest first: a meme curated today should be the one people see.
      .sort((a, b) => b.added_at - a.added_at)
      .map(toMeme);

    return memes.length > 0 ? memes : null;
  } catch {
    // Includes AbortError on unmount. Callers keep the fallback deck either way.
    return null;
  }
}
