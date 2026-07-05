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
 */

export type Meme = {
  id: string;
  src: string;
  alt: string;
  caption?: string;
  rotation?: number;
  photo?: boolean;
};

export const memes: Meme[] = [
  { id: "biden-bowl",          src: "/memes/biden-bowl.png",          alt: "Biden eating from a takeout box of rice" },
  { id: "gatsby-cheers",       src: "/memes/gatsby-cheers.png",       alt: "DiCaprio in a tux raising a bowl of rice" },
  { id: "bowl-guy",            src: "/memes/bowl-guy.png",            alt: "Bearded man cradling a dark bowl of rice" },
  { id: "rice-cube",           src: "/memes/rice-cube.png",           alt: "Ice Cube in a 'RICE CUBE' jersey with a plate of rice cubes" },
  { id: "mona-lisa",           src: "/memes/mona-lisa.png",           alt: "Mona Lisa eating rice with chopsticks" },
  { id: "heart-grain",         src: "/memes/heart-grain.png",         alt: "A translucent puffy heart made of rice" },
  { id: "rice-fields-brother", src: "/memes/rice-fields-brother.jpg", alt: "A man crawling through a green rice field", caption: "WELCOME TO THE RICE FIELDS, BROTHER", photo: true },
];
