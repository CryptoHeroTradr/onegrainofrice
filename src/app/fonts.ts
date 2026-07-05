/**
 * All fonts in one place — swap the imports here and the whole site follows.
 * `next/font` downloads at BUILD time and self-hosts; zero runtime Google requests.
 */
import { Zilla_Slab, Courier_Prime } from "next/font/google";

/** Display / headings — heavy slab serif, poster weight. */
export const display = Zilla_Slab({
  weight: ["500", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display-next",
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
