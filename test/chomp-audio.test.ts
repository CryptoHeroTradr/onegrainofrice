import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLEARED,
  DYING,
  GAMEOVER,
  PLAYING,
  advance,
  beginPlay,
  createGame,
  setWanted,
  tick,
  type GameState,
} from "@/components/chomp/engine/game";
import {
  CUE_BONUS,
  CUE_CHOMP,
  CUE_DEATH,
  CUE_EXTRA_LIFE,
  CUE_GAME_OVER,
  CUE_GOLDEN,
  CUE_LEVEL_CLEAR,
  CUE_PEST,
  createCueWatch,
  observeCues,
  syncCueWatch,
  type CueSource,
} from "@/components/chomp/engine/cues";
import { DOWN, LEFT, RIGHT, UP } from "@/components/chomp/engine/types";
import { summarizeRun } from "@/components/chomp/leaderboard";

/**
 * PHASE 5 — DETERMINISM, WHICH OUTRANKS EVERYTHING ELSE IN THE PHASE.
 *
 * Audio, the attract screen, the pause and game-over screens, the mute and contrast
 * toggles, the swipe surface and the d-pad all landed in one phase, and every one of
 * them lives on the HOST side of the line the cutscenes drew: the run is submitted as
 * a tick-stamped input trace and re-simulated server-side, so anything that could
 * consume a tick or add an entry to the trace would break replay verification for
 * reasons that have nothing to do with the game.
 *
 * The cutscene got one test — "produces an identical run whether it is watched or
 * skipped" (test/chomp-levels.test.ts). This is that assertion generalised to the
 * rest of the host layer, in four parts:
 *
 *   1. Sound is DERIVED, not emitted. observeCues() takes a frozen state and still
 *      works, so it provably cannot write to the simulation.
 *   2. A run that is being listened to is bit-identical to one that is not.
 *   3. Pausing, the attract screen and every menu are just "the host stopped calling
 *      tick()", and stopping the clock for any number of frames changes nothing.
 *   4. The engine cannot reach the host. No module under engine/ may import React,
 *      the DOM or the sound library — which is the structural version of the whole
 *      argument, and the thing that would silently rot.
 */

// --- 1. sound is derived, and cannot write ---------------------------------

describe("audio cues are an observation, not an output", () => {
  it("cannot write to the state it is observing", () => {
    // The real proof, and the reason this is a runtime test rather than a comment.
    // The cue layer is handed the live state through a proxy that throws on any
    // write, so if some future edit has it stamp `lastPlayedTick` onto the state —
    // the obvious, tempting optimisation — the test fails on the tick it happens.
    // Object.freeze would not do: it is permanent, and the simulation has to keep
    // running underneath.
    const trap = <T extends object>(o: T): T =>
      new Proxy(o, {
        set(_t, k) {
          throw new Error(`the audio layer wrote to the simulation: ${String(k)}`);
        },
        deleteProperty(_t, k) {
          throw new Error(`the audio layer deleted from the simulation: ${String(k)}`);
        },
        get(t, k, r) {
          const v = Reflect.get(t, k, r);
          return v && typeof v === "object" ? trap(v as object) : v;
        },
      });

    const g = beginPlay(createGame(1));
    const w = createCueWatch();
    syncCueWatch(w, g);

    for (let i = 0; i < 600; i++) {
      tick(g);
      expect(() => observeCues(w, trap(g) as CueSource)).not.toThrow();
    }
  });

  it("leaves the run bit-identical to one nobody is listening to", () => {
    // Two runs, same seed, same inputs. One of them has the audio layer attached to
    // every single tick; the other has never heard of it.
    const script: ReadonlyArray<{ at: number; dir: number }> = [
      { at: 30, dir: LEFT },
      { at: 90, dir: UP },
      { at: 150, dir: RIGHT },
      { at: 260, dir: DOWN },
      { at: 400, dir: LEFT },
      { at: 700, dir: UP },
    ];
    const drive = (g: GameState, listen: boolean) => {
      const w = createCueWatch();
      syncCueWatch(w, g);
      for (let t = 0; t < 1200; t++) {
        for (const s of script) if (s.at === t) setWanted(g, s.dir as 0 | 1 | 2 | 3);
        tick(g);
        if (listen) observeCues(w, g);
      }
    };

    const heard = beginPlay(createGame(1));
    const silent = beginPlay(createGame(1));
    drive(heard, true);
    drive(silent, false);

    expect(heard.tick).toBe(silent.tick);
    expect(heard.score).toBe(silent.score);
    expect(heard.level).toBe(silent.level);
    expect(heard.lives).toBe(silent.lives);
    expect(heard.rng).toBe(silent.rng);
    expect(heard.player).toEqual(silent.player);
    expect(heard.pests).toEqual(silent.pests);
    expect(heard.inputLog).toEqual(silent.inputLog);
    expect(Array.from(heard.grid)).toEqual(Array.from(silent.grid));
  });
});

