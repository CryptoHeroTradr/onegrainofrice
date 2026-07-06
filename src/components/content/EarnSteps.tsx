import { site } from "@/config/site";
import { SectionHeading } from "@/components/primitives/SectionHeading";

/** How it works / earn loop — three scannable steps. All numbers from site.earn. */
export function EarnSteps() {
  const { heading, perKg, minClaim, cooldownHours, steps } = site.earn;

  return (
    <section id="earn" className="grain-paper bg-steamed py-20 text-nori sm:py-28">
      <div className="mx-auto max-w-[1180px] px-6">
        <div className="text-center">
          <div className="flex justify-center">
            <SectionHeading
              lead={heading.lead}
              accent={heading.accent}
              tone="dark"
              accentColor="text-bamboo"
              brushColor="#4E7A3E"
            />
          </div>
        </div>

        <ol className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="porcelain-edge bg-bone p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-tuna font-display-round text-lg font-bold text-steamed">
                {i + 1}
              </span>
              <h3 className="mt-4 font-display-round text-xl font-bold text-bamboo">{step.title}</h3>
              <p className="mt-2 font-mono text-sm leading-relaxed text-nori/70">{step.body}</p>
            </li>
          ))}
        </ol>

        {/* Scannable rule strip — the exact economy numbers, from config */}
        <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center font-mono text-sm font-bold text-nori">
          <span className="text-bamboo">{perKg} $RICE</span>
          <span className="text-nori/50">per kg donated</span>
          <span className="text-nori/30">·</span>
          <span className="text-bamboo">{minClaim} $RICE</span>
          <span className="text-nori/50">minimum claim</span>
          <span className="text-nori/30">·</span>
          <span className="text-bamboo">{cooldownHours}h</span>
          <span className="text-nori/50">cooldown</span>
        </div>
      </div>
    </section>
  );
}
