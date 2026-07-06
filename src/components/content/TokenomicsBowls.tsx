import { site } from "@/config/site";
import { SectionHeading } from "@/components/primitives/SectionHeading";
import { CopyAddress } from "@/components/primitives/CopyAddress";

/**
 * Store-income split rendered as four grains dropping into four labeled
 * porcelain bowls, % chips beside each. All data from site.tokenomics.split;
 * contract from site.token.contract. Drop animation is pure CSS (motion-gated).
 */
export function TokenomicsBowls() {
  const { heading, sub, split, contractLabel } = site.tokenomics;

  return (
    <section id="token" className="grain-paper bg-bone py-20 text-nori sm:py-28">
      <div className="mx-auto max-w-[1180px] px-6">
        <div className="text-center">
          <div className="flex justify-center">
            <SectionHeading lead={heading.lead} accent={heading.accent} tone="dark" />
          </div>
          <p className="mx-auto mt-4 max-w-xl font-mono text-sm text-nori/70 sm:text-base">{sub}</p>
        </div>

        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-4">
          {split.map((s, i) => (
            <div key={s.label} className="flex flex-col items-center text-center">
              <div className="tk-drop">
                <span className="tk-grain" style={{ animationDelay: `${i * 0.45}s` }} />
                <div className={`tk-bowl tk-bowl-${s.plate}`} aria-hidden="true" />
              </div>
              <div className="mt-3 font-display-round text-3xl font-bold text-bamboo">{s.pct}%</div>
              <div className="mt-1 font-mono text-xs font-bold tracking-widest text-nori uppercase">
                {s.label}
              </div>
              <div className="mt-1 font-mono text-[0.7rem] text-nori/55">{s.note}</div>
            </div>
          ))}
        </div>

        <div className="mt-14 text-center">
          <p className="mb-2 font-mono text-xs font-bold tracking-widest text-nori/60 uppercase">
            {contractLabel}
          </p>
          <div className="flex justify-center">
            <CopyAddress address={site.token.contract} />
          </div>
        </div>
      </div>
    </section>
  );
}
