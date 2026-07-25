import Link from "next/link";
import { memes } from "@/config/memes";
import { resolveAsset, memePlaceholder } from "@/lib/resolveAsset";
import { SushiBelt } from "./SushiBelt";

/**
 * Server wrapper for the sushi belt: resolves each meme's `src` to the real
 * file if present, else its generated placeholder (so first render is never
 * broken), then hands the resolved list to the client belt. This is the piece
 * the rebuilt homepage drops in.
 *
 * The "Enter Rice Palace" link sits in the section's upper-right corner as a
 * SIBLING of the belt, not inside it: the belt viewport is a drag/swipe surface
 * that captures pointer gestures, so nesting the link there would let a stray
 * drag swallow the click.
 */
export function SushiBeltSection() {
  const resolved = memes.map((m) => ({
    ...m,
    src: resolveAsset(m.src, memePlaceholder(m.id)),
  }));

  return (
    <div className="relative">
      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <Link
          href="/memes"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-khaki/40 bg-black/50 px-4 py-2 font-display-round text-sm font-bold text-khaki shadow-lg backdrop-blur transition-transform hover:scale-105 hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki sm:px-5 sm:text-base"
        >
          <span aria-hidden="true">🏯</span>
          Enter Rice Palace
        </Link>
      </div>
      <SushiBelt memes={resolved} />
    </div>
  );
}
