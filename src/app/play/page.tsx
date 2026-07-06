/**
 * Hidden grain-catch mini-game. Visit /onegrainofrice/play. Uses the global
 * chopstick cursor to catch falling grains.
 */
import { GrainCatch } from "@/components/eggs/GrainCatch";

export default function PlayPage() {
  return (
    <main className="min-h-screen bg-steamed">
      <GrainCatch />
    </main>
  );
}
