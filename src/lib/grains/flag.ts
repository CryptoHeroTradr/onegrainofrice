/**
 * Pure ISO country-code → flag/name helpers, shared by the client leaderboards
 * and the server-side ticker. No React, no node built-ins — safe to import from
 * either side.
 */

/** Emoji flag from a 2-letter ISO code. "XX"/unknown → globe (no image). */
export function flagEmoji(code: string): string {
  const cc = (code || "").toUpperCase();
  if (cc === "XX" || !/^[A-Z]{2}$/.test(cc)) return "🌏";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + cc.charCodeAt(0) - 65, A + cc.charCodeAt(1) - 65);
}

/** Neutral label for unknown/absent country. */
export function friendlyCountryName(code: string, name: string | null | undefined): string {
  if ((code || "").toUpperCase() === "XX" || !name || name === "Unknown") return "Unknown region";
  return name;
}

/**
 * Every GeoIP miss collapses into one bucket ("XX" / "Unknown"), which is not a
 * country and must not compete on a country leaderboard — on the grains board it was
 * ranking #2 before it was filtered out.
 *
 * Moved here from `components/grains/CountryLeaderboard.tsx` on 2026-08-05, when RICE
 * CHOMP briefly had a country board of its own that needed the same rule. That board
 * was removed the same day; the grains board is the only caller again. It stays here
 * rather than moving back: this module is the shared, server-safe home for the other
 * two country helpers, moving it a second time would be a second edit to shipped
 * grains code for no behavioural gain, and the next thing that needs the predicate
 * will look here first. Same predicate, same caller, unchanged behaviour throughout.
 *
 * RICE CHOMP does not use it. Its one board is ranked per player, never per country,
 * so it has nothing to filter: a player whose GeoIP missed gets the globe `flagEmoji`
 * already returns for "XX" and keeps their rank, because their SCORE is real.
 */
export function isUnknownCountry(c: { code: string; name?: string | null }): boolean {
  return c.code === "XX" || !c.code || c.name === "Unknown";
}
