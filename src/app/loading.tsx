import { GrainMascot } from "@/components/brand/GrainMascot";

/**
 * Route loading UI — the mascot gently bobs while a "cooking…" grain shimmer
 * plays. Under reduced motion both animations are disabled (static mascot).
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-steamed text-nori">
      <div className="mascot-bob">
        <GrainMascot mood="happy" size={140} title="Cooking up your rice" />
      </div>
      <p className="font-mono text-sm font-bold tracking-[0.3em] text-bamboo uppercase">
        cooking
        <span className="cooking-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  );
}
