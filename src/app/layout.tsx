import type { Metadata } from "next";
import { display, displayRound, mono } from "./fonts";
import { site } from "@/config/site";
import { RiceProvider } from "@/components/rice/RiceParticles";
import { ChopstickCursor } from "@/components/rice/ChopstickCursor";
import { KonamiRice } from "@/components/eggs/KonamiRice";
import "./globals.css";

export const metadata: Metadata = {
  title: `${site.ticker} — ${site.name}`,
  description: site.tagline,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${displayRound.variable} ${mono.variable} antialiased`}
    >
      <body className="min-h-screen bg-ink text-paper">
        <RiceProvider>
          {children}
          <KonamiRice />
        </RiceProvider>
        <ChopstickCursor />
      </body>
    </html>
  );
}
