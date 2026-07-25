import { NextResponse, type NextRequest } from "next/server";
import { languageForCountry } from "@/lib/i18n/countryLang";

/**
 * Stamp the visitor's IP-guessed language into a cookie the client can read.
 *
 * nginx resolves the country from the GeoIP2 database into `X-Country-Code` on
 * every request already (the grains leaderboard uses the same header), so the
 * guess is free. We do it HERE rather than by calling `headers()` in the root
 * layout, because reading a header there opts every page out of static rendering
 * — /home, /memes and /pfp would all become dynamic, losing their prerender and
 * their immutable cache headers. Middleware runs ahead of the cache and just
 * attaches a cookie, so the pages stay static.
 *
 * This is only a SUGGESTION for TranslateProvider. A visitor's explicit language
 * choice is stored separately and always wins.
 */

const COOKIE = "rice_geo_lang";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Don't re-stamp on every navigation once it's there.
  if (req.cookies.get(COOKIE)) return res;

  const lang = languageForCountry(req.headers.get("x-country-code"));
  res.cookies.set(COOKIE, lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    // Readable by the client — TranslateProvider needs it, and it's not a secret.
    httpOnly: false,
  });
  return res;
}

export const config = {
  // Skip static assets, the image optimizer, and API routes — nothing there
  // renders UI, so a language guess would be pointless overhead.
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|wav|mp3|mp4|webm|woff2?|ttf|otf)$).*)"],
};
