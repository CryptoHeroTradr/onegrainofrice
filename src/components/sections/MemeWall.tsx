import { site } from "@/config/site";
import { memes } from "@/config/memes";
import { MemeCollage } from "@/components/MemeCollage";
import { MemeCarousel } from "@/components/MemeCarousel";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { resolveAsset, memePlaceholder } from "@/lib/resolveAsset";

export function MemeWall() {
  // Server-side: swap each src for the real file if present, else the .svg
  // placeholder. Client components (carousel) then receive resolved paths.
  const resolved = memes.map((m) => ({
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

        {/* Row 1 — static collage */}
        <div className="mt-10">
          <MemeCollage memes={resolved} />
        </div>

        {/* Row 2 — interactive carousel */}
        <div className="mt-10">
          <p className="mb-1 font-mono text-xs font-bold tracking-widest text-ink/50 uppercase">
            swipe the gallery →
          </p>
          <MemeCarousel memes={resolved} />
        </div>
      </div>
    </section>
  );
}
