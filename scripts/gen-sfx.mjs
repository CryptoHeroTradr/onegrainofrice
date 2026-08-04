#!/usr/bin/env node
/**
 * Synthesizes every local sound effect (no deps, no network) into public/sfx/ as
 * 16-bit PCM mono WAV.
 *
 * Two families live here:
 *   grains — a soft rice "pour" (filtered noise) and a chopstick "clack".
 *   chomp  — RICE CHOMP's eight cues (see the CHOMP section below).
 *
 *   pnpm gen:sfx          both families
 *   pnpm gen:sfx chomp    only the chomp set, leaving the grains clips untouched
 *
 * The filter exists because regenerating a WAV rewrites every byte of a binary
 * file in git. The grains clips are drawn from Math.random() and so come out
 * different every run; the chomp clips are drawn from a SEEDED generator and so
 * come out byte-identical, which means re-running this is a no-op for them.
 * Being able to regenerate one family without churning the other is the whole
 * point of the filter.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "sfx");
mkdirSync(outDir, { recursive: true });

const only = process.argv[2];
const wants = (family) => !only || only === family;

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

// ---------------------------------------------------------------------------
// RICE CHOMP
// ---------------------------------------------------------------------------
/**
 * Eight cues for the maze game. Every one of them is built from the same three
 * primitives below — a seeded noise source, a one-pole low-pass, and a pitched
 * voice — so the whole set shares a timbre and reads as one instrument rather
 * than as eight unrelated beeps.
 *
 * THE CHOMP IS THE ONE THAT MATTERS. It fires up to eight times a second for
 * the entire length of a run, which is a completely different design problem
 * from a sound heard twice a level. Four rules came out of tuning it, and they
 * are the reason it does not become a smoke alarm ninety seconds in:
 *
 *  1. NOTHING ABOVE ~1.2 kHz. Listener fatigue lives in repeated high-frequency
 *     transients. The chomp is a dark, low, wooden thing: fundamental in the
 *     low 200s/300s, two quiet harmonics, and its noise layer low-passed hard.
 *  2. NO CLICK. A 4 ms attack ramp instead of an instantaneous one. A click is
 *     inaudible once and unbearable four hundred times.
 *  3. IT ALTERNATES. Two clips a fourth apart, played A B A B. A single repeated
 *     sample is a repetition; two alternating pitches are a RHYTHM, and a rhythm
 *     is something an ear settles into instead of bracing against. This is what
 *     the arcade original does and it is the single biggest factor.
 *  4. IT STOPS BEFORE IT REPEATS. The player eats at most 8 grains/second
 *     (PLAYER_TILES_PER_SEC = 8), so chomps are 125 ms apart. At 55 ms the clip
 *     is finished with 70 ms to spare and never overlaps itself — overlapping
 *     copies of the same sample is what turns a patter into a drone.
 *
 * Any future edit that raises the pitch, sharpens the attack, lengthens it past
 * ~100 ms, or collapses A/B into one clip will undo one of those four.
 */

/** Seeded PRNG, so the chomp WAVs are byte-identical on every regeneration. */
function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** One-pole low-pass. `k` near 0 is dark, near 1 is open. */
function lowpass(k) {
  let z = 0;
  return (x) => (z += (x - z) * k);
}

/** Attack ramp then exponential decay. Never starts at full amplitude — see rule 2. */
function env(t, attackSec, decayRate) {
  return Math.min(1, t / attackSec) * Math.exp(-t * decayRate);
}

/** A pitched voice with two quiet harmonics — wooden rather than sine-pure. */
function voice(phase, h2 = 0.18, h3 = 0.07) {
  return (
    Math.sin(phase) + h2 * Math.sin(phase * 2) + h3 * Math.sin(phase * 3)
  );
}

function buffer(durSec) {
  return new Float32Array(Math.floor(SR * durSec));
}

/**
 * One chomp. `f0` is the fundamental; it falls to 60% across the clip, which is
 * what makes it read as a bite closing rather than as a note.
 */
function chomp(f0, seed) {
  const dur = 0.055;
  const out = buffer(dur);
  const noise = rand(seed);
  const lp = lowpass(0.05); // hard — the grain texture, none of the hiss
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = f0 * (1 - 0.4 * (t / dur));
    phase += (2 * Math.PI * f) / SR;
    const grain = lp(noise()) * Math.exp(-t * 120) * 8; // texture, front-loaded only
    out[i] = (voice(phase) * 0.62 + grain * 0.3) * env(t, 0.004, 38) * 0.8;
  }
  return out;
}

/**
 * Golden grain. A rising fifth with a shimmer on top — the only cue that goes UP
 * and stays up, because it is the only moment the player stops being prey.
 */
function golden() {
  const dur = 0.5;
  const out = buffer(dur);
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const k = t / dur;
    const f = 220 * Math.pow(2, k * 1.0); // one octave over the clip
    p1 += (2 * Math.PI * f) / SR;
    p2 += (2 * Math.PI * f * 1.5) / SR; // a fifth above
    p3 += (2 * Math.PI * f * 2 * (1 + 0.01 * Math.sin(2 * Math.PI * 6 * t))) / SR;
    const body = Math.sin(p1) * 0.5 + Math.sin(p2) * 0.3 + Math.sin(p3) * 0.12;
    out[i] = body * env(t, 0.012, 3.2) * 0.85;
  }
  return out;
}

/**
 * Pest eaten. Three rising notes and a swallowed noise gulp at the front. The
 * host pitches the whole clip up per link of the chain (see playPestEaten), so
 * this is deliberately the plainest, most transposable shape in the set.
 */
