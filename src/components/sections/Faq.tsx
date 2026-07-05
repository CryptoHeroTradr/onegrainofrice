import { ChevronDown } from "lucide-react";
import { site } from "@/config/site";
import { SectionHeading } from "@/components/primitives/SectionHeading";

/**
 * Native <details>/<summary> accordion — keyboard and screen-reader
 * accessible with zero JS.
 */
export function Faq() {
  return (
    <section id="faq" className="grain-paper vignette-paper bg-bone py-16 text-ink sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeading lead={site.faq.heading.lead} accent={site.faq.heading.accent} tone="dark" />

        <div className="mt-10 space-y-4">
          {site.faq.items.map((item) => (
            <details
              key={item.q}
              className="group border-2 border-ink/15 bg-paper open:border-olive"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-display text-lg font-bold marker:hidden [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown
                  size={20}
                  aria-hidden="true"
                  className="shrink-0 text-olive transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <p className="px-5 pb-5 font-mono text-sm leading-relaxed text-ink/75">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
