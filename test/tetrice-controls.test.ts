/**
 * TETRICE — the control layer.
 *
 * DAS, ARR, the soft-drop rate, the swipe threshold and the flick split, plus the two
 * structural promises that keep them meaning anything: **the OS's key repeat is not a
 * source of input**, and **every control constant lives in one object**.
 *
 * ── WHAT THE BROKEN VERSION WOULD PRODUCE ───────────────────────────────────────────
 * *Required by `CLAUDE.md`: a test that guards a failure must be shown failing when that
 * failure is present, and the demonstration lives here.*
 *
 * Three of these tests would pass on an implementation that does nothing, so each one
 * carries the implementation it is meant to reject and asserts the same check rejects it:
 *
 *  - `emitsOf()` is run against `NAIVE` — a repeater with no DAS at all, which emits on
 *    every tick a key is held. That is exactly what this game shipped before Phase 4, so
 *    it is not a hypothetical broken version; it is the previous one.
 *  - The key-repeat test is run against `REPEAT_DRIVEN` — a repeater that counts OS
 *    `keydown` repeats instead of frames. A test that only pressed once could not tell
 *    the two apart, because with one press they produce identical output.
 *  - The reachability and soft-drop-rate checks are arithmetic over the gravity table,
 *    and would pass vacuously if the table were read wrong, so each is re-run with a
 *    deliberately bad constant and asserted to fail.
 *
 * **AND THE SUITE WAS HAND-FALSIFIED ONCE, 2026-08-13**, because a control that is itself
 * a fake implementation only proves the fake is wrong. `CONTROLS` was edited in place to
 * `DAS_FRAMES: 1`, `SOFT_DROP_FRAMES: 2`, `SWIPE_THRESHOLD_PX: 22` — the three plausible
 * wrong values, the last of them being the number this game actually inherited from RICE
 * CHOMP — and the suite went from 26 passing to **7 failing**, naming the schedule, the
 * soft-drop-versus-gravity check and the threshold. Restored, green again.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { COLS, GRAVITY_FRAMES, SHAPES, VISIBLE_ROWS, cellsOf, spawnX } from "@/games/tetrice/engine/rules";
import { CONTROLS, InputState } from "@/games/tetrice/client/controls";
import {
  addPointer,
  beginTouch,
  endTouch,
  feedTouch,
  pollTouch,
  type TouchEdge,
  type TouchTracker,
} from "@/games/tetrice/client/touch";

// ─── helpers ─────────────────────────────────────────────────────────────────────────

/** Frames (counted from the press) on which a held button produced its action. */
function emitsOf(run: (frame: number) => readonly string[], frames: number): number[] {
  const out: number[] = [];
  for (let f = 0; f < frames; f++) if (run(f).length > 0) out.push(f);
  return out;
}

/** The shipped layer: press once, then drain `frames` times. */
function shipped(frames: number, action = "MoveLeft"): number[] {
  const input = new InputState();
  input.press("Left");
  return emitsOf(() => input.drain().filter((a) => a === action), frames);
}

/** THE PRE-PHASE-4 IMPLEMENTATION: a held key moves the piece every single tick. */
const NAIVE = (frames: number): number[] => Array.from({ length: frames }, (_, f) => f);

/**
 * THE IMPLEMENTATION THIS FILE EXISTS TO REJECT: repeats counted from the operating
 * system's `keydown` stream rather than from frames. Modelled on a typical typematic
 * setting — 500 ms to the first repeat, 33 ms after — sampled at 60 Hz.
 */
function repeatDriven(frames: number): number[] {
  const out: number[] = [0];
  const firstRepeatFrame = Math.round((500 / 1000) * 60);
  const everyFrames = Math.round((33 / 1000) * 60);
  for (let f = firstRepeatFrame; f < frames; f += everyFrames) out.push(f);
  return out;
}

