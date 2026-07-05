/**
 * Phase 6 demo harness for the sushi belt. Visit /onegrainofrice/belt-demo.
 * Server component so the belt's srcs resolve to real files or placeholders.
 * Removable once the belt is wired into the rebuilt homepage.
 */
import { SushiBeltSection } from "@/components/memes/SushiBeltSection";

export default function BeltDemo() {
  return (
    <main className="min-h-screen bg-steamed py-16 text-nori">
      <div className="mx-auto mb-10 max-w-[1180px] px-6 text-center">
        <h1 className="font-display-round text-4xl font-bold text-bamboo">sushi belt demo</h1>
        <p className="mt-3 font-mono text-sm text-nori/70">
          Hover a plate to slow the belt and pop it forward; press and drag a plate to lift it
          (springs back). Enable “reduce motion” to get the scrollable strip with arrows.
        </p>
      </div>
      <SushiBeltSection />
    </main>
  );
}
