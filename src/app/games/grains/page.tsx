import type { Metadata } from "next";
import { GrainsScreen } from "@/components/grains/GrainsScreen";

export const metadata: Metadata = {
  title: "Grains Game — tap to drop a grain",
  description:
    "Tap to add a grain of rice toward a live global total, and race the rest of your country up the board.",
};

// Realtime + per-visitor session cookie (set by /grains/session) → always dynamic.
export const dynamic = "force-dynamic";

/**
 * The Grains Game. It was the site's LANDING page until Phase 7 (2026-08-05), when
 * `/` became the home page and the three games moved under `/games`.
 *
 * That move deleted this page's gate rather than relocating it. As the landing page
 * it withheld an "Enter Website" button until the visitor had dropped three grains —
 * a threshold worth crossing when the game stood between a visitor and the site. At
 * `/games/grains` the visitor has already been to the site to get here, so the gate
 * was a door into a room they were standing in. `backHref` is a plain link back to
 * the games index, shown immediately and never withheld; nothing else on the screen
 * changed.
 */
export default function GrainsGame() {
  return <GrainsScreen backHref="/games" />;
}
