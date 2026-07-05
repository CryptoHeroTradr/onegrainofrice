import Image from "next/image";
import { Droplets, Globe, Heart, Soup } from "lucide-react";
import { site, type StatIcon } from "@/config/site";
import { asset } from "@/lib/asset";
import { resolveAsset } from "@/lib/resolveAsset";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { Tape } from "@/components/primitives/Tape";

const STAT_ICONS: Record<StatIcon, typeof Soup> = {
  bowl: Soup,
  water: Droplets,
  love: Heart,
};

function formatStat(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

export function Impact() {
  const impactImg = resolveAsset("/impact-ricenburgh.jpg", "/impact-field.svg");

  return (
    <section id="impact" className="grain vignette-dark bg-ink py-16 sm:py-24">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <SectionHeading
          lead={site.impact.heading.lead}
          accent={site.impact.heading.accent}
          tone="light"
          accentColor="text-khaki"
          brushColor="#C4B370"
        />
        <p className="mt-4 max-w-xl font-mono text-sm text-paper/70 sm:text-base">
          {site.impact.sub}
        </p>

        <div className="mt-12 grid items-stretch gap-10 lg:grid-cols-2">
          {/* Dramatic image slot + "for the culture" stamp. Extra bottom padding
              on mobile so the overlapping stamp never clips off the image. */}
          <div className="relative pb-14 sm:pb-4">
            <div className="relative aspect-[16/12] w-full overflow-hidden bg-black/40 grayscale">
              <Image
                src={asset(impactImg)}
                alt="An exploding airship labeled RICENBURGH"
                fill
                sizes="(min-width: 1024px) 32rem, 90vw"
                className="object-cover"
              />
            </div>
            {/* Rubber-stamp block, overlapping bottom-left; sized down on mobile. */}
            <div className="absolute bottom-0 left-2 flex max-w-[92%] items-center gap-2 border-2 border-paper/70 bg-ink/85 px-3 py-2 -rotate-2 sm:-bottom-4 sm:left-3 sm:gap-3 sm:px-4 sm:py-3">
              <div className="font-mono text-[0.6rem] leading-tight font-bold tracking-wide text-paper/90 uppercase sm:text-[0.7rem]">
                {site.impact.stamp.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <Globe className="h-7 w-7 shrink-0 text-paper/70 sm:h-9 sm:w-9" aria-hidden="true" />
            </div>
          </div>

          {/* Stat panel — icon + number + label per row, divider between */}
          <div className="relative">
            <div className="grain vignette-dark h-full bg-olive-deep px-7 py-4 sm:px-9">
              <dl className="divide-y divide-bone/15">
                {site.impact.stats.map((stat) => {
                  const Icon = STAT_ICONS[stat.icon];
                  return (
                    <div key={stat.label} className="flex items-center gap-4 py-5">
                      <Icon size={40} className="shrink-0 text-bone/85" aria-hidden="true" />
                      <div>
                        <dd className="font-display text-4xl leading-none font-bold tracking-tight text-khaki sm:text-5xl">
                          {formatStat(stat.value)}
                        </dd>
                        <dt className="mt-1 font-mono text-xs font-bold tracking-widest text-bone/75 uppercase">
                          {stat.label}
                        </dt>
                      </div>
                    </div>
                  );
                })}
              </dl>
            </div>
            <Tape className="absolute -top-3 left-8 w-24 -rotate-3" />
          </div>
        </div>
      </div>
    </section>
  );
}
