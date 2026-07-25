"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Sprout } from "lucide-react";
import { site } from "@/config/site";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { SectionHeading } from "@/components/primitives/SectionHeading";

type Milestone = { title: string; detail: string; done: boolean };

/**
 * Roadmap as terraced paddies stepping up a hillside. Each terrace is a
 * milestone: `done` ones are flooded green, upcoming ones dry. Terraces
 * scroll-reveal in; under reduced motion they render revealed with no
 * transition. Defaults to the full `site.roadmap` (used by /classic-style
 * callers); the new home passes a scrubbed subset via `items`.
 */
export function PaddyTerraces({ items = site.roadmap }: { items?: readonly Milestone[] } = {}) {
  const reduced = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (reduced) return; // reduced motion → everything shown at render (below)
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = Number((e.target as HTMLElement).dataset.i);
            setRevealed((s) => (s.has(i) ? s : new Set(s).add(i)));
          }
        }
      },
      { threshold: 0.35 },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [reduced]);

  return (
    <section id="roadmap" className="section grain bg-nori text-steamed">
      <div className="mx-auto max-w-[1180px] px-6">
        <div className="text-center">
          <div className="flex justify-center">
            <SectionHeading
              lead="the road"
              accent="up the hill."
              tone="light"
              accentColor="text-bamboo"
              brushColor="#4E7A3E"
            />
          </div>
        </div>

        <ol className="mx-auto mt-14 max-w-3xl">
          {items.map((m, i) => (
            <li
              key={m.title}
              data-i={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              style={{ marginLeft: `${i * 6}%` }}
              className={`terrace ${m.done ? "terrace-done" : "terrace-todo"} ${
                reduced || revealed.has(i) ? "revealed" : ""
              } mb-4 flex items-center gap-4 px-5 py-5`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                  m.done ? "bg-bamboo text-steamed" : "border-2 border-steamed/40 text-steamed/60"
                }`}
              >
                {m.done ? <Check size={20} aria-hidden="true" /> : <Sprout size={18} aria-hidden="true" />}
              </span>
              <div>
                <h3 className="font-display-round text-xl font-bold text-steamed">
                  {m.title}
                  {m.done && (
                    <span className="ml-2 align-middle font-mono text-[0.6rem] font-bold tracking-widest text-bamboo uppercase">
                      done
                    </span>
                  )}
                </h3>
                <p className="mt-1 font-mono text-sm text-steamed/70">{m.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
