import type { Metadata } from "next";
import { display, displayRound, mono } from "./fonts";
import { site } from "@/config/site";
import { asset } from "@/lib/asset";
import { RiceProvider } from "@/components/rice/RiceParticles";
import { ChopstickCursor } from "@/components/rice/ChopstickCursor";
import { KonamiRice } from "@/components/eggs/KonamiRice";
import { TranslateProvider } from "@/components/i18n/TranslateProvider";
import "./globals.css";

// Canonical site origin, used to make the link-preview (OG) image URL absolute.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://1grainofrice.com";
/**
 * Link-preview (OG) image.
 *
 * *Phase 7, 2026-08-05.* This is the site-wide default, so it is what every share
 * of `/` shows — and until this phase `/` was the Grains Game, so the art, the alt
 * text and the OG `url` all described the clicker. After the swap they described a
 * page that is no longer there: "tap to drop a grain of rice", pointing at what is
 * now the home page.
 *
 * The FILE is unchanged and that is a decision, not an oversight. It is the only
 * 1200×630 asset in `public/` — the alternatives are 1536×1024 and 1024×1536,
 * wrong aspect for a link preview and 2.4 MB each — and what it actually shows is
 * the mascot on a rice bowl under a paddy sky, which is the brand rather than a
 * game screen: no HUD, no counter, no controls. So the wording moved to the site
 * and the picture stayed. **A bespoke home preview image is an art task and is
 * still open** — nothing here should be read as saying this one was chosen for the
 * home page.
 */
const previewImage = asset("/gamepreviewRICE.png");
const metaTitle = `${site.ticker} — ${site.name}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: metaTitle,
  description: site.tagline,
  openGraph: {
    type: "website",
    siteName: site.name,
    title: metaTitle,
    description: site.tagline,
    url: "/",
    images: [
      {
        url: previewImage,
        width: 1200,
        height: 630,
        alt: `${site.name} — the $RICE mascot on a full bowl of rice`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: metaTitle,
    description: site.tagline,
    images: [previewImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // NOTE: the IP-guessed language is NOT read here. Calling headers() in the root
  // layout would opt every page out of static rendering. `src/middleware.ts`
  // stamps it into a cookie instead, which TranslateProvider reads on the client.
  return (
    <html
      lang="en"
      className={`${display.variable} ${displayRound.variable} ${mono.variable} antialiased`}
    >
      <body className="min-h-screen bg-ink text-paper">
        <TranslateProvider>
          <RiceProvider>
            {children}
            <KonamiRice />
          </RiceProvider>
          <ChopstickCursor />
        </TranslateProvider>
      </body>
    </html>
  );
}