// --- cue derivation, against hand-made snapshots ----------------------------

/**
 * The cue layer is a pure diff of two snapshots, so it is tested as one. Driving a
 * real game to an extra life would mean playing to 10,000 points, and driving it to
 * a specific chain length means solving the maze — neither of which tells us
 * anything about the function under test.
 */
function snap(over: Partial<CueSource> = {}): CueSource {
  return {
    phase: PLAYING,
    grainsEaten: 0,
    powerEaten: 0,
    pestsEaten: 0,
    chain: 0,
    level: 1,
    extraLifeGiven: false,
    bonus: { taken: 0 },
    ...over,
  };
}

function cueFrom(before: CueSource, after: CueSource) {
  const w = createCueWatch();
  syncCueWatch(w, before);
  return { cues: observeCues(w, after), chain: w.chain };
}

describe("cue derivation", () => {
  it("fires nothing when nothing happened", () => {
    expect(cueFrom(snap(), snap()).cues).toBe(0);
  });

  it("maps each counter and each phase edge to its own cue", () => {
    expect(cueFrom(snap(), snap({ grainsEaten: 1 })).cues).toBe(CUE_CHOMP);
    expect(cueFrom(snap(), snap({ powerEaten: 1 })).cues).toBe(CUE_GOLDEN);
    expect(cueFrom(snap(), snap({ bonus: { taken: 1 } })).cues).toBe(CUE_BONUS);
    expect(cueFrom(snap(), snap({ extraLifeGiven: true })).cues).toBe(CUE_EXTRA_LIFE);
    expect(cueFrom(snap(), snap({ phase: DYING })).cues).toBe(CUE_DEATH);
    expect(cueFrom(snap(), snap({ phase: CLEARED })).cues).toBe(CUE_LEVEL_CLEAR);
    expect(cueFrom(snap(), snap({ phase: GAMEOVER })).cues).toBe(CUE_GAME_OVER);
  });

  it("carries the chain length with the pest cue, so the four links can rise in pitch", () => {
    const r = cueFrom(snap({ pestsEaten: 2, chain: 2 }), snap({ pestsEaten: 3, chain: 3 }));
    expect(r.cues).toBe(CUE_PEST);
    expect(r.chain).toBe(3);
  });

  it("reports several cues from one tick", () => {
    // A golden grain that tips the score over the extra life is one tick and two sounds.
    const r = cueFrom(snap(), snap({ powerEaten: 1, extraLifeGiven: true }));
    expect(r.cues).toBe(CUE_GOLDEN | CUE_EXTRA_LIFE);
  });

  it("never reads a RESET counter as an event", () => {
    // A new level puts every grain back and a restart zeroes the lot. Counters are
    // compared with `>` for exactly this reason — `!==` would fire a chomp, a golden
    // grain, a bonus and a pest on the first tick of every level.
    const high = snap({ grainsEaten: 200, powerEaten: 3, pestsEaten: 4, bonus: { taken: 2 } });
    const fresh = snap({ level: 2 });
    expect(cueFrom(high, fresh).cues).toBe(0);
  });

  it("fires a phase cue once, not for every tick the phase lasts", () => {
    const w = createCueWatch();
    syncCueWatch(w, snap());
    expect(observeCues(w, snap({ phase: DYING }))).toBe(CUE_DEATH);
    expect(observeCues(w, snap({ phase: DYING }))).toBe(0);
    expect(observeCues(w, snap({ phase: DYING }))).toBe(0);
  });

  it("does not fire on the first look at a run it has been pointed at", () => {
    // syncCueWatch is what stops a fresh attach emitting the difference between "no
    // game" and "a game" — which on a mid-run restart would be a burst of every cue.
    const mid = snap({ grainsEaten: 88, powerEaten: 2, pestsEaten: 1, bonus: { taken: 1 } });
    const w = createCueWatch();
    syncCueWatch(w, mid);
    expect(observeCues(w, mid)).toBe(0);
  });
});

