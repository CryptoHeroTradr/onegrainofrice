import type { Metadata } from "next";
import TetriceScreen from "@/games/tetrice/client/TetriceScreen";

export const metadata: Metadata = {
  title: "TETRICE — falling grains",
  description:
    "Seven shapes, ten columns, and every piece made of grains of rice. Free in the browser, nothing to install.",
};

/**
 * TETRICE. Everything interactive is in <TetriceScreen /> (client); this stays a server
 * component so the route keeps its prerender — there is nothing per-request on the page.
 *
 * `src/lib/playSurfaces.ts` MUST list this route, and does: arrow keys are the primary
 * control and the Konami listener eats them, the translate script would be a third-party
 * request on a route that claims zero, and a chopstick cursor over a well whose whole
 * point is reading occupied cells is noise on the one channel the game communicates
 * through. A missing entry there fails SILENTLY — nothing throws and the page still
 * renders — so `test/play-surfaces.test.ts` pins it.
 */
export default function TetricePage() {
  return <TetriceScreen />;
}
