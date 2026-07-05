import { site } from "@/config/site";
import { CopyAddress } from "@/components/primitives/CopyAddress";
import { SectionHeading } from "@/components/primitives/SectionHeading";

const BAR_COLORS = ["bg-olive", "bg-khaki", "bg-olive-deep"];

export function Tokenomics() {
  const { heading, sub, totalSupply, allocations } = site.tokenomics;

  return (
    <section id="tokenomics" className="grain-paper vignette-paper bg-paper pt-12 pb-16 text-ink sm:pt-14 sm:pb-24">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <SectionHeading lead={heading.lead} accent={heading.accent} tone="dark" />
        <p className="mt-3 max-w-xl font-mono text-sm text-ink/70 sm:text-base">{sub}</p>

        <div className="mt-8 grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="font-mono text-xs font-bold tracking-widest text-ink/60 uppercase">
              total supply
            </p>
            <p className="mt-1 font-display text-4xl font-bold text-olive-deep sm:text-5xl">
              {totalSupply}
            </p>
            <div className="mt-6">
              <p className="mb-2 font-mono text-xs font-bold tracking-widest text-ink/60 uppercase">
                contract address
              </p>
              <CopyAddress address={site.tokenAddress} />
            </div>
          </div>

          <div>
            {/* Stacked allocation bar */}
            <div
              className="flex h-10 w-full overflow-hidden border-2 border-ink/20"
              role="img"
              aria-label={`Token allocation: ${allocations
                .map((a) => `${a.label} ${a.pct}%`)
                .join(", ")}`}
            >
              {allocations.map((a, i) => (
                <div
                  key={a.label}
                  className={BAR_COLORS[i % BAR_COLORS.length]}
                  style={{ width: `${a.pct}%` }}
                />
              ))}
            </div>

            <ul className="mt-6 space-y-4">
              {allocations.map((a, i) => (
                <li key={a.label} className="flex items-baseline gap-3">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-3 w-3 shrink-0 self-center ${BAR_COLORS[i % BAR_COLORS.length]}`}
                  />
                  <span className="font-display text-2xl font-bold text-olive-deep">{a.pct}%</span>
                  <span className="font-mono text-sm font-bold">{a.label}</span>
                  <span className="font-mono text-xs text-ink/60">— {a.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