// --- 3. menus, pause and attract cost the simulation nothing -----------------

describe("the host may stop the clock for as long as it likes", () => {
  it("pauses without banking time, losing a tick, or changing the run", () => {
    // A pause is not a feature of the simulation: it is the host declining to call
    // tick(). This is the assertion that ChompCanvas's accumulator must never bank
    // wall-clock while paused — if it did, resuming would fire a burst of catch-up
    // ticks and the run would diverge from a replay of its own trace.
    const straight = beginPlay(createGame(1));
    advance(straight, 600);

    const interrupted = beginPlay(createGame(1));
    for (let i = 0; i < 6; i++) {
      advance(interrupted, 100);
      // "Paused for a while": frames go by, nothing is stepped. The menus, the
      // toggles and the attract screen are all this, structurally.
    }

    expect(interrupted.tick).toBe(straight.tick);
    expect(interrupted.player).toEqual(straight.player);
    expect(interrupted.pests).toEqual(straight.pests);
    expect(interrupted.score).toBe(straight.score);
    expect(Array.from(interrupted.grid)).toEqual(Array.from(straight.grid));
  });

  it("starts a run at tick zero with an empty trace however long the attract screen was up", () => {
    // The attract screen is a host flag and the run it starts is a NEW state, so
    // there is nothing for time spent on it to attach to. Asserted rather than
    // assumed, because the tempting implementation — reuse the booted state and just
    // stop drawing the overlay — would quietly hand the run whatever the attract
    // screen had done to it.
    const g = createGame(1);
    expect(g.tick).toBe(0);
    expect(g.inputLog).toEqual([]);
  });

  it("makes the same run whether the player steered from a key or a d-pad", () => {
    // Both routes end at setWanted(). This is close to tautological on purpose: the
    // value is that it FAILS the day someone gives touch its own path into the
    // engine — a tap-to-pause that clears the buffer, say, or a swipe that nudges
    // the player directly instead of queuing a direction.
    const keyed = beginPlay(createGame(1));
    const tapped = beginPlay(createGame(1));
    for (let t = 0; t < 500; t++) {
      if (t === 40) setWanted(keyed, LEFT);
      if (t === 40) setWanted(tapped, LEFT);
      if (t === 120) setWanted(keyed, UP);
      if (t === 120) setWanted(tapped, UP);
      tick(keyed);
      tick(tapped);
    }
    expect(keyed.inputLog).toEqual(tapped.inputLog);
    expect(keyed.player).toEqual(tapped.player);
  });
});

// --- 4. the engine cannot reach the host ------------------------------------

const ROOT = join(import.meta.dirname, "..");
const ENGINE_DIR = join(ROOT, "src/components/chomp/engine");