function pestEaten(seed) {
  const dur = 0.3;
  const out = buffer(dur);
  const noise = rand(seed);
  const lp = lowpass(0.09);
  const notes = [523.25, 659.25, 783.99];
  const gap = 0.07;
  for (let n = 0; n < notes.length; n++) {
    const start = Math.floor(n * gap * SR);
    let phase = 0;
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / SR;
      phase += (2 * Math.PI * notes[n]) / SR;
      out[i] += voice(phase, 0.25, 0.0) * env(t, 0.005, 16) * 0.32;
    }
  }
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] += lp(noise()) * 4 * env(t, 0.003, 60) * 0.25; // the gulp
  }
  return out;
}

/**
 * Death. A fall, not a buzz: the pitch drops away and the wobble deepens as it
 * goes, and it ends with a handful of grains scattering on the floor.
 */
function death(seed) {
  const dur = 1.0;
  const out = buffer(dur);
  const noise = rand(seed);
  const lp = lowpass(0.16);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const k = t / dur;
    // Accelerating fall — 420 Hz down to about 70, faster at the end.
    const f = 420 * Math.pow(2, -2.6 * k * k);
    const wobble = 1 + 0.05 * k * Math.sin(2 * Math.PI * 7 * t);
    phase += (2 * Math.PI * f * wobble) / SR;
    const scatter = t > 0.55 ? lp(noise()) * 3 * Math.exp(-(t - 0.55) * 7) * 0.22 : 0;
    out[i] = voice(phase, 0.22, 0.1) * env(t, 0.01, 2.2) * 0.55 + scatter;
  }
  return out;
}

/** Bonus item. A soft wooden knock, then a warm fifth — a small reward, not a fanfare. */
function bonus(seed) {
  const dur = 0.35;
  const out = buffer(dur);
  const noise = rand(seed);
  const lp = lowpass(0.3);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = lp(noise()) * 2.4 * Math.exp(-t * 90) * 0.3; // the knock
  }
  const notes = [392.0, 587.33];
  for (let n = 0; n < notes.length; n++) {
    const start = Math.floor((0.02 + n * 0.09) * SR);
    let phase = 0;
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / SR;
      phase += (2 * Math.PI * notes[n]) / SR;
      out[i] += voice(phase, 0.2, 0.05) * env(t, 0.008, 9) * 0.34;
    }
  }
  return out;
}

/**
 * Extra life. Four rising bell notes, overlapping and ringing on. Deliberately
 * the longest-tailed, cleanest thing in the set — it happens once a run at most
 * and it should be the sound the player remembers.
 */
function extraLife() {
  const dur = 0.75;
  const out = buffer(dur);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  for (let n = 0; n < notes.length; n++) {
    const start = Math.floor(n * 0.1 * SR);
    let phase = 0;
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / SR;
      phase += (2 * Math.PI * notes[n]) / SR;
      // Bell: fundamental plus a quiet octave, long decay, no odd harmonics.
      const bell = Math.sin(phase) + 0.22 * Math.sin(phase * 2);
      out[i] += bell * env(t, 0.006, 5.5) * 0.3;
    }
  }
  return out;
}

/**
 * Level clear. A triad that ARRIVES rather than a run of notes that climbs —
 * the field is finished, and it needed to sound different in kind from the
 * extra life so the two are never confused at the moment they overlap.
 */
function levelClear(seed) {
  const dur = 0.85;
  const out = buffer(dur);
  const noise = rand(seed);
  const lp = lowpass(0.12);
  // A short sweep up into the chord.
  let sweep = 0;
  const swept = Math.floor(0.18 * SR);
  for (let i = 0; i < swept; i++) {
    const t = i / SR;
    const f = 180 * Math.pow(2, (t / 0.18) * 1.6);
    sweep += (2 * Math.PI * f) / SR;
    out[i] += Math.sin(sweep) * env(t, 0.01, 4) * 0.3;
  }
  const chord = [523.25, 659.25, 783.99, 1046.5];
  const start = Math.floor(0.16 * SR);
  for (const f of chord) {
    let phase = 0;
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / SR;
      phase += (2 * Math.PI * f) / SR;
      out[i] += voice(phase, 0.15, 0.04) * env(t, 0.02, 3.4) * 0.2;
    }
  }
  for (let i = start; i < out.length; i++) {
    const t = (i - start) / SR;
    out[i] += lp(noise()) * 2 * env(t, 0.05, 4) * 0.1; // a breath of grain under it
  }
  return out;
}

// ---------------------------------------------------------------------------

function emit(name, samples) {
  writeFileSync(join(outDir, name), toWav(samples));
  console.log(`wrote public/sfx/${name}`);
}

if (wants("grains")) {
  emit("rice-pour.wav", pour());
  emit("chopstick-clack.wav", clack());
}

if (wants("chomp")) {
  // A fourth apart (310/232 ≈ 4:3) so A-B-A-B is an interval and not a stutter.
  emit("chomp-a.wav", chomp(310, 0x1ce9a17));
  emit("chomp-b.wav", chomp(232, 0x5eed10c));
  emit("chomp-golden.wav", golden());
  emit("chomp-pest.wav", pestEaten(0x9e3779b9));
  emit("chomp-death.wav", death(0x2545f491));
  emit("chomp-bonus.wav", bonus(0x7f4a7c15));
  emit("chomp-extra.wav", extraLife());
  emit("chomp-clear.wav", levelClear(0x1b873593));
}
