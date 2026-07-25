import { site } from "@/config/site";
import { memes } from "@/config/memes";
import { MemeWallSurfaces } from "@/components/sections/MemeWallSurfaces";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { resolveAsset, memePlaceholder } from "@/lib/resolveAsset";

/**
 * The meme wall. SERVER component: it resolves the FALLBACK deck (the real file if it
 * is in public/, else the generated placeholder) with resolveAsset, which reads the
 * filesystem and so cannot run on the client.
 *
 * That resolved deck is the fallback and nothing more. WHICH memes actually render is
 * decided one level down, in MemeWallSurfaces, where the pool is fetched ONCE for
 * every surface on this wall. See that file for why the fetch does not live in the
 * carousel any more.
 */
export function MemeWall() {
  const fallback = memes.map((m) => ({
    ...m,
    src: resolveAsset(m.src, memePlaceholder(m.id)),
  }));

  return (
    <section className="grain-paper vignette-paper bg-paper py-16 text-ink sm:py-20">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <SectionHeading
          lead={site.memeWall.heading.lead}
          accent={site.memeWall.heading.accent}
          tone="dark"
        />
        <p className="mt-4 max-w-xl font-mono text-sm text-ink/70 sm:text-base">
          {site.memeWall.sub}
        </p>

        <MemeWallSurfaces fallback={fallback} />
      </div>
    </section>
  );
}
