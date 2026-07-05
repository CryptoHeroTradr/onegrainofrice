import { Droplet, Heart, ScanSearch, ShieldCheck, Users } from "lucide-react";
import { site, type AboutIcon } from "@/config/site";
import { SectionHeading } from "@/components/primitives/SectionHeading";

const ICONS: Record<AboutIcon, typeof Users> = {
  users: Users,
  shield: ShieldCheck,
  droplet: Droplet,
  heart: Heart,
  scan: ScanSearch,
};

export function About() {
  return (
    <section id="about" className="grain vignette-dark bg-ink py-16 sm:py-24">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <SectionHeading
              lead={site.about.heading.lead}
              accent={site.about.heading.accent}
              tone="light"
              accentColor="text-khaki"
              brushColor="#C4B370"
            />
            <p className="mt-5 max-w-xs font-mono text-sm leading-relaxed text-paper/75">
              {site.about.intro}
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {site.about.columns.map((col) => {
              const Icon = ICONS[col.icon];
              return (
                <div key={col.title}>
                  <div className="flex h-14 w-14 items-center justify-center border-2 border-olive text-olive">
                    <Icon size={26} aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 font-display text-2xl font-bold text-bone">{col.title}</h3>
                  <p className="mt-2 font-mono text-sm leading-relaxed text-paper/65">{col.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
