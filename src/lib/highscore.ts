/**
 * Grain-catch high score — session-only (module variable, no storage, SSR-safe).
 * Resets on reload. Used when no writable RiceDAO score store exists.
 */
let high = 0;

export function getHighScore() {
  return high;
}

/** Record a score; returns true if it's a new session high. */
export function recordScore(score: number): boolean {
  if (score > high) {
    high = score;
    return true;
  }
  return false;
}
