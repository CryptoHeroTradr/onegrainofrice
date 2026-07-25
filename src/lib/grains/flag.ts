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