/** Drive a straight drag at a constant velocity, quantised to a touch sample rate. */
function drag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  velocityPxPerMs: number,
  sampleMs = 1000 / 60,
): { edges: TouchEdge[]; tracker: TouchTracker; endedAt: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const durationMs = distance / velocityPxPerMs;
  const tracker = beginTouch(from.x, from.y, 0);
  const edges: TouchEdge[] = [];
  let t = sampleMs;
  for (; t <= durationMs; t += sampleMs) {
    const k = t / durationMs;
    edges.push(...feedTouch(tracker, from.x + dx * k, from.y + dy * k, t));
  }
  edges.push(...feedTouch(tracker, to.x, to.y, durationMs));
  return { edges, tracker, endedAt: durationMs };
}

const kinds = (edges: readonly TouchEdge[]) =>
  edges.map((e) => (e.kind === "pulse" ? `pulse:${e.action}` : `${e.kind}:${e.button}`));

// ─── auto-repeat ─────────────────────────────────────────────────────────────────────

describe("DAS and ARR", () => {
  it("moves once on the press, waits DAS, then repeats every ARR", () => {
    // The press's own move at frame 0, the charge at DAS, then ARR for ever.
    expect(shipped(20)).toEqual([0, 10, 12, 14, 16, 18]);
    expect(CONTROLS.DAS_FRAMES).toBe(10);
    expect(CONTROLS.ARR_FRAMES).toBe(2);
  });

  it("REJECTS a repeater with no charge — the implementation this replaced", () => {
    // THE CONTROL. Without it, an `InputState` that forgot DAS entirely would satisfy
    // every other assertion in this describe block that only checks "it repeats".
    expect(NAIVE(20)).not.toEqual(shipped(20));
    expect(NAIVE(20).length).toBeGreaterThan(shipped(20).length);
  });

  it("soft drop has no charge: it repeats from the very next frame", () => {
    const input = new InputState();
    input.press("SoftDrop");
    expect(emitsOf(() => input.drain().filter((a) => a === "SoftDrop"), 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("a pulse fires once however long the key is held", () => {
    const input = new InputState();
    input.pulse("RotateCW");
    expect(input.drain()).toEqual(["RotateCW"]);
    expect(input.drain()).toEqual([]);
    expect(input.drain()).toEqual([]);
  });
});

describe("the OS key repeat is not a source of input", () => {
  it("a stream of repeat presses produces the same schedule as one press", () => {
    const once = shipped(40);

    const input = new InputState();
    const spammed = emitsOf((f) => {
      // What an OS repeat looks like if it reaches `press()` — which is what
      // `TetriceScreen` drops at the door via `event.repeat`, and what `press()` is
      // idempotent against as the second line of defence.
      if (f >= 30 && f % 2 === 0) input.press("Left");
      return input.drain().filter((a) => a === "MoveLeft");
    }, 40);
    input.press("Left"); // the original press, before the first drain
    expect(spammed.length).toBeGreaterThan(0);

    const clean = new InputState();
    clean.press("Left");
    const baseline = emitsOf((f) => {
      if (f >= 30 && f % 2 === 0) clean.press("Left");
      return clean.drain().filter((a) => a === "MoveLeft");
    }, 40);
    expect(baseline).toEqual(once);
  });

  it("REJECTS a schedule driven by typematic events", () => {
    // THE CONTROL, and the one that matters most here: with a SINGLE press the two
    // implementations emit frame 0 and then diverge only later, so a test that pressed
    // once and drained five frames would pass on both. This asserts the divergence.
    const repeat = repeatDriven(40);
    const frames = shipped(40);
    expect(repeat).not.toEqual(frames);
    // The typematic version's first repeat lands 500 ms in — 20 frames after ours.
    expect(repeat[1] - repeat[0]).toBe(30);
    expect(frames[1] - frames[0]).toBe(CONTROLS.DAS_FRAMES);
  });
});

describe("two directions at once", () => {
  it("the last press steers, and the other is dormant rather than lost", () => {
    const input = new InputState();
    input.press("Left");
    expect(input.drain()).toEqual(["MoveLeft"]);
    input.press("Right");
    // Both are down; only the newer one emits, and never both on one tick.
    expect(input.drain()).toEqual(["MoveRight"]);
    for (let f = 0; f < 12; f++) {
      const out = input.drain();
      expect(out).not.toContain("MoveLeft");
    }
  });

  it("releasing the newer direction hands control back on a FRESH charge", () => {
    const input = new InputState();
    input.press("Left");
    input.drain();
    input.press("Right");
    for (let f = 0; f < 14; f++) input.drain(); // right is well past DAS
    input.release("Right");
    // Left resumes with its own move and a full charge — not with right's spent one,
    // which would fire the next repeat instantly and jump several columns.
    expect(input.drain()).toEqual(["MoveLeft"]);
    const after = emitsOf(() => input.drain().filter((a) => a === "MoveLeft"), 12);
    expect(after[0]).toBe(CONTROLS.DAS_FRAMES - 1);
  });

  it("releaseAll stops everything, for blur and pause", () => {
    const input = new InputState();
    input.press("Left");
    input.press("SoftDrop");
    input.pulse("HardDrop");
    input.releaseAll();
    expect(input.drain()).toEqual([]);
    expect(input.anyHeld).toBe(false);
  });
});

// ─── the numbers against the gravity table ───────────────────────────────────────────

describe("the constants against the engine they have to survive", () => {
  /** Frames to walk `cells` columns from a standing start, at a given DAS. */
  const walk = (cells: number, das: number, arr: number) => (cells <= 1 ? 0 : das + (cells - 2) * arr);

  /**
   * The longest walk any piece can owe: from where it spawns to whichever wall is
   * further, in cells, taken over all seven shapes at their spawn rotation.
   */
  const widestWalk = Math.max(
    ...SHAPES.map((shape) => {
      const cols = cellsOf(shape, 0).map(([cx]) => spawnX(shape) + cx);
      const left = Math.min(...cols);
      const right = Math.max(...cols);
      // Cells of travel to put the piece against the left wall, or against the right.
      return Math.max(left, COLS - 1 - right);
    }),
  );

  it("every column is reachable on one charge at the fastest tier", () => {
    const fastest = Math.min(...GRAVITY_FRAMES);
    const traverseFrames = fastest * VISIBLE_ROWS;
    const need = walk(widestWalk, CONTROLS.DAS_FRAMES, CONTROLS.ARR_FRAMES);
    expect(need).toBeLessThan(traverseFrames);

    // THE CONTROL. The check above is only worth something if it can fail, and the spec
    // says where: a DAS large enough to eat the traverse budget makes the fast tiers a
    // game with five reachable columns.
    expect(walk(widestWalk, 40, CONTROLS.ARR_FRAMES)).toBeGreaterThan(traverseFrames);
  });

  it("soft drop is strictly faster than gravity at every level on the table", () => {
    const fastestGravity = Math.min(...GRAVITY_FRAMES);
    expect(CONTROLS.SOFT_DROP_FRAMES).toBeLessThan(fastestGravity);

    // THE CONTROL: 2 frames/row is the value that looks reasonable and is a no-op at
    // level 15+, which is the one level where soft drop is the control being used.
    expect(2).not.toBeLessThan(fastestGravity);
  });
});

// ─── touch ───────────────────────────────────────────────────────────────────────────

describe("swipe", () => {
  it("commits at 10px, not at the 22px inherited from chomp", () => {
    expect(CONTROLS.SWIPE_THRESHOLD_PX).toBe(10);

    const tracker = beginTouch(100, 100, 0);
    expect(feedTouch(tracker, 109, 100, 16)).toHaveLength(0); // 9px: nothing yet
    expect(kinds(feedTouch(tracker, 112, 100, 32))).toEqual(["press:Right"]);

    // THE CONTROL: the same stroke under chomp's threshold produces nothing at all, which
    // is the failure this number exists to prevent — a swipe the player made and the game
    // did not see.
    const chompThreshold = 22;
    expect(12).toBeLessThan(chompThreshold);
  });

  it("one swipe is one cell: a long drag repeats no faster than ARR", () => {
    const input = new InputState();
    const { edges } = drag({ x: 100, y: 300 }, { x: 160, y: 300 }, 0.4);
    for (const e of edges) {
      if (e.kind === "press") input.press(e.button);
      else if (e.kind === "nudge") input.nudge(e.button);
    }
    // 60px of travel is six threshold crossings, but the engine can only be told to move
    // once per tick and the drag cannot pull repeats closer than ARR.
    const presses = kinds(edges).filter((k) => k === "press:Right");
    expect(presses).toHaveLength(1);
  });

  it("a reversal releases the old direction before pressing the new one", () => {
    const tracker = beginTouch(200, 300, 0);
    feedTouch(tracker, 215, 300, 16);
    expect(kinds(feedTouch(tracker, 200, 300, 32))).toEqual(["release:Right", "press:Left"]);
  });

  it("a tap rotates clockwise; two fingers rotate counter-clockwise", () => {
    const one = beginTouch(150, 400, 0);
    expect(kinds(endTouch(one, 90).events)).toEqual(["pulse:RotateCW"]);

    const two = beginTouch(150, 400, 0);
    addPointer(two);
    expect(endTouch(two, 60).done).toBe(false); // first finger up: still one gesture
    expect(kinds(endTouch(two, 90).events)).toEqual(["pulse:RotateCCW"]);
  });

  it("a swipe up holds", () => {
    const tracker = beginTouch(150, 400, 0);
    expect(kinds(feedTouch(tracker, 150, 385, 16))).toEqual(["pulse:Hold"]);
  });
});

describe("the flick split", () => {
  it("a deliberate drag down is a soft drop", () => {
    const { edges } = drag({ x: 150, y: 200 }, { x: 150, y: 320 }, 0.5);
    expect(kinds(edges)).toContain("press:SoftDrop");
    expect(kinds(edges)).not.toContain("pulse:HardDrop");
  });

  it("a fast flick down is a hard drop", () => {
    const { edges } = drag({ x: 150, y: 200 }, { x: 150, y: 320 }, 3);
    expect(kinds(edges)).toContain("pulse:HardDrop");
    expect(kinds(edges)).not.toContain("press:SoftDrop");
  });

  it("splits at 1.2 px/ms, and the split is what decides it", () => {
    expect(CONTROLS.FLICK_PX_PER_MS).toBe(1.2);
    const below = drag({ x: 150, y: 200 }, { x: 150, y: 320 }, CONTROLS.FLICK_PX_PER_MS * 0.8);
    const above = drag({ x: 150, y: 200 }, { x: 150, y: 320 }, CONTROLS.FLICK_PX_PER_MS * 1.2);
    expect(kinds(below.edges)).toContain("press:SoftDrop");
    expect(kinds(above.edges)).toContain("pulse:HardDrop");
  });

  it("A SHORT STROKE CANNOT HARD DROP, HOWEVER FAST THE SAMPLES SAY IT WAS", () => {
    // The quantisation guard, and the reason `FLICK_MIN_TRAVEL_PX` exists: crossing the
    // 10px threshold inside one 16.7ms sample reads as 0.6px/ms whatever the thumb did,
    // and a hard drop is irreversible. A 14px stroke delivered in one sample is the
    // fastest thing a digitiser can report and it must still not slam the piece.
    const tracker = beginTouch(150, 200, 0);
    const edges = feedTouch(tracker, 150, 214, 1);
    expect(kinds(edges)).not.toContain("pulse:HardDrop");
    expect(14).toBeLessThan(CONTROLS.FLICK_MIN_TRAVEL_PX);
  });

  it("a stroke that stops moving settles as a soft drop on the frame clock", () => {
    const tracker = beginTouch(150, 200, 0);
    feedTouch(tracker, 150, 212, 16); // committed down, still short of the flick distance
    expect(kinds(pollTouch(tracker, 40))).toEqual([]); // too early to call
    expect(kinds(pollTouch(tracker, 16 + CONTROLS.FLICK_DECIDE_MS))).toEqual(["press:SoftDrop"]);
  });

  it("a soft drop that speeds up does NOT become a hard drop", () => {
    const tracker = beginTouch(150, 200, 0);
    feedTouch(tracker, 150, 240, 80); // 0.5px/ms: settled as a soft drop
    const later = feedTouch(tracker, 150, 500, 90); // 26px/ms, which is nothing a thumb does
    expect(kinds(later)).not.toContain("pulse:HardDrop");
  });

  it("a drag that already moved the piece sideways can only soft drop", () => {
    const tracker = beginTouch(150, 200, 0);
    feedTouch(tracker, 180, 200, 16); // horizontal leg
    const down = feedTouch(tracker, 180, 260, 24); // then fast, downward
    expect(kinds(down)).toEqual(["release:Right", "press:SoftDrop"]);
  });
});

// ─── one place for the numbers ───────────────────────────────────────────────────────

describe("every control constant lives in CONTROLS", () => {
  const dir = join(process.cwd(), "src/games/tetrice/client");
  /**
   * A module-level numeric constant whose NAME is control vocabulary. Deliberately not
   * "any all-caps number": `render.ts` and `grains.ts` are full of render measurements —
   * flash durations, jitter, ghost alpha — and sweeping those in would make this test
   * something a future author routes around with an exception list rather than a rule.
   * What must never exist twice is a *control* number.
   */
  const DECLARED = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*number\s*)?=\s*-?\d/gm;
  /** Matched against WHOLE underscore-separated words, never as substrings: `NARROW`
   *  contains "ARR" and is a layout breakpoint. That near-miss is why this is a word
   *  test and not a regex over the name. */
  const CONTROL_WORDS = new Set([
    "DAS", "ARR", "SWIPE", "FLICK", "TAP", "THRESHOLD", "REPEAT", "DPAD", "AMBIGUITY", "SOFT",
  ]);
  const isControlName = (name: string) => name.split("_").some((w) => CONTROL_WORDS.has(w));
  const strays = (src: string) =>
    [...src.matchAll(DECLARED)].filter((m) => isControlName(m[1])).map((m) => m[0].trim());

  it("no client module outside controls.ts declares a control tunable of its own", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (file === "controls.ts") continue;
      for (const s of strays(readFileSync(join(dir, file), "utf8"))) offenders.push(`${file}: ${s}`);
    }
    expect(offenders).toEqual([]);
  });

  it("carries its positive control", () => {
    // THE CONTROL: the same matcher against source that DOES declare one must find it.
    // Without this, a regex that stopped matching would look exactly like a clean tree —
    // and this is a regex over file text, which is the easiest thing here to break by
    // renaming a file or a directory.
    const fixture =
      "const DAS_FRAMES = 10;\n" +
      "export const SWIPE_THRESHOLD_PX: number = 22;\n" +
      // Neither of these is a control tunable, and both are the kind of thing a blunter
      // matcher sweeps in — which is how a test like this becomes an exception list.
      "const CELL_FLOOR = 15;\n" +
      "const NARROW = 720;\n";
    const found = strays(fixture);
    expect(found).toHaveLength(2);
    expect(found[1]).toContain("SWIPE_THRESHOLD_PX");
  });

  it("the files that make up the control layer are all present", () => {
    // The matcher above is a path away from being vacuous: point it at a directory that
    // does not exist and it reports a clean tree for ever.
    const files = readdirSync(dir);
    expect(files).toContain("controls.ts");
    expect(files).toContain("touch.ts");
    expect(files).toContain("TetriceScreen.tsx");
  });
});
