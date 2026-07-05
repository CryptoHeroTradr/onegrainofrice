import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * SERVER-ONLY. Pick the real asset if it's been dropped into public/, else the
 * generated placeholder — so slots never 404 before real art exists.
 *
 * Runs at build time (pages are statically prerendered). Do NOT import from a
 * client component; only server components (MemeWall, Hero, Impact) use it.
 * The returned path still goes through asset() at the <Image> for basePath.
 */
export function resolveAsset(preferred: string, fallback: string): string {
  try {
    const rel = preferred.replace(/^\//, "");
    return existsSync(join(process.cwd(), "public", rel)) ? preferred : fallback;
  } catch {
    return fallback;
  }
}

/** Fallback placeholder path for a meme: same id, always-present .svg. */
export function memePlaceholder(id: string): string {
  return `/memes/${id}.svg`;
}
