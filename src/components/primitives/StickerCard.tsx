import Image from "next/image";
import { asset } from "@/lib/asset";
import { Tape } from "./Tape";

/**
 * A meme sticker in one of two treatments:
 *  - "cutout" (default): no frame; the image floats with a silhouette drop-shadow
 *    + faux white keyline. Meant for transparent PNG cut-outs.
 *  - "photo": rectangular framed photo with a slim cream edge and a caption
 *    banner (used for the rice-fields shot).
 * Tape and caption are optional; tilt via `rotation`.
 */
export function StickerCard({
  src,
  alt,
  caption,
  rotation = 0,
  tape = true,
  priority = false,
  sizes,
  variant = "cutout",
  aspect = "aspect-[4/5]",
}: {
  src: string;
  alt: string;
  caption?: string;
  rotation?: number;
  tape?: boolean;
  priority?: boolean;
  sizes?: string;
  variant?: "cutout" | "photo";
  aspect?: string;
}) {
  if (variant === "photo") {
    return (
      <figure className="sticker relative" style={{ transform: `rotate(${rotation}deg)` }}>
        <div className="bg-bone p-1.5">
          <div className={`relative ${aspect} overflow-hidden bg-paper-dark`}>
            <Image
              src={asset(src)}
              alt={alt}
              fill
              sizes={sizes ?? "(min-width: 768px) 320px, 70vw"}
              priority={priority}
              className="object-cover"
            />
            {caption && (
              <figcaption className="absolute inset-x-0 top-0 bg-olive/90 px-2 py-1 text-center font-mono text-[0.55rem] font-bold uppercase tracking-wider text-bone sm:text-[0.65rem]">
                {caption}
              </figcaption>
            )}
          </div>
        </div>
        {tape && (
          <Tape className="absolute -top-2.5 left-1/2 w-16 -translate-x-1/2 -rotate-3 sm:w-20" />
        )}
      </figure>
    );
  }

  // Cut-out: transparent silhouette, no frame.
  return (
    <figure className="relative" style={{ transform: `rotate(${rotation}deg)` }}>
      <div className={`sticker-cutout relative ${aspect}`}>
        <Image
          src={asset(src)}
          alt={alt}
          fill
          sizes={sizes ?? "(min-width: 768px) 320px, 70vw"}
          priority={priority}
          className="object-contain"
        />
      </div>
      {caption && (
        <figcaption className="mt-1 text-center font-mono text-[0.6rem] font-bold uppercase tracking-widest text-khaki">
          {caption}
        </figcaption>
      )}
      {tape && (
        <Tape className="absolute -top-2.5 left-1/2 w-16 -translate-x-1/2 -rotate-3 sm:w-20" />
      )}
    </figure>
  );
}
