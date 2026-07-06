#!/usr/bin/env node
/**
 * Rasterizes the $RICE mascot (happy, chopsticks) to reusable transparent PNGs
 * in public/brand/ at 256 and 512 (for favicon / OG / stickers later). Kept
 * visually in sync with src/components/brand/GrainMascot.tsx.
 *
 *   pnpm gen:brand
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "brand");
mkdirSync(outDir, { recursive: true });

const INK = "#14110d";
const CREAM = "#fbf7ee";
const KHAKI = "#c4b370";

// Happy mascot with chopsticks (matches the GrainMascot "happy" mood).
const mascot = `
  <ellipse cx="84" cy="214" rx="13" ry="7" fill="${INK}"/>
  <ellipse cx="116" cy="214" rx="13" ry="7" fill="${INK}"/>
  <g stroke-linecap="round" fill="none">
    <path d="M58 152 q-20 6 -26 26" stroke="${INK}" stroke-width="15"/>
    <path d="M142 152 q20 6 26 26" stroke="${INK}" stroke-width="15"/>
    <path d="M58 152 q-20 6 -26 26" stroke="${CREAM}" stroke-width="9"/>
    <path d="M142 152 q20 6 26 26" stroke="${CREAM}" stroke-width="9"/>
  </g>
  <path d="M100 34 C132 34 146 74 146 120 C146 176 128 210 100 210 C72 210 54 176 54 120 C54 74 68 34 100 34 Z" fill="${CREAM}" stroke="${INK}" stroke-width="3.5"/>
  <path d="M78 60 C70 82 70 110 76 134" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" opacity="0.6"/>
  <circle cx="76" cy="136" r="7" fill="${KHAKI}" opacity="0.55"/>
  <circle cx="124" cy="136" r="7" fill="${KHAKI}" opacity="0.55"/>
  <g fill="${INK}">
    <circle cx="82" cy="116" r="6.5"/><circle cx="118" cy="116" r="6.5"/>
    <circle cx="79.5" cy="113.5" r="2" fill="${CREAM}"/><circle cx="115.5" cy="113.5" r="2" fill="${CREAM}"/>
  </g>
  <path d="M84 146 q16 16 32 0" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
  <g stroke="${KHAKI}" stroke-width="5" stroke-linecap="round">
    <line x1="150" y1="182" x2="196" y2="120"/><line x1="140" y1="184" x2="182" y2="118"/>
    <g stroke="#8a7c3a"><line x1="192" y1="126" x2="196" y2="120"/><line x1="178" y1="124" x2="182" y2="118"/></g>
  </g>`;

const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <svg x="86" y="16" width="340" height="480" viewBox="0 0 200 240">${mascot}</svg>
</svg>`;

for (const px of [256, 512]) {
  const out = join(outDir, `mascot-${px}.png`);
  await sharp(Buffer.from(doc)).resize(px, px).png().toFile(out);
  console.log(`wrote public/brand/mascot-${px}.png`);
}
