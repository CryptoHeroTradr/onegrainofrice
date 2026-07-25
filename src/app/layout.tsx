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
// Link-preview (OG) image — the game-preview art.
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
        alt: `${site.name} — tap to drop a grain of rice`,
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
