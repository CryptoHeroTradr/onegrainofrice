#!/usr/bin/env node
/**
 * Generates the PFP overlay layers as real 512×512 transparent PNGs in
 * public/pfp/ (rasterized from inline SVG via sharp — no network, no browser).
 * These are placeholders: drop real transparent PNGs with the same names to swap.
 *
 *   pnpm gen:pfp
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "pfp");
mkdirSync(outDir, { recursive: true });

const KHAKI = "#C4B370";
const KHAKI_DK = "#8a7c3a";
const PORC = "#2A4D8F";
const TUNA = "#C1443A";
const STEAMED = "#FBF7EE";
const OLIVE = "#6A6C3A";

const svgDoc = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${inner}</svg>`;

const OVERLAYS = {
  // Chopsticks — two positions.
  "chopsticks-1": svgDoc(`
    <g stroke="${KHAKI}" stroke-width="15" stroke-linecap="round">
      <line x1="478" y1="52" x2="250" y2="300"/>
      <line x1="432" y1="34" x2="214" y2="286"/>
    </g>
    <g stroke="${KHAKI_DK}" stroke-width="15" stroke-linecap="round">
      <line x1="276" y1="272" x2="250" y2="300"/>
      <line x1="240" y1="258" x2="214" y2="286"/>
    </g>`),
  "chopsticks-2": svgDoc(`
    <g stroke="${KHAKI}" stroke-width="15" stroke-linecap="round">
      <line x1="34" y1="352" x2="300" y2="300"/>
      <line x1="30" y1="404" x2="300" y2="336"/>
    </g>
    <g stroke="${KHAKI_DK}" stroke-width="15" stroke-linecap="round">
      <line x1="272" y1="306" x2="300" y2="300"/>
      <line x1="270" y1="342" x2="300" y2="336"/>
    </g>`),
  // Rice bowls — two styles (porcelain / red-rim).
  "bowl-1": svgDoc(`
    <ellipse cx="256" cy="368" rx="150" ry="30" fill="${STEAMED}"/>
    <path d="M120 366 Q140 300 256 300 Q372 300 392 366 Z" fill="${STEAMED}"/>
    <path d="M110 370 Q150 470 256 486 Q362 470 402 370" fill="#eef2f8" stroke="${PORC}" stroke-width="7" stroke-linecap="round"/>
    <path d="M110 370 Q256 400 402 370" fill="none" stroke="${PORC}" stroke-width="3" opacity="0.5"/>
    <g fill="${PORC}" opacity="0.8"><circle cx="190" cy="430" r="5"/><circle cx="256" cy="446" r="5"/><circle cx="322" cy="430" r="5"/></g>`),
  "bowl-2": svgDoc(`
    <ellipse cx="256" cy="368" rx="150" ry="30" fill="${STEAMED}"/>
    <path d="M120 366 Q140 296 256 296 Q372 296 392 366 Z" fill="${STEAMED}"/>
    <path d="M110 370 Q150 474 256 490 Q362 474 402 370" fill="#fbeae7" stroke="${TUNA}" stroke-width="8" stroke-linecap="round"/>
    <path d="M110 372 Q256 402 402 372" fill="none" stroke="${TUNA}" stroke-width="3" opacity="0.5"/>`),
  // $RICE grain badge (corner).
  badge: svgDoc(`
    <g transform="translate(84,84)">
      <circle r="60" fill="${OLIVE}"/>
      <circle r="60" fill="none" stroke="${STEAMED}" stroke-width="5"/>
      <ellipse cx="0" cy="-6" rx="15" ry="30" fill="${STEAMED}"/>
      <ellipse cx="-5" cy="-14" rx="4" ry="10" fill="#ffffff" opacity="0.7"/>
      <path d="M-26 34 L26 34" stroke="${KHAKI}" stroke-width="7" stroke-linecap="round"/>
    </g>`),
};

for (const [name, svg] of Object.entries(OVERLAYS)) {
  const out = join(outDir, `${name}.png`);
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log(`wrote public/pfp/${name}.png`);
}
