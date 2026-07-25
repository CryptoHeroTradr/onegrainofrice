import { StickerCard } from "@/components/primitives/StickerCard";
import type { Meme } from "@/config/memes";

/**
 * Static, hand-made collage band (row 1 of the meme wall). Cut-outs are
 * absolutely positioned to mirror the reference's relative layout on desktop,
 * and reflow to a tighter 2-column stack on mobile. Deterministic positions
 * and tilts — no Math.random, so SSR and client agree.
 *
 * THE SLOT OWNS THE SHAPE; THE MEME ONLY SUPPLIES THE PICTURE.
 *
 * This used to look each meme up BY ID (`byId.get("gatsby-cheers")`), which quietly
 * hard-wired the collage to the seven memes in config/memes.ts. Pool memes are
 * identified by their content hash, so under that scheme every slot would miss and
 * the collage would render nothing at all.
 *
 * Positions, sizes, tilts, tape and the one photo treatment are a hand-made LAYOUT —
 * they belong to the design, not to any particular meme. So the deck is consumed
 * POSITIONALLY: slot i takes deck[i]. Any seven memes can fill the band, and it keeps
 * the arrangement it was drawn with.
 */

type Slot = {
  left: string;
  top: string;
  width: string;
  z: number;
  rotation: number;
  tape: boolean;
  /**
   * Framed-photo treatment rather than a floating cut-out: cream edge, caption
   * banner, 4:3, and a full-width span on mobile. Exactly ONE slot has it, because
   * the band was drawn with one rectangular photo in it.
   *
   * It is a property of the SLOT, not the meme. Reading it off the meme (as this
   * component used to) means a pool of seven photos turns every slot into a
   * full-width frame and the layout collapses — and every pool meme is a photo,
   * because the pool holds screenshots and GIFs, not transparent cut-outs.
   */
  photo?: boolean;
};

// Percentages are relative to the sized band. Mirrors the reference arrangement.
// This order is also the mobile reading order AND the order slots draw from the deck.
const LAYOUT: Slot[] = [
  { left: "37%", top: "0%", width: "23%", z: 40, rotation: 1, tape: false }, // center-top anchor (largest)
  { left: "4%", top: "5%", width: "17%", z: 20, rotation: -4, tape: true }, // upper-left
  { left: "77%", top: "3%", width: "19%", z: 20, rotation: 4, tape: true }, // upper-right
  { left: "6%", top: "46%", width: "20%", z: 26, rotation: -5, tape: false }, // lower-left
  { left: "34%", top: "50%", width: "20%", z: 30, rotation: -2, tape: true }, // lower-center
  { left: "60%", top: "40%", width: "13%", z: 34, rotation: 3, tape: false }, // center-right small
  { left: "68%", top: "54%", width: "27%", z: 24, rotation: 2, tape: true, photo: true }, // lower-right photo
];

/**
 * How many memes the collage needs in order to be itself.
 *
 * The band is a fixed arrangement of seven; it cannot be drawn with three without
 * leaving holes in a hand-placed layout. A deck shorter than this cannot satisfy the
 * collage's shape, and the caller falls back to the hardcoded deck instead.
 */
export const COLLAGE_SLOTS = LAYOUT.length;

const MOBILE_TILTS = [-4, 3, -2, 4, -3, 2, -1];

export function MemeCollage({ memes }: { memes: Meme[] }) {
  return (
    <div>
      {/* Desktop: absolute scattered band */}
      <div className="relative hidden h-[30rem] md:block lg:h-[34rem]">
        {LAYOUT.map((slot, i) => {
          const meme = memes[i];
          if (!meme) return null;
          return (
            <div
              key={meme.id}
              className="absolute"
              style={{ left: slot.left, top: slot.top, width: slot.width, zIndex: slot.z }}
            >
              <StickerCard
                src={meme.src}
                alt={meme.alt}
                caption={meme.caption}
                rotation={slot.rotation}
                tape={slot.tape}
                variant={slot.photo ? "photo" : "cutout"}
                aspect={slot.photo ? "aspect-[4/3]" : "aspect-[4/5]"}
                sizes="(min-width: 1024px) 320px, 40vw"
                srcIsFinal={meme.pooled}
              />
            </div>
          );
        })}
      </div>

      {/* Mobile: tighter 2-column stack, same reading order. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 px-2 md:hidden">
        {LAYOUT.map((slot, i) => {
          const meme = memes[i];
          if (!meme) return null;
          return (
            <div key={meme.id} className={slot.photo ? "col-span-2 mx-auto w-2/3" : ""}>
              <StickerCard
                src={meme.src}
                alt={meme.alt}
                caption={meme.caption}
                rotation={MOBILE_TILTS[i % MOBILE_TILTS.length]}
                tape={i % 2 === 0}
                variant={slot.photo ? "photo" : "cutout"}
                aspect={slot.photo ? "aspect-[4/3]" : "aspect-[4/5]"}
                sizes="45vw"
                srcIsFinal={meme.pooled}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
