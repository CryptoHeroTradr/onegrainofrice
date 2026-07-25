/**
 * Grains game — the anonymous, rice-themed player handle.
 *
 * A player who hasn't chosen a name still needs to appear on the Top Players
 * board without exposing their opaque visitor id. `playerHandle` derives a
 * stable, friendly name from the vid: the SAME vid always yields the SAME
 * handle, and the vid is not recoverable from it.
 *
 * A player who HAS chosen a name (visitors.display_name) overrides this — see
 * the WS server, which prefers the stored name and falls back here.
 *
 * SERVER-ONLY (the vid must never reach the browser).
 */

import { createHash } from "node:crypto";

const ADJECTIVES = [
  "Steamed",
  "Sticky",
  "Toasty",
  "Sunny",
  "Golden",
  "Jasmine",
  "Crispy",
  "Fluffy",
  "Nutty",
  "Humble",
  "Wild",
  "Silky",
  "Hearty",
  "Fragrant",
  "Tender",
  "Brave",
] as const;

const NOUNS = [
  "Grain",
  "Onigiri",
  "Risotto",
  "Congee",
  "Paella",
  "Basmati",
  "Bowl",
  "Sprout",
  "Paddy",
  "Harvest",
  "Sushi",
  "Pilaf",
  "Farmer",
  "Kernel",
  "Husk",
  "Sickle",
] as const;

/**
 * Deterministic handle for a vid, e.g. "Toasty Risotto 45". Two independent
 * byte slices pick the adjective/noun, and a third supplies a small number, so
 * collisions between different vids stay unlikely without a DB lookup.
 */
export function playerHandle(vid: string): string {
  const h = createHash("sha256").update(vid).digest();
  const adj = ADJECTIVES[h[0] % ADJECTIVES.length];
  const noun = NOUNS[h[1] % NOUNS.length];
  const num = ((h[2] << 8) | h[3]) % 100;
  return `${adj} ${noun} ${num}`;
}
