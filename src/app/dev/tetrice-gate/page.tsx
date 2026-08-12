import type { Metadata } from "next";
import TetriceGate from "@/components/tetrice-gate/TetriceGate";

export const metadata: Metadata = {
  title: "TETRICE gate — palette + grain axis",
  robots: { index: false, follow: false },
};

/**
 * THROWAWAY PROTOTYPE. Not linked from anywhere, not in `src/config/games.ts`, not in the
 * nav, `noindex`.
 *
 * It exists to falsify two decisions in `docs/tetrice-spec.md` (*The pieces*) before
 * Phase 2 commits to them: the seven-token hue mapping, and the three-way categorical
 * grain long-axis code meant to carry identity where hue collides. Delete it, its
 * component directory, its `PLAY_SURFACE_ROUTES` entry and its `UNLISTED_PLAY_SURFACES`
 * entry together.
 *
 * It IS a play surface — the ambient decoration (chopstick cursor, rice particles,
 * translate) would sit on top of the exact pixels being judged, and a gate measured
 * through a pointer trail is measuring the instrument.
 */
export default function TetriceGatePage() {
  return <TetriceGate />;
}
