import type { Metadata } from "next";
import { GrainsScreen } from "@/components/grains/GrainsScreen";

export const metadata: Metadata = {
  title: "One Grain of Rice — tap to drop a grain",
  description:
    "Tap to add a grain of rice toward a live global total. Drop 3 grains, then enter the site.",
};

// Realtime + per-visitor session cookie (set by /grains/session) → always dynamic.
export const dynamic = "force-dynamic";

/**
 * The landing page IS the Grains Game. Visitors must drop 3 grains before the
 * "Enter Website" button (lower-right) appears, which takes them into the main
 * site at /home. The full site chrome (nav/footer) lives on /home.
 */
export default function Landing() {
  return <GrainsScreen enterWebsiteHref="/home" />;
}
