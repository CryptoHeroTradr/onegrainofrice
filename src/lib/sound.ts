import { asset } from "@/lib/asset";

/**
 * Tiny sound manager.
 *
 * Sounds ONLY play from explicit calls made inside a user gesture (a click/tap)
 * — never autoplay — and never under reduced motion.
 *
 * ON by default, and the choice is PERSISTED. It used to default to muted and
 * keep its state in a bare module variable, which meant every page load started
 * silent and any user who unmuted was back to silence after a reload. That was
 * the bulk of the "sound doesn't work" reports: nothing was broken, the game was
 * just muted and the toggle easy to miss. Defaulting on is safe precisely
 * because playback is gesture-driven, so no browser autoplay policy is violated.
 *
 * Playback uses the Web Audio API rather than a shared <audio> element. A single
 * HTMLAudioElement can only play one instance at a time, so rapid repeats (the
 * grains clicker fires on every tap) had to rewind it mid-playback — which iOS
 * Safari handles badly, dropping or truncating most taps. Web Audio decodes each
 * clip once and spawns a throwaway BufferSource per play, so taps overlap
 * cleanly and latency stays low. An HTMLAudio pool is kept as a fallback for
 * browsers without AudioContext.
 *
 * NOTE for support: on iOS the hardware ring/silent switch mutes web audio no
 * matter what this module does. A phone on silent WILL be silent — no web page
 * can override that.
 */

type Name =
  | "pour"
  | "clack"
  | "m5"
  | "m10"
  | "m15"
  | "m25"
  | "m40"
  | "m50"
  | "m100"
  | "m250";

/**
 * Milestone clips keep the exact filenames they were delivered under, so the
 * mp3s can be dropped into public/sfx/ as-is with no renaming step. Opaque ids
 * are the source's, not ours — the MILESTONES table below is what gives them
 * meaning, so read that first.
 */
const SRC: Record<Name, string> = {
  pour: "/sfx/rice-pour.wav",
  clack: "/sfx/chopstick-clack.wav",
  m5: "/sfx/sword-blade.mp3",
  m10: "/sfx/bruh.mp3",
  m15: "/sfx/laser-pew-pew-pew.mp3",
  m25: "/sfx/fart.mp3",
  m40: "/sfx/michael-jackson-hee-hee.mp3",
  m50: "/sfx/kids-cheering.mp3",
  m100: "/sfx/error-soundss.mp3",
  m250: "/sfx/ced71b4a-4f58-4ae3-95fb-34dcc5935631.mp3",
};
// Pour (the rice-drop sound) is boosted 100% over its original 0.4 — it is the
// core feedback of the clicker and was too quiet on phone speakers. Milestones
// replace the pour on the tap that earns them, so they sit at a similar level.
const VOLUME: Record<Name, number> = {
  pour: 0.8,
  clack: 0.5,
  m5: 0.8,
  m10: 0.8,
  m15: 0.8,
  m25: 0.8,
  m40: 0.8,
  m50: 0.8,
  m100: 0.8,
  m250: 0.8,
};

/**
 * Grain-total milestones, LARGEST FIRST — the order the lookup relies on.
 *
 * These repeat forever: the sound for a milestone fires every time the player's
 * running total is an exact multiple of it. Totals are routinely a multiple of
 * several at once (100 is a multiple of 5, 10, 25, 50 and 100), so only the
 * biggest match is played — one sound per tap, never a chord. The tiers do NOT
 * all nest: 40 is not a multiple of 25 or 15, so 40 wins at 40/80 while 15 wins
 * at 15/45 and 25 wins at 25 — and because 5 divides everything, the 5-sound is
 * heard only at multiples of 5 that no larger tier claims (5, 35, 55, 65, 85…).
 * 250 is not a multiple of 100 (250/100 = 2.5), so 250 wins at 250 and 500 while
 * 100 wins at 100/200/300/400.
 */
const MILESTONES: ReadonlyArray<{ every: number; name: Name }> = [
  { every: 250, name: "m250" },
  { every: 100, name: "m100" },
  { every: 50, name: "m50" },
  { every: 40, name: "m40" },
  { every: 25, name: "m25" },
  { every: 15, name: "m15" },
  { every: 10, name: "m10" },
  { every: 5, name: "m5" },
];

/**
 * The single milestone sound a running total earns, or null for an ordinary
 * total. Exported for tests / callers that want to know before playing.
 */
