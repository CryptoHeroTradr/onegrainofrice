import { SectionHeading } from "@/components/primitives/SectionHeading";

/**
 * A narrative journey beat: full-viewport, scroll-snap-aligned, transparent so
 * the shared rising bowl-fill shows behind. Content sits on a soft scrim for
 * legibility. `step` is the small kicker label (SEED / GROW / …).
 */
export function JourneySection({
  id,
  step,
  lead,
  accent,
  body,
  children,
}: {
  id: string;
  step: string;
  lead: string;
  accent: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="journey-section relative flex items-center justify-center px-6 py-24"
    >
      <div className="relative z-10 mx-auto w-full max-w-2xl rounded-sm bg-steamed/80 px-8 py-10 text-center backdrop-blur-sm">
        <p className="mb-3 font-mono text-xs font-bold tracking-[0.3em] text-tuna uppercase">
          {step}
        </p>
        <div className="flex justify-center">
          <SectionHeading lead={lead} accent={accent} tone="dark" accentColor="text-bamboo" brushColor="#4E7A3E" />
        </div>
        <p className="mx-auto mt-5 max-w-xl font-mono text-base leading-relaxed text-nori/75">
          {body}
        </p>
        {children}
      </div>
    </section>
  );
}
