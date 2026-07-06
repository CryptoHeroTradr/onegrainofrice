import { site } from "@/config/site";
import { SectionHeading } from "@/components/primitives/SectionHeading";

/** Mythic origin — the one-grain folktale. All copy from site.lore. */
export function Lore() {
  return (
    <section id="lore" className="bg-nori py-20 text-steamed sm:py-28">
      <div className="porcelain-edge mx-auto max-w-3xl bg-nori/40 px-6 py-12 text-center sm:px-10">
        <div className="flex justify-center">
          <SectionHeading
            lead={site.lore.heading.lead}
            accent={site.lore.heading.accent}
            tone="light"
            accentColor="text-khaki"
            brushColor="#C4B370"
          />
        </div>
        <div className="mx-auto mt-8 max-w-xl space-y-5">
          {site.lore.body.map((para) => (
            <p key={para} className="font-mono text-base leading-relaxed text-steamed/85">
              {para}
            </p>
          ))}
        </div>
        <p className="mt-8 font-display text-2xl italic text-khaki">{site.lore.tag}</p>
      </div>
    </section>
  );
}
