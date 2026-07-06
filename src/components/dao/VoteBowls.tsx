"use client";

import { useEffect, useState } from "react";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useRice } from "@/components/rice/RiceParticles";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import type { DaoProposalDTO } from "@/lib/dao";

/** Build the initial DTO from config so the first paint is never empty. */
function exampleDTO(): DaoProposalDTO {
  const ex = site.dao.example;
  const options = ex.options.map((o) => ({ ...o }));
  return {
    id: ex.id,
    question: ex.question,
    options,
    totalVotes: options.reduce((s, o) => s + o.votes, 0),
    illustrative: true,
  };
}

/**
 * DAO vote bowls: one porcelain bowl per option, rice filled proportional to
 * vote weight, with a live count. Polls the same-origin /api/dao proxy (which
 * serves the illustrative example unless a public DAO feed is configured).
 * Bowls are [data-grab] — a pinch drops a symbolic grain (no real vote); the
 * CTA links out to RiceDAO to actually vote. Reduced motion: static fills.
 */
export function VoteBowls() {
  const reduced = usePrefersReducedMotion();
  const { pour } = useRice();
  const [dto, setDto] = useState<DaoProposalDTO>(exampleDTO());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(asset("/api/dao"), { cache: "no-store" });
        if (!res.ok) throw new Error("bad status");
        const data = (await res.json()) as DaoProposalDTO;
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

  const max = Math.max(1, ...dto.options.map((o) => o.votes));

  return (
    <section id="dao" className="grain-paper bg-bone py-20 text-nori sm:py-28">
      <div className="mx-auto max-w-[1180px] px-6 text-center">
        <div className="flex justify-center">
          <SectionHeading lead={site.dao.heading.lead} accent={site.dao.heading.accent} tone="dark" />
        </div>
        <p className="mx-auto mt-4 max-w-xl font-mono text-sm text-nori/70 sm:text-base">
          {site.dao.sub}
        </p>

        {dto.illustrative && (
          <span className="mt-4 inline-block border border-tuna/50 bg-tuna/10 px-3 py-1 font-mono text-[0.65rem] font-bold tracking-widest text-tuna uppercase">
            illustrative example
          </span>
        )}

        <p className="mt-8 font-display-round text-2xl font-bold text-nori">{dto.question}</p>

        <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-end justify-center gap-10">
          {dto.options.map((o) => {
            const fill = Math.round((o.votes / max) * 100);
            const share = dto.totalVotes ? Math.round((o.votes / dto.totalVotes) * 100) : 0;
            return (
              <div key={o.label} className="flex w-40 flex-col items-center">
                <div
                  data-grab
                  onPointerDown={(e) => pour({ x: e.clientX, y: e.clientY, count: 10 })}
                  className={`vote-bowl vote-bowl-${o.plate} cursor-pointer`}
                  role="img"
                  aria-label={`${o.label}: ${o.votes} votes, ${share}%`}
                >
                  <div
                    className="vote-bowl-fill"
                    style={{ height: `${fill}%`, transition: reduced ? "none" : undefined }}
                  />
                </div>
                <div className="mt-3 font-mono text-sm font-bold text-nori">{o.label}</div>
                <div className="mt-1 font-display-round text-2xl font-bold text-bamboo">
                  {share}%
                </div>
                <div className="font-mono text-[0.7rem] text-nori/55">
                  {o.votes.toLocaleString("en-US")} votes
                </div>
              </div>
            );
          })}
        </div>

        <a
          href={site.daoVoteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-12 inline-flex min-h-11 items-center bg-olive px-7 font-mono text-sm font-bold tracking-widest text-bone transition-colors hover:bg-olive-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-deep"
        >
          {site.dao.voteCta} →
        </a>
      </div>
    </section>
  );
}
