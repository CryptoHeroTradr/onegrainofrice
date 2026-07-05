import type { Metadata } from "next";
import { display, mono } from "./fonts";
import { site } from "@/config/site";
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
    <html lang="en" className={`${display.variable} ${mono.variable} antialiased`}>
      <body className="min-h-screen bg-ink text-paper">{children}</body>
    </html>
  );
}
