/**
 * Catch A Grain. Uses the global chopstick cursor to catch falling grains — which is
 * why this route is deliberately NOT in `src/lib/playSurfaces.ts`: that list turns the
 * ambient decorations OFF, and the cursor is this game's controller.
 *
 * MOVED from `/play` to `/games/catch` in Phase 7 (2026-08-05). `/play` had been
 * public, so it keeps a 308 to here (see `next.config.ts`).
 */
import type { Metadata } from "next";
import { GrainCatch } from "@/components/eggs/GrainCatch";

export const metadata: Metadata = {
  title: "Catch A Grain — chopsticks at the ready",
  description: "Catch the falling grains with a pair of chopsticks before they hit the floor.",
};

export default function CatchAGrainPage() {
  return (
    <main className="min-h-screen bg-steamed">
      <GrainCatch />
    </main>
  );
}
