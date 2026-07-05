import { StickerCard } from "@/components/primitives/StickerCard";
import type { Meme } from "@/config/memes";

/**
 * Static, hand-made collage band (row 1 of the meme wall). Cut-outs are
 * absolutely positioned to mirror the reference's relative layout on desktop,
 * and reflow to a tighter 2-column stack on mobile. Deterministic positions
 * and tilts — no Math.random, so SSR and client agree.
 */

type Slot = {
  id: string;
  left: string;
  top: string;
  width: string;
  z: number;
  rotation: number;
  tape: boolean;
};

// Percentages are relative to the sized band. Mirrors the reference arrangement.
const LAYOUT: Slot[] = [
  { id: "gatsby-cheers",       left: "37%", top: "0%",  width: "23%", z: 40, rotation: 1,  tape: false }, // center-top anchor (largest)
  { id: "biden-bowl",          left: "4%",  top: "5%",  width: "17%", z: 20, rotation: -4, tape: true },  // upper-left
  { id: "bowl-guy",            left: "77%", top: "3%",  width: "19%", z: 20, rotation: 4,  tape: true },  // upper-right
  { id: "rice-cube",           left: "6%",  top: "46%", width: "20%", z: 26, rotation: -5, tape: false }, // lower-left
  { id: "mona-lisa",           left: "34%", top: "50%", width: "20%", z: 30, rotation: -2, tape: true },  // lower-center
  { id: "heart-grain",         left: "60%", top: "40%", width: "13%", z: 34, rotation: 3,  tape: false }, // center-right small
  { id: "rice-fields-brother", left: "68%", top: "54%", width: "27%", z: 24, rotation: 2,  tape: true },  // lower-right photo
];

// Mobile stack order (roughly matches reading order of the collage).
const MOBILE_ORDER = [
  "gatsby-cheers",
  "biden-bowl",
  "bowl-guy",
  "rice-cube",
  "mona-lisa",
  "heart-grain",
  "rice-fields-brother",
];

export function MemeCollage({ memes }: { memes: Meme[] }) {
  const byId = new Map(memes.map((m) => [m.id, m]));

  return (
    <div>
      {/* Desktop: absolute scattered band */}
      <div className="relative hidden h-[30rem] md:block lg:h-[34rem]">
        {LAYOUT.map((slot) => {
          const meme = byId.get(slot.id);
          if (!meme) return null;
          return (
            <div
              key={slot.id}
              className="absolute"
              style={{ left: slot.left, top: slot.top, width: slot.width, zIndex: slot.z }}
            >
              <StickerCard
                src={meme.src}
                alt={meme.alt}
                caption={meme.caption}
                rotation={slot.rotation}
                tape={slot.tape}
                variant={meme.photo ? "photo" : "cutout"}
                aspect={meme.photo ? "aspect-[4/3]" : "aspect-[4/5]"}
                sizes="(min-width: 1024px) 320px, 40vw"
              />
            </div>
          );
        })}
      </div>

      {/* Mobile: tighter 2-column stack */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 px-2 md:hidden">
        {MOBILE_ORDER.map((id, i) => {
          const meme = byId.get(id);
          if (!meme) return null;
          const tilt = [-4, 3, -2, 4, -3, 2, -1][i % 7];
          const wide = meme.photo; // photo spans both columns
          return (
            <div key={id} className={wide ? "col-span-2 mx-auto w-2/3" : ""}>
              <StickerCard
                src={meme.src}
                alt={meme.alt}
                caption={meme.caption}
                rotation={tilt}
                tape={i % 2 === 0}
                variant={meme.photo ? "photo" : "cutout"}
                aspect={meme.photo ? "aspect-[4/3]" : "aspect-[4/5]"}
                sizes="45vw"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