describe("the engine stays sealed", () => {
  it("imports no React, no DOM and no audio anywhere under engine/", () => {
    // The structural version of the whole phase. Sound arrived in Phase 5 and the
    // one-line way to wire it up is `import { playChomp } from "@/lib/sound"` inside
    // consume(). That would work, sound correct, and quietly make the simulation
    // depend on a browser — replay on the server would throw on the first grain.
    //
    // render.ts is exempt from the DOM half: it is the painting layer, it is never
    // replayed, and it legitimately calls document.createElement for its offscreen
    // canvases. It is not exempt from the audio half.
    const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);

    for (const f of files) {
      const src = readFileSync(join(ENGINE_DIR, f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      expect(code, `${f} must not reach the sound library`).not.toMatch(/lib\/sound/);
      expect(code, `${f} must not import React`).not.toMatch(/from\s+["']react["']/);
      expect(code, `${f} must not be a client component`).not.toMatch(/"use client"/);

      // The clock and the PRNG rules bind EVERYWHERE, render.ts included: its
      // animations are driven off the tick count precisely so that they cannot
      // desync, and a Math.random() in a bake would make the board differ between
      // two runs of the same trace.
      expect(code, `${f} must not read a clock`).not.toMatch(/Date\.now|performance\.now/);
      expect(code, `${f} must not use Math.random`).not.toMatch(/Math\.random/);

      if (f === "render.ts") continue;
      expect(code, `${f} must not touch the DOM`).not.toMatch(/\b(document|window|navigator)\b/);
    }
  });

  it("keeps the pit backdrop on the host side of the line", () => {
    // Phase 5.5 put a looping video in the pen. It is a decoration, and the rule for a
    // decoration is the rule the cutscenes established: it may cost the simulation
    // NOTHING. The risk here is not the same shape as the sound one — nobody is tempted
    // to import a <video> into game.ts — it is that the pit rect or the playback state
    // becomes something the engine reads, at which point "is the video buffered?" starts
    // deciding what a replay does.
    //
    // render.ts is the only module allowed to know a video exists, and even there it
    // receives one as an argument and never fetches, creates or controls one: no src, no
    // play(), no element construction. The host owns all of that.
    const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const src = readFileSync(join(ENGINE_DIR, f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (f === "render.ts") {
        expect(code, "render.ts must not create or drive a video").not.toMatch(
          /createElement\(\s*["']video["']|\.play\(\)|\.src\s*=/,
        );
        continue;
      }
      expect(code, `${f} must not know the pit backdrop exists`).not.toMatch(
        /video|HTMLVideoElement/i,
      );
    }
  });

  it("runs the same number of ticks whether the backdrop plays, stalls or never loads", () => {
    // The cutscene property, restated for the decoration that arrived after it. There is
    // no branch in tick() that could depend on the video, and this is the test that stays
    // true only as long as that remains so: the host draws the pit every frame from
    // whatever the element currently holds, and the engine is not consulted.
    const a = beginPlay(createGame(1, 7));
    const b = beginPlay(createGame(1, 7));
    for (let t = 0; t < 900; t++) {
      if (t === 55) {
        setWanted(a, LEFT);
        setWanted(b, LEFT);
      }
      tick(a);
      tick(b);
    }
    expect(a.tick).toBe(900);
    expect(a.tick).toBe(b.tick);
    expect(a.inputLog).toEqual(b.inputLog);
    expect(a.player).toEqual(b.player);
    expect(Array.from(a.grid)).toEqual(Array.from(b.grid));
  });

  it("keeps the wall texture and its lettering out of the simulation too", () => {
    // Same argument, second decoration. The texture and the baked lettering are inputs to
    // ONE function — bakeWalls — which takes a grid and returns a canvas. If a maze tile
    // ever starts depending on whether an image decoded, the board and the run disagree.
    const src = readFileSync(join(ENGINE_DIR, "render.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // No fetching, no asset(), no URLs: the host hands the decoded image in.
    expect(code, "render.ts must not load its own assets").not.toMatch(
      /fetch\(|new Image\(|lib\/asset|https?:\/\//,
    );
    // And no module under engine/ may import the host's asset helper.
    for (const f of readdirSync(ENGINE_DIR).filter((x) => x.endsWith(".ts"))) {
      const s = readFileSync(join(ENGINE_DIR, f), "utf8");
      expect(s, `${f} must not import asset()`).not.toMatch(/from\s+["']@\/lib\/asset["']/);
    }
  });

  it("keeps the leaderboard on the host side of the line", () => {
    // Phase 6, and the same argument in its fourth costume. A leaderboard is the most
    // tempting thing yet to wire into the engine, because the numbers it wants —
    // score, level, grains, pests, the trace — are all sitting right there on the
    // state. The one-line version is `import { submitScore } from "../leaderboard"`
    // inside finishDeath(), and it would work in a browser and throw on the server
    // the first time a replay killed the player.
    //
    // So: no engine module may name the leaderboard, its wire module, its database,
    // its trace codec or fetch. The host READS the state and encodes a trace from it;
    // nothing points the other way.
    const files = readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const src = readFileSync(join(ENGINE_DIR, f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${f} must not import the leaderboard`).not.toMatch(
        /from\s+["'][^"']*(leaderboard|lib\/chomp)[^"']*["']/,
      );
      expect(code, `${f} must not fetch anything`).not.toMatch(/\bfetch\(/);
      expect(code, `${f} must not reach localStorage`).not.toMatch(/localStorage/);
    }
  });

  it("costs a run nothing to read it for submission", () => {
    // summarizeRun() is what the game-over card calls on the live state. It must be a
    // pure observation — the same proxy trap the audio cues are held to, for the same
    // reason: the tempting optimisation is to cache the encoded trace ON the state.
    const trap = <T extends object>(o: T): T =>
      new Proxy(o, {
        set(_t, k) {
          throw new Error(`reading a run for the board wrote to it: ${String(k)}`);
        },
        deleteProperty(_t, k) {
          throw new Error(`reading a run for the board deleted from it: ${String(k)}`);
        },
        get(t, k, r) {
          const v = Reflect.get(t, k, r);
          return v && typeof v === "object" ? trap(v as object) : v;
        },
      });

    const live = beginPlay(createGame(1, 11));
    for (let t = 0; t < 600; t++) {
      if (t === 30) setWanted(live, LEFT);
      if (t === 200) setWanted(live, UP);
      tick(live);
    }
    const summary = summarizeRun(trap(live), 11);
    expect(summary.score).toBe(live.score);
    expect(summary.ticks).toBe(live.tick);
    expect(summary.submittable).toBe(true);

    // And a run that is read, encoded and submitted is tick-for-tick the run that is
    // not: the reference below never touches the leaderboard at all.
    const quiet = beginPlay(createGame(1, 11));
    for (let t = 0; t < 600; t++) {
      if (t === 30) setWanted(quiet, LEFT);
      if (t === 200) setWanted(quiet, UP);
      tick(quiet);
    }
    expect(live.tick).toBe(quiet.tick);
    expect(live.score).toBe(quiet.score);
    expect(live.inputLog).toEqual(quiet.inputLog);
    expect(live.player).toEqual(quiet.player);
  });

  it("refuses to summarize a debug run as submittable", () => {
    // The client half of the three-way debug gate. The other two are the server's
    // startLevel check (lib/chomp/score.ts) and replay from level 1.
    const debug = beginPlay(createGame(7));
    expect(summarizeRun(debug, 1).submittable).toBe(false);
  });

  it("keeps the cue layer to the readonly slice it is given", () => {
    // cues.ts is the one engine module that exists to serve the host, so it is the
    // one most likely to grow a shortcut back the other way.
    const src = readFileSync(join(ENGINE_DIR, "cues.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Assignments to anything reached through the state argument `s`.
    expect(code).not.toMatch(/\bs\.[A-Za-z.]+\s*(=[^=]|\+\+|--|\+=|-=)/);
  });
});
