"use client";

import { useEffect, useState } from "react";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";
import { CHARITY_FALLBACK, type CharityDTO } from "@/lib/charity";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { CopyAddress } from "@/components/primitives/CopyAddress";
import { readJson } from "@/lib/readJson";

/**
 * Charity mission + public wallet + LIVE pantry stat chips, wired to the Phase 5
 * same-origin proxy (/onegrainofrice/api/charity). All copy/addresses/labels
 * from site.charity + site.charityWallet. Keeps last-good on failure.
 */
export function CharitySection() {
  const [dto, setDto] = useState<CharityDTO>(CHARITY_FALLBACK);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(asset("/api/charity"), { cache: "no-store" });
        if (!res.ok) throw new Error("bad status");
        const data = await readJson<CharityDTO>(res);
        if (alive) setDto(data);
      } catch {
        /* keep last-good */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const chips = [
    { value: dto.totalKg, label: site.charity.stats.totalKg },
    { value: dto.fedToday, label: site.charity.stats.fedToday },
    { value: dto.fedAllTime, label: site.charity.stats.fedAllTime },
  ];

  return (
    <section id="charity" className="grain bg-nori py-20 text-steamed sm:py-28">
      <div className="mx-auto max-w-[1180px] px-6 text-center">
        <div className="flex justify-center">
          <SectionHeading
            lead={site.charity.heading.lead}
            accent={site.charity.heading.accent}
            tone="light"
            accentColor="text-khaki"
            brushColor="#C4B370"
          />
        </div>
        <p className="mx-auto mt-5 max-w-xl font-mono text-base leading-relaxed text-steamed/85">
          {site.charity.mission}
        </p>
        <p className="mt-3 font-display text-xl italic text-khaki">{site.charity.missionTag}</p>

        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-4">
          {chips.map((c) => (
            <div key={c.label} className="porcelain-edge bg-nori/40 px-3 py-4">
              <div className="font-display-round text-2xl font-bold text-khaki sm:text-3xl">
                {c.value.toLocaleString("en-US")}
              </div>
              <div className="mt-1 font-mono text-[0.62rem] font-bold tracking-widest text-steamed/70 uppercase">
                {c.label}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <p className="mb-2 font-mono text-xs font-bold tracking-widest text-steamed/60 uppercase">
            {site.charity.walletLabel}
          </p>
          <div className="flex justify-center">
            <CopyAddress address={site.charityWallet} />
          </div>
        </div>

        {dto.fallback && (
          <p className="mt-4 font-mono text-[0.7rem] text-steamed/40">
            live data unavailable — showing recent totals
          </p>
        )}
      </div>
    </section>
  );
}
