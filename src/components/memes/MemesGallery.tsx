"use client";

// /memes — community meme gallery, a clone of the RiceDAO memes page. Synced
// live from the @ricecontent Telegram group via the RiceDAO game server's
// /api/telegram-media endpoint (which runs the Telegram meme-sync bot). We reach
// it SAME-ORIGIN through the Next rewrite in next.config.ts → localhost:1112, so
// there's no CORS and no duplicate bot. Category filter bar, masonry grid of
// photos/videos/GIFs, lightbox with video controls + keyboard nav, pagination.

import { useCallback, useEffect, useState } from "react";

// Same-origin: the Next rewrite proxies /api/telegram-media/* to the game server.
const GAME_API = "";
const TELEGRAM_GROUP = "https://t.me/ricecontent";

interface Topic {
  name: string;
  category: string;
  emoji: string | null;
}
interface Media {
  id: string;
  telegramMsgId: number;
  mediaType: "photo" | "video" | "animation";
  fileUrl: string;
  thumbUrl?: string | null;
  caption: string | null;
  postedBy: string | null;
  postedByName: string | null;
  telegramDate: string;
  topic: Topic | null;
  local?: boolean;
}
interface Category {
  category: string;
  name: string;
  emoji: string;
  count: number;
}

// Resolve a media item to a displayable URL. Telegram media is streamed through
// the game-server proxy path, which the Next rewrite serves same-origin.
function srcOf(m: Media): string {
  if (m.fileUrl.startsWith("/api/telegram-media")) return `${GAME_API}${m.fileUrl}`;
  return m.fileUrl;
}

// Poster thumbnail URL for a video/animation (proxied), or null when none exists.
function thumbSrcOf(m: Media): string | null {
  if (!m.thumbUrl) return null;
  return m.thumbUrl.startsWith("/api/telegram-media") ? `${GAME_API}${m.thumbUrl}` : m.thumbUrl;
}

