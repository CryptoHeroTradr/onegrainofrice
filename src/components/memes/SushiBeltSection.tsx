import { memes } from "@/config/memes";
import { resolveAsset, memePlaceholder } from "@/lib/resolveAsset";
import { SushiBelt } from "./SushiBelt";

/**
 * Server wrapper for the sushi belt: resolves each meme's `src` to the real
 * file if present, else its generated placeholder (so first render is never
 * broken), then hands the resolved list to the client belt. This is the piece
 * the rebuilt homepage drops in.
 */
export function SushiBeltSection() {
  const resolved = memes.map((m) => ({
    ...m,
    src: resolveAsset(m.src, memePlaceholder(m.id)),
  }));
  return <SushiBelt memes={resolved} />;
}
