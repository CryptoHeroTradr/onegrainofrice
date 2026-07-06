#!/usr/bin/env node
/**
 * Synthesizes the two local sound effects (no deps, no network) into
 * public/sfx/: a soft rice "pour" (filtered noise) and a chopstick "clack"
 * (two short wooden ticks). 16-bit PCM mono WAV.
 *
 *   pnpm gen:sfx
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "sfx");
mkdirSync(outDir, { recursive: true });

const SR = 22050;

function toWav(samples) {
  const len = samples.length;
  const buf = Buffer.alloc(44 + len * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + len * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(len * 2, 40);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  return buf;
}

// Rice pour — low-passed noise with a soft attack + decay.
function pour() {
  const dur = 0.5;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const noise = Math.random() * 2 - 1;
    lp += (noise - lp) * 0.12; // one-pole low-pass → "shhh"
    const env = Math.min(1, t * 18) * Math.exp(-t * 4.5);
    out[i] = lp * env * 0.4;
  }
  return out;
}

// Chopstick clack — two decaying wooden ticks.
function clack() {
  const dur = 0.2;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  const tick = (startSec) => {
    const start = Math.floor(startSec * SR);
    for (let i = start; i < n; i++) {
      const t = (i - start) / SR;
      const env = Math.exp(-t * 95);
      out[i] += (Math.sin(2 * Math.PI * 1650 * t) * 0.6 + (Math.random() * 2 - 1) * 0.4) * env * 0.5;
    }
  };
  tick(0);
  tick(0.06);
  return out;
}

writeFileSync(join(outDir, "rice-pour.wav"), toWav(pour()));
console.log("wrote public/sfx/rice-pour.wav");
writeFileSync(join(outDir, "chopstick-clack.wav"), toWav(clack()));
console.log("wrote public/sfx/chopstick-clack.wav");
