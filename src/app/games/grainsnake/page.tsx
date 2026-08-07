import type { Metadata } from "next";
import { GrainsnakeScreen } from "@/components/grainsnake/GrainsnakeScreen";

export const metadata: Metadata = {
  title: "GRAINSNAKE — one grain becomes many",
  description:
    "Classic snake for $RICE. Every grain you eat joins the trail behind you, and the only thing that can end a run is the route you already took.",
};

/**
 * GRAINSNAKE. Everything interactive is in <GrainsnakeScreen /> (client); this stays
 * a server component so the route keeps its prerender and its immutable cache
 * headers — there is nothing per-request on the page.
 *
 * `src/lib/playSurfaces.ts` MUST list this route, and does. The match there is exact,
 * so if this route ever moves, that file moves with it in the SAME commit — a stale
 * entry fails silently and in the most expensive direction: nothing throws, the page
 * still renders, and the translate script comes back (breaking the spec's
 * zero-third-party-request criterion) while the chopstick cursor and the rice
 * particles drape themselves back over a live board. `test/play-surfaces.test.ts`
 * fails if it drifts.
 */
export default function GrainsnakePage() {
  return <GrainsnakeScreen />;
}
