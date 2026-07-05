/**
 * All fonts in one place — swap the imports here and the whole site follows.
 * `next/font` self-hosts at BUILD time; zero runtime external requests.
 *   - Google faces (Zilla Slab, Courier Prime) are fetched + self-hosted at build.
 *   - Fredoka is a LOCAL woff2 in public/fonts/ (fontsource, SIL OFL) loaded via
 *     next/font/local — no build-time network needed for it.
 */
import { Zilla_Slab, Courier_Prime } from "next/font/google";
import localFont from "next/font/local";

/** Display (slab) / headings — heavy slab serif, poster weight. */
export const display = Zilla_Slab({
  weight: ["500", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display-next",
  display: "swap",
});

/** Display (round) — chunky, warm, mochi-like face for headlines. */
export const displayRound = localFont({
  src: [
    { path: "../../public/fonts/fredoka-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/fredoka-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/fredoka-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/fredoka-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display-round-next",
  display: "swap",
});

/** Body / labels — typewriter mono for the zine feel. */
export const mono = Courier_Prime({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-mono-next",
  display: "swap",
});
