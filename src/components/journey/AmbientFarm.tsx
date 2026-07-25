"use client";

import { useState } from "react";
import { HERO_FARM_AMBIENT } from "@/config/site";
import { asset } from "@/lib/asset";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/**
 * Hero backdrop. A pure-CSS gradient "paddy at golden hour" is ALWAYS present
 * (so the hero works with zero images). When HERO_FARM_AMBIENT is on and motion
 * is allowed, a muted, looping low-fps farm loop is layered over it; if the
 * asset is missing it simply fails to load and the gradient shows through.
 */
export function AmbientFarm() {
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);
  const showLoop = HERO_FARM_AMBIENT && !reduced && !failed;

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {/* CSS fallback — always rendered */}
      <div className="ambient-farm absolute inset-0" />

      {/* Optional muted loop over the gradient */}
      {showLoop && (
        <video
          className="absolute inset-0 h-full w-full object-cover opacity-15"
          autoPlay
          muted
          loop
          playsInline
          onError={() => setFailed(true)}
          poster={asset("/farm-ambient.jpg")}
        >
          <source src={asset("/farm-ambient.webm")} type="video/webm" />
        </video>
      )}

      {/* Faint drifting grains (CSS, motion-gated) */}
      {!reduced && (
        <div className="hero-drift absolute inset-0">
          <span style={{ left: "18%", animationDelay: "0s" }} />
          <span style={{ left: "38%", animationDelay: "2.4s" }} />
          <span style={{ left: "58%", animationDelay: "1.2s" }} />
          <span style={{ left: "78%", animationDelay: "3.1s" }} />
          <span style={{ left: "88%", animationDelay: "0.7s" }} />
        </div>
      )}
    </div>
  );
}
