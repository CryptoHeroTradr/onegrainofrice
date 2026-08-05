import type { Metadata } from "next";
import { GrainMascot } from "@/components/brand/GrainMascot";
import { HomeButton } from "@/components/brand/HomeButton";

export const metadata: Metadata = { title: "Lost grain — 404" };

/**
 * 404 — the mascot holds an empty bowl. The button routes to "/", which
 * next/navigation prefixes with the basePath.
 *
 * *Phase 7, 2026-08-05:* the target did not change and the LABEL did. "/" used to
 * be the Grains Game, so "Back to the bowl" was literal — it meant the rice bowl
 * you tap. "/" is the home page now, and a 404 button that says "bowl" and lands
 * on tokenomics is a small lie. "Back to the paddy" is what the rest of the site
 * already calls the home page (see ChompScreen's PADDY_LABEL), so this is now one
 * phrase for one destination rather than two phrases for what used to be two.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-steamed px-6 text-center text-nori">
      <GrainMascot mood="sleepy" holding="empty-bowl" size={160} title="A lost grain with an empty bowl" />
      <h1 className="font-display-round text-5xl font-bold text-bamboo">this grain got lost</h1>
      <p className="max-w-sm font-mono text-sm text-nori/70">
        Empty bowl, wrong turn. The page you’re after isn’t on the belt — let’s get you back to
        the rice fields.
      </p>
      <HomeButton label="Back to the paddy" />
    </div>
  );
}
