#!/usr/bin/env node
/**
 * Generates labeled placeholder images so the site renders on first run
 * with zero real assets. Pure Node, no dependencies, no network.
 *
 *   pnpm placeholders
 *
 * Writes one SVG per meme into /public/memes/ plus the hero and impact
 * image slots. Real art replaces these by dropping files with the same
 * names (or editing src/config/memes.ts — one line per card).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Keep in sync with src/config/memes.ts (ids + filenames only; art is disposable).
const MEMES = [
  { file: "memes/biden-bowl.svg", label: "BIDEN\nBOWL" },
  { file: "memes/gatsby-cheers.svg", label: "GATSBY\nCHEERS" },
  { file: "memes/bowl-guy.svg", label: "BOWL\nGUY" },
  { file: "memes/rice-cube.svg", label: "RICE\nCUBE" },
  { file: "memes/mona-lisa.svg", label: "MONA\nLISA" },
  { file: "memes/rice-fields-brother.svg", label: "RICE FIELDS,\nBROTHER" },
  { file: "memes/heart-grain.svg", label: "HEART\nGRAIN" },
];

const INK = "#17150F";
const PAPER = "#EAE3D2";
const PAPER_DARK = "#D9CFB8";
const OLIVE = "#6A6C3A";
const KHAKI = "#C4B370";

/** Deterministic pseudo-random (seeded) so regeneration is stable. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tornRect(rand, x, y, w, h, jitter) {
  const pts = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) pts.push([x + (w * i) / steps, y + (rand() - 0.5) * jitter]);
  for (let i = 1; i <= steps; i++) pts.push([x + w + (rand() - 0.5) * jitter, y + (h * i) / steps]);
  for (let i = 1; i <= steps; i++) pts.push([x + w - (w * i) / steps, y + h + (rand() - 0.5) * jitter]);
  for (let i = 1; i < steps; i++) pts.push([x + (rand() - 0.5) * jitter, y + h - (h * i) / steps]);
  return pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
}

function riceGrains(rand, count, w, h) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const cx = 60 + rand() * (w - 120);
    const cy = 60 + rand() * (h - 120);
    const rot = Math.floor(rand() * 180);
    out += `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="14" ry="5" fill="${PAPER_DARK}" opacity="0.6" transform="rotate(${rot} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`;
  }
  return out;
}

function placeholderSVG(label, seed, w = 800, h = 1000) {
  const rand = mulberry32(seed);
  const lines = label.split("\n");
  const text = lines
    .map(
      (line, i) =>
        `<text x="${w / 2}" y="${h / 2 + (i - (lines.length - 1) / 2) * 84}" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="bold" font-size="72" letter-spacing="4" fill="${INK}">${line}</text>`,
    )
    .join("");

  // No dashed frame (reads as an upload dropzone). Torn paper blob + label so
  // the cut-out variant floats as a sticker with just a drop shadow.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <polygon points="${tornRect(rand, 24, 24, w - 48, h - 48, 18)}" fill="${PAPER}"/>
  ${riceGrains(rand, 26, w, h)}
  ${text}
  <text x="${w / 2}" y="${h - 120}" text-anchor="middle" font-family="'Courier New', monospace" font-size="28" letter-spacing="5" fill="${OLIVE}" opacity="0.75">[ swap in ${lines.join(" ").toLowerCase()} ]</text>
  <ellipse cx="${w / 2}" cy="${h / 2 + lines.length * 60 + 60}" rx="46" ry="17" fill="${KHAKI}"/>
</svg>
`;
}

mkdirSync(join(root, "public", "memes"), { recursive: true });

let seed = 42;
for (const meme of MEMES) {
  writeFileSync(join(root, "public", meme.file), placeholderSVG(meme.label, seed++));
  console.log(`wrote public/${meme.file}`);
}

// Hero slot: hand holding a glowing grain (stylized placeholder).
writeFileSync(
  join(root, "public", "hero-grain.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="${INK}"/>
  <radialGradient id="glow" cx="0.5" cy="0.42" r="0.5">
    <stop offset="0%" stop-color="${KHAKI}" stop-opacity="0.9"/>
    <stop offset="45%" stop-color="${KHAKI}" stop-opacity="0.25"/>
    <stop offset="100%" stop-color="${KHAKI}" stop-opacity="0"/>
  </radialGradient>
  <rect width="800" height="1000" fill="url(#glow)"/>
  <!-- hand-drawn radiating sparks around the grain -->
  <g stroke="${KHAKI}" stroke-width="6" stroke-linecap="round" opacity="0.9">
    <path d="M400 250 L 400 200 M330 300 L 300 262 M470 300 L 500 262 M300 360 L 258 350 M500 360 L 542 350 M350 250 L 332 214 M450 250 L 468 214"/>
  </g>
  <!-- single luminous grain -->
  <ellipse cx="400" cy="360" rx="46" ry="94" fill="${PAPER}"/>
  <ellipse cx="386" cy="335" rx="14" ry="34" fill="#ffffff" opacity="0.7"/>
  <!-- open upturned palm -->
  <path d="M 240 620 Q 270 540 350 528 L 470 528 Q 560 545 580 640 Q 592 760 500 812 L 330 812 Q 236 764 240 620 Z" fill="${OLIVE}" opacity="0.8"/>
  <path d="M 320 532 Q 330 470 358 462 M 388 528 Q 394 452 418 446 M 452 530 Q 460 458 484 456 M 512 542 Q 528 486 552 488" stroke="${OLIVE}" stroke-width="32" stroke-linecap="round" fill="none" opacity="0.8"/>
  <text x="400" y="930" text-anchor="middle" font-family="'Courier New', monospace" font-size="26" letter-spacing="5" fill="${KHAKI}" opacity="0.8">[ swap in hero-grain.png ]</text>
</svg>
`,
);
console.log("wrote public/hero-grain.svg");

// Impact slot: dramatic, high-contrast scene (reads well as B&W in the UI).
writeFileSync(
  join(root, "public", "impact-field.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs>
    <radialGradient id="burst" cx="0.5" cy="0.4" r="0.55">
      <stop offset="0%" stop-color="${PAPER}"/>
      <stop offset="30%" stop-color="#9a9068"/>
      <stop offset="100%" stop-color="${INK}"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="900" fill="${INK}"/>
  <rect width="1200" height="900" fill="url(#burst)"/>
  <!-- radiating light streaks -->
  <g stroke="${PAPER}" stroke-width="3" opacity="0.35">
    <path d="M600 360 L 300 60 M600 360 L 900 60 M600 360 L 120 240 M600 360 L 1080 240 M600 360 L 600 20"/>
  </g>
  <!-- billowing cloud silhouette -->
  <path d="M340 380 Q 380 300 470 320 Q 500 250 600 280 Q 700 250 730 330 Q 830 310 860 390 Q 900 460 820 500 Q 840 560 740 560 L 460 560 Q 360 560 380 490 Q 320 450 340 380 Z" fill="${INK}" opacity="0.85"/>
  <!-- dark ground / tower silhouette -->
  <rect y="620" width="1200" height="280" fill="${INK}"/>
  <path d="M560 620 L 590 470 L 610 470 L 640 620 Z" fill="${INK}"/>
  <path d="M300 620 L 900 620" stroke="#000" stroke-width="4" opacity="0.6"/>
  <text x="600" y="800" text-anchor="middle" font-family="'Courier New', monospace" font-size="26" letter-spacing="6" fill="${PAPER}" opacity="0.8">[ IMPACT IMAGE PLACEHOLDER ]</text>
</svg>
`,
);
console.log("wrote public/impact-field.svg");
