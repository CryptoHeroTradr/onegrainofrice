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
 * Moved here from `components/grains/CountryLeaderboard.tsx` when RICE CHOMP's board
 * needed the same rule: two copies of "what counts as a country" is one copy too
 * many, and this module is already the shared, server-safe home for the other two
 * country helpers. The grains board's behaviour is unchanged — same predicate, same
 * caller, one import moved.
 */
export function isUnknownCountry(c: { code: string; name?: string | null }): boolean {
  return c.code === "XX" || !c.code || c.name === "Unknown";
}
