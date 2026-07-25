/**
 * The meme deck — feeds BOTH the static collage (row 1) and the carousel (row 2).
 *
 * To swap a meme:
 *   1. Drop your image into /public/memes/ (transparent PNG cut-outs look best;
 *      the rice-fields one is a rectangular photo), and
 *   2. Point `src` at it below. Done.
 *
 * If a `src` file isn't present yet, the app falls back to the generated
 * /memes/<id>.svg placeholder (see src/lib/resolveAsset.ts) so nothing 404s.
 * Regenerate placeholders with `pnpm placeholders`.
 *
 * `rotation` is the sticker tilt in degrees; `photo: true` marks a rectangular
 * framed photo (keeps a cream edge + caption banner) instead of a cut-out.
 *
 * Belt (Phase 6): `belt` (default true) includes the meme on the sushi belt;
 * `plate` tints its porcelain dish. The array supports N memes — if you add a
 * new `id`, re-run `pnpm gen:memes` so a placeholder SVG exists for it.
 */

export type PlateTint = "blue" | "red" | "green";

export type Meme = {
  id: string;
  src: string;
  alt: string;
  caption?: string;
  rotation?: number;
  photo?: boolean;
  /** Include on the sushi belt. Default true. */
  belt?: boolean;
  /** Porcelain plate tint on the belt. Default cycles blue→red→green. */
  plate?: PlateTint;
  /**
   * This meme came from the shared media pool (/media/), not from public/.
   *
   * Its `src` is therefore already a final URL and must NOT go through asset():
   * the pool lives at the server root, outside this app's basePath, and its
   * filenames are content hashes served immutable for a year. See lib/mediaPool.ts.
   *
   * Never set on the memes below — they ARE the fallback deck, and they are
   * build output like any other asset in public/.
   */
  pooled?: boolean;
};

export const memes: Meme[] = [
  { id: "biden-bowl",          src: "/memes/biden-bowl.png",          alt: "Biden eating from a takeout box of rice",                              plate: "blue" },
  { id: "gatsby-cheers",       src: "/memes/gatsby-cheers.png",       alt: "DiCaprio in a tux raising a bowl of rice",                             plate: "red" },
  { id: "bowl-guy",            src: "/memes/bowl-guy.png",            alt: "Bearded man cradling a dark bowl of rice",                             plate: "green" },
  { id: "rice-cube",           src: "/memes/rice-cube.png",           alt: "Ice Cube in a 'RICE CUBE' jersey with a plate of rice cubes",          plate: "blue" },
  { id: "mona-lisa",           src: "/memes/mona-lisa.png",           alt: "Mona Lisa eating rice with chopsticks",                                plate: "red" },
  { id: "heart-grain",         src: "/memes/heart-grain.png",         alt: "A translucent puffy heart made of rice",                               plate: "green" },
  { id: "rice-fields-brother", src: "/memes/rice-fields-brother.jpg", alt: "A man crawling through a green rice field", caption: "WELCOME TO THE RICE FIELDS, BROTHER", photo: true, plate: "blue" },
];

/** Resolve a meme's plate tint (explicit, else cycle by index). */
export function plateTint(meme: Meme, index: number): PlateTint {
  return meme.plate ?? (["blue", "red", "green"] as const)[index % 3];
}