export function MemesGallery() {
  const [media, setMedia] = useState<Media[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Fetch on mount + whenever category/page changes, and poll every 5 minutes.
  // The request is inlined so all setState happens inside the async callback
  // (never synchronously in the effect body), and an `ignore` flag drops results
  // from a superseded filter/page.
  useEffect(() => {
    let ignore = false;

    const load = async () => {
      const params = new URLSearchParams({ page: String(currentPage), limit: "24" });
      // The "Videos" tab filters by media type so it spans every topic (all
      // videos + GIFs), not just items imported under the Videos topic.
      if (selectedCategory === "videos") {
        params.set("type", "video");
      } else if (selectedCategory !== "all") {
        params.set("category", selectedCategory);
      }
      try {
        const res = await fetch(`${GAME_API}/api/telegram-media?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (ignore) return;
        setMedia(Array.isArray(data.media) ? data.media : []);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setTotalPages(data.totalPages ?? 1);
      } catch {
        // Backend unreachable — show the empty state rather than stale content.
        if (ignore) return;
        setMedia([]);
        setCategories([]);
        setTotalPages(1);
      } finally {
        if (!ignore) setLoaded(true);
      }
    };

    void load();
    const interval = setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [selectedCategory, currentPage]);

  const selectCategory = useCallback((cat: string) => {
    setSelectedCategory(cat);
    setCurrentPage(1);
  }, []);

  const close = useCallback(() => setLightbox(null), []);
  const prev = useCallback(
    () => setLightbox((i) => (i == null ? i : (i - 1 + media.length) % media.length)),
    [media.length],
  );
  const next = useCallback(
    () => setLightbox((i) => (i == null ? i : (i + 1) % media.length)),
    [media.length],
  );

  useEffect(() => {
    if (lightbox == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, close, prev, next]);

  const bar: Category[] = [{ category: "all", name: "All", emoji: "🌾", count: 0 }, ...categories];

  return (
    <>
      <MemesStyles />
      <main className="memes-root">
        {/* ── HEADER ───────────────────────────────────────────────────────── */}
        <header className="memes-hero">
          <div className="memes-hero-inner">
            <h1 className="memes-title">🌾 The Meme Gallery</h1>
          </div>
        </header>

        {/* ── CATEGORY FILTER BAR ──────────────────────────────────────────── */}
        <div className="cat-bar-wrap">
          <div className="cat-bar">
            {bar.map((c) => (
              <button
                key={c.category}
                type="button"
                onClick={() => selectCategory(c.category)}
                className={`cat-chip${selectedCategory === c.category ? " cat-active" : ""}`}
              >
                <span aria-hidden>{c.emoji}</span> {c.name}
                {c.count > 0 && <span className="cat-count">{c.count}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ── GRID ─────────────────────────────────────────────────────────── */}
        <section className="memes-grid-section">
          {!loaded ? (
            <p className="memes-loading">Loading…</p>
          ) : media.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="meme-grid">
                {media.map((m, i) => (
                  <MemeCard key={m.id} media={m} onClick={() => setLightbox(i)} />
                ))}
              </div>
              {totalPages > 1 && (
                <Pagination
                  page={currentPage}
                  totalPages={totalPages}
                  onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                />
              )}
            </>
          )}
        </section>
      </main>

      {/* ── LIGHTBOX ───────────────────────────────────────────────────────── */}
      {lightbox != null && media[lightbox] && (
        <Lightbox
          media={media[lightbox]}
          onClose={close}
          onPrev={prev}
          onNext={next}
          showNav={media.length > 1}
        />
      )}
    </>
  );
}

function MemeCard({ media, onClick }: { media: Media; onClick: () => void }) {
  const src = srcOf(media);
  const thumb = thumbSrcOf(media);
  return (
    <button type="button" onClick={onClick} className="meme-card">
      {media.mediaType === "photo" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={media.caption ?? "meme"} loading="lazy" />
      ) : media.mediaType === "animation" ? (
        <video src={src} autoPlay loop muted playsInline preload="metadata" />
      ) : (
        <div className="video-wrap">
          {thumb ? (
            // Lightweight poster image; the full video loads only in the lightbox.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={media.caption ?? "video"} loading="lazy" />
          ) : (
            // No captured thumbnail — fall back to the video's first frame.
            <video src={src} muted playsInline preload="metadata" />
          )}
          <span className="play-overlay" aria-hidden>
            ▶
          </span>
        </div>
      )}
      {media.caption && <div className="meme-caption">{media.caption}</div>}
      {media.topic && (
        <div className="meme-footer">
          <span className="mf-topic">
            {media.topic.emoji} {media.topic.name}
          </span>
        </div>
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="memes-empty">
      <div className="memes-empty-emoji">🌾</div>
      <p className="memes-empty-title">Content loading from @ricecontent…</p>
      <p className="memes-empty-sub">
        New posts appear here automatically.{" "}
        <a href={TELEGRAM_GROUP} target="_blank" rel="noopener noreferrer">
          Join the Telegram group →
        </a>
      </p>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="pager">
      <button type="button" className="pager-btn" onClick={onPrev} disabled={page <= 1}>
        ← Prev
      </button>
      <span className="pager-info">
        Page {page} of {totalPages}
      </span>
      <button type="button" className="pager-btn" onClick={onNext} disabled={page >= totalPages}>
        Next →
      </button>
    </div>
  );
}

function Lightbox({
  media,
  onClose,
  onPrev,
  onNext,
  showNav,
}: {
  media: Media;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  showNav: boolean;
}) {
  const src = srcOf(media);
  const isVideo = media.mediaType === "video" || media.mediaType === "animation";
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} className="lb-backdrop">
      <button type="button" onClick={onClose} className="lb-btn lb-close" aria-label="Close">
        ✕
      </button>
      {showNav && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="lb-btn lb-prev"
          aria-label="Previous"
        >
          ←
        </button>
      )}
      <div onClick={(e) => e.stopPropagation()} className="lb-stage">
        {isVideo ? (
          <video src={src} controls autoPlay loop playsInline className="lb-media" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={media.caption ?? "meme"} className="lb-media" />
        )}
        {media.caption && <div className="lb-caption">{media.caption}</div>}
      </div>
      {showNav && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="lb-btn lb-next"
          aria-label="Next"
        >
          →
        </button>
      )}
    </div>
  );
}

// Scoped styles — the $RICE palette (nori/khaki/olive/bone) in the dark-gallery
// layout cloned from the RiceDAO memes page.
function MemesStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
        .memes-root { background: #14110d; color: #f4efe2; min-height: 100vh; }
        .memes-hero {
          position: relative;
          /* Top clears the fixed nav (h-24 ≈ 6rem); condensed vertical padding. */
          padding: calc(6rem + 0.5vh) 1.5rem 1.25rem;
          background:
            radial-gradient(120% 90% at 50% 10%, rgba(196,179,112,0.28) 0%, rgba(20,17,13,0) 60%),
            linear-gradient(to bottom, #1c1913 0%, #23301c 70%, #14110d 100%);
          text-align: center;
          border-bottom: 1px solid rgba(196,179,112,0.15);
        }
        .memes-hero-inner { max-width: 760px; margin: 0 auto; }
        .memes-title {
          font-family: var(--font-display-round, sans-serif);
          font-weight: 800; line-height: 1; margin: 0;
          font-size: clamp(1.6rem, 5vw, 2.75rem); color: #f4efe2;
        }

        .cat-bar-wrap { background: #14110d; position: sticky; top: 6rem; z-index: 20; }
        /* Mobile nav is shorter (h-16 = 4rem) than desktop (h-24 = 6rem). */
        @media (max-width: 1023px) {
          .memes-hero { padding-top: calc(4rem + 0.5vh); }
          .cat-bar-wrap { top: 4rem; }
        }
        .cat-bar {
          display: flex; gap: 0.5rem; overflow-x: auto; scrollbar-width: none;
          padding: 0.75rem clamp(1rem, 4vw, 3rem);
          max-width: 1240px; margin: 0 auto;
          border-bottom: 1px solid rgba(196,179,112,0.15);
        }
        .cat-bar::-webkit-scrollbar { display: none; }
        .cat-chip {
          flex: 0 0 auto; cursor: pointer;
          background: transparent; border: none;
          color: rgba(244,239,226,0.6); font-size: 0.9rem; font-family: inherit;
          padding: 0.4rem 0.35rem; white-space: nowrap;
          border-bottom: 2px solid transparent;
          transition: color 0.15s ease, border-color 0.15s ease;
        }
        .cat-chip:hover { color: #f4efe2; }
        .cat-active { color: #c4b370; border-bottom-color: #c4b370; }
        .cat-count {
          margin-left: 0.35rem; font-size: 0.72rem; color: rgba(244,239,226,0.6);
          background: rgba(196,179,112,0.15); border-radius: 999px; padding: 0.05rem 0.4rem;
        }

        .memes-grid-section {
          position: relative; background: #14110d; min-height: 40vh;
          padding: clamp(1.5rem, 5vh, 3rem) clamp(1rem, 4vw, 3rem);
        }
        .memes-loading { color: rgba(244,239,226,0.6); text-align: center; }
        .meme-grid { column-count: 1; column-gap: 1rem; max-width: 1200px; margin: 0 auto; }
        @media (min-width: 640px) { .meme-grid { column-count: 2; } }
        @media (min-width: 1000px) { .meme-grid { column-count: 3; } }

        .meme-card {
          display: block; width: 100%;
          break-inside: avoid; margin: 0 0 1rem;
          padding: 0; cursor: pointer; text-align: left;
          background: rgba(244,239,226,0.04);
          border: 1px solid rgba(196,179,112,0.2);
          border-radius: 12px; overflow: hidden;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }
        .meme-card:hover {
          transform: scale(1.02);
          border-color: #c4b370;
          box-shadow: 0 0 24px rgba(196,179,112,0.35);
        }
        .meme-card img, .meme-card video { display: block; width: 100%; height: auto; }
        .video-wrap { position: relative; }
        .play-overlay {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          font-size: 2.4rem; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,0.6);
          background: rgba(0,0,0,0.18); pointer-events: none;
        }
        .meme-caption {
          color: #f4efe2; font-size: 0.85rem;
          padding: 0.6rem 0.8rem 0.3rem; text-align: left;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .meme-footer {
          display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
          padding: 0.4rem 0.8rem 0.7rem; font-size: 0.72rem; color: rgba(244,239,226,0.6);
        }
        .mf-user { opacity: 0.85; }
        .mf-topic {
          color: #c4b370; border: 1px solid rgba(196,179,112,0.4);
          border-radius: 999px; padding: 0.05rem 0.5rem;
        }
        .mf-time { margin-left: auto; opacity: 0.7; }

        .memes-empty { text-align: center; padding: clamp(2rem, 8vh, 5rem) 1rem; }
        .memes-empty-emoji { font-size: 3rem; margin-bottom: 1rem; }
        .memes-empty-title { color: #f4efe2; font-size: 1.15rem; }
        .memes-empty-sub { color: rgba(244,239,226,0.6); margin-top: 0.75rem; }
        .memes-empty-sub a { color: #c4b370; }

        .pager { display: flex; align-items: center; justify-content: center; gap: 1rem; margin: 2rem auto 0; max-width: 1200px; }
        .pager-btn {
          background: #c4b370; color: #14110d; border: 1px solid #c4b370;
          border-radius: 8px; padding: 0.5rem 1.1rem; cursor: pointer;
          font-size: 0.9rem; font-weight: 600; font-family: inherit;
          transition: opacity 0.15s ease, transform 0.15s ease;
        }
        .pager-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .pager-info { color: rgba(244,239,226,0.6); font-size: 0.9rem; }

        .lb-backdrop {
          position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.92);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: clamp(1rem, 4vw, 3rem);
        }
        .lb-stage { display: flex; flex-direction: column; align-items: center; max-width: 100%; max-height: 100%; }
        .lb-media {
          max-width: min(92vw, 1100px); max-height: 82vh; object-fit: contain;
          border-radius: 8px; border: 1px solid rgba(196,179,112,0.4);
        }
        .lb-caption { color: #f4efe2; margin-top: 1rem; font-size: 1rem; text-align: center; max-width: 700px; }
        .lb-tglink { color: #c4b370; margin-top: 0.85rem; font-size: 0.95rem; }
        .lb-btn {
          position: fixed; z-index: 110; background: rgba(10,8,5,0.7);
          border: 1px solid #c4b370; color: #c4b370;
          width: 48px; height: 48px; border-radius: 50%;
          font-size: 1.4rem; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.15s ease;
        }
        .lb-btn:hover { background: rgba(196,179,112,0.2); }
        .lb-close { top: clamp(0.75rem, 3vw, 1.5rem); right: clamp(0.75rem, 3vw, 1.5rem); }
        .lb-prev { left: clamp(0.5rem, 2vw, 1.5rem); top: 50%; transform: translateY(-50%); }
        .lb-next { right: clamp(0.5rem, 2vw, 1.5rem); top: 50%; transform: translateY(-50%); }
      `,
      }}
    />
  );
}
