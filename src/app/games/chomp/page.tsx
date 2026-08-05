import type { Metadata } from "next";
import { ChompScreen } from "@/components/chomp/ChompScreen";

export const metadata: Metadata = {
  title: "RICE CHOMP — clear the paddy",
  description:
    "An arcade maze chase for $RICE. Steer a grain of rice through the paddy and chomp it clean.",
};

/**
 * RICE CHOMP. Everything interactive is in <ChompScreen /> (client); this stays a
 * server component so the route keeps its prerender and its immutable cache headers —
 * there is nothing per-request on the page, and the leaderboard is fetched
 * client-side rather than making this dynamic.
 *
 * MOVED from `/chomp` to `/games/chomp` in Phase 7 (2026-08-05). If this route ever
 * moves again, `src/lib/playSurfaces.ts` MUST move with it in the same commit — it
 * keys off the exact path, and a stale entry silently re-enables the translate
 * script (breaking the zero-third-party-request criterion) and drapes the ambient
 * decorations back over the board. `test/play-surfaces.test.ts` fails if it drifts.
 */
export default function ChompPage() {
  return <ChompScreen />;
}