export function milestoneFor(total: number): Name | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const n = Math.floor(total);
  // Largest-first, so the first exact multiple found is the most significant.
  return MILESTONES.find((m) => n % m.every === 0)?.name ?? null;
}

/** Persisted on/off choice. */
const PREF_KEY = "grains:sound";
const DEFAULT_ON = true;

function readPref(): boolean {
  if (typeof window === "undefined") return DEFAULT_ON;
  try {
    const v = window.localStorage.getItem(PREF_KEY);
    if (v === "on") return true;
    if (v === "off") return false;
  } catch {
    /* storage blocked — fall through to the default */
  }
  return DEFAULT_ON;
}

function writePref(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked — the choice just won't survive a reload */
  }
}

let soundOn = readPref();
const listeners = new Set<() => void>();

let ctx: AudioContext | null = null;
const buffers = new Map<Name, AudioBuffer>();
const loads = new Map<Name, Promise<void>>();

function reduced(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Fetch + decode a clip once. Repeat calls share the in-flight promise. */
function preload(name: Name): Promise<void> {
  const existing = loads.get(name);
  if (existing) return existing;

  const task = (async () => {
    const c = getCtx();
    if (!c) return;
    try {
      const res = await fetch(asset(SRC[name]));
      const bytes = await res.arrayBuffer();
      buffers.set(name, await c.decodeAudioData(bytes));
    } catch {
      // Leave it unbuffered; play() falls back to the HTMLAudio pool.
      loads.delete(name);
    }
  })();

  loads.set(name, task);
  return task;
}

export function isSoundOn(): boolean {
  return soundOn;
}

/**
 * Snapshot for SSR/hydration. The server can't read localStorage, so it renders
 * the default; a player who muted flips to their stored choice on hydration.
 */
export function soundServerSnapshot(): boolean {
  return DEFAULT_ON;
}

/**
 * Wake the audio engine. MUST be called from inside a user gesture — that is the
 * only moment iOS/Safari will let an AudioContext leave the "suspended" state.
 */
function prime(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  void preload("pour");
  void preload("clack");
}

/**
 * Decode the milestone clips ahead of time.
 *
 * Only the grains game calls this — every other page would be fetching five clips
 * it will never play. Worth doing early there, though: a milestone lands on one
 * specific tap and gets no second chance, so an undecoded clip would fall back
 * to the <audio> pool and arrive late, or be dropped outright on iOS. Safe
 * outside a gesture: an AudioContext may be constructed suspended, and decoding
 * does not need it running.
 */
export function preloadMilestones(): void {
  for (const m of MILESTONES) void preload(m.name);
}

/**
 * Unlock on the FIRST user gesture anywhere on the page, not just on the sound
 * toggle. Now that sound defaults to on, most players never touch the toggle —
 * without this their AudioContext would still be suspended when the first grain
 * drops, and the game would be silent for them. Registered once, self-removing.
 */
let unlockArmed = false;
function armUnlock(): void {
  if (unlockArmed || typeof window === "undefined") return;
  unlockArmed = true;
  const unlock = () => {
    prime();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("touchstart", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
}
armUnlock();

export function setSoundOn(on: boolean): void {
  soundOn = on;
  writePref(on);
  // The toggle click is itself a gesture, so this is a valid moment to unlock.
  if (on) prime();
  listeners.forEach((l) => l());
}

export function toggleSound(): void {
  setSoundOn(!soundOn);
}

export function subscribeSound(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// --- fallback: a small pool of <audio> elements (no AudioContext available) ---
const POOL_SIZE = 4;
const pools = new Map<Name, HTMLAudioElement[]>();

function playPooled(name: Name): void {
  if (typeof window === "undefined") return;
  let pool = pools.get(name);
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, () => {
      const el = new Audio(asset(SRC[name]));
      el.volume = VOLUME[name];
      return el;
    });
    pools.set(name, pool);
  }
  // Take a free element so overlapping taps don't cut each other off.
  const el = pool.find((a) => a.paused || a.ended) ?? pool[0];
  try {
    el.currentTime = 0;
    const owns = MILESTONE_NAMES.has(name);
    if (owns) {
      // Same ownership rule as the Web Audio path. `duration` is NaN until
      // metadata lands, in which case holdMilestone falls back to a fixed hold.
      holdMilestone(el.duration);
      el.onended = releaseMilestone;
    }
    // Release the speaker if playback never actually starts. Without this a clip
    // that 404s or is blocked would hold it for the full fallback window and mute
    // the game — a missing milestone must cost silence for its own tap, not for
    // the seconds of taps after it.
    void el.play().catch(() => {
      if (owns) releaseMilestone();
    });
  } catch {
    /* ignore */
  }
}

/**
 * A milestone owns the speaker for its FULL LENGTH: from the moment one starts
 * until the clip ends, nothing else plays — not the pour/clack of the tap that
 * earned it, not the pour/clack of any tap during it, and not a second
 * milestone. The track lands alone.
 *
 * Enforced here rather than at the call sites because the tap's clack doesn't
 * all come from the game — on desktop the global ChopstickCursor plays it from
 * its own window-level pointerdown listener, which GrainsScreen has no handle on.
 *
 * This is duration-scoped. An earlier version scoped it to the tap instead
 * (cleared on the next pointerdown) specifically to avoid swallowing the next
 * tap's genuine pour — but these clips run seconds, not milliseconds, and this
 * is a clicker: the player keeps tapping throughout, so a tap-scoped guard let
 * every tap after the first play straight over the track. Swallowing those pours
 * is now the POINT, so the tap boundary is gone and the clip's own end is the
 * only thing that releases the speaker.
 */
let milestoneBusy = false;
let milestoneTimer: ReturnType<typeof setTimeout> | null = null;

/** Longest any clip may hold the speaker. A stuck flag would mute the game for
 *  good, so the timer is a hard backstop even if `ended` never fires (a decode
 *  failure or a pooled element that never loads metadata). */
const MAX_HOLD_MS = 30_000;
/** Hold used when a clip's duration isn't known yet — pool fallback, pre-metadata. */
const FALLBACK_HOLD_MS = 4_000;

function releaseMilestone(): void {
  milestoneBusy = false;
  if (milestoneTimer !== null) {
    clearTimeout(milestoneTimer);
    milestoneTimer = null;
  }
}

/** Claim the speaker for `seconds` (a clip's real duration when we know it). */
function holdMilestone(seconds: number): void {
  milestoneBusy = true;
  if (milestoneTimer !== null) clearTimeout(milestoneTimer);
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : FALLBACK_HOLD_MS;
  // +80ms so the tail isn't clipped by timer jitter on a loaded main thread.
  milestoneTimer = setTimeout(releaseMilestone, Math.min(ms + 80, MAX_HOLD_MS));
}

const MILESTONE_NAMES: ReadonlySet<Name> = new Set(MILESTONES.map((m) => m.name));

function play(name: Name): void {
  // Deliberately NOT gated on prefers-reduced-motion. It used to be, which meant
  // anyone with "reduce motion" enabled (a common desktop OS setting) got NO
  // SOUND AT ALL and had no idea why — the toggle said "on" and nothing played.
  // Reduced motion is a request for less ANIMATION; it says nothing about audio,
  // and muting is already a separate, explicit control.
  if (!soundOn) return;
  // Nothing plays over a running milestone — including another milestone.
  if (milestoneBusy) return;

  const c = getCtx();
  if (!c) {
    playPooled(name);
    return;
  }

  // iOS suspends the context whenever the page is backgrounded; every play call
  // is a user gesture, so it is safe to resume here.
  if (c.state === "suspended") void c.resume().catch(() => {});

  const buffer = buffers.get(name);
  if (!buffer) {
    // Still decoding (or decode failed) — kick off the load and cover this tap
    // with the element pool so it isn't silently dropped.
    void preload(name);
    playPooled(name);
    return;
  }

  try {
    const source = c.createBufferSource();
    source.buffer = buffer;
    const gain = c.createGain();
    gain.gain.value = VOLUME[name];
    source.connect(gain).connect(c.destination);
    if (MILESTONE_NAMES.has(name)) {
      // Claim the speaker up front off the buffer's real duration, and release
      // on the authoritative `ended` — the timer above is only the backstop.
      holdMilestone(buffer.duration);
      source.onended = releaseMilestone;
    }
    source.start();
  } catch {
    playPooled(name);
  }
}

export function playPour(): void {
  play("pour");
}
export function playClack(): void {
  play("clack");
}

/**
 * Play the milestone sound `total` earns, if it earns one.
 *
 * Returns whether `total` is a milestone at all — NOT whether a clip actually
 * started. Callers use it to drop the ordinary tap sound, and a milestone total
 * must stay silent-but-owned even when the clip is suppressed (another milestone
 * still running) or muted, so the pour never sneaks in on a milestone tap.
 */
export function playMilestone(total: number): boolean {
  const name = milestoneFor(total);
  if (!name) return false;
  play(name);
  return true;
}
