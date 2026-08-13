/**
 * Capture a TETRICE run to a fixture, THROUGH THE REAL CLIENT PIPELINE.
 *
 * `node --import tsx scripts/capture-tetrice-run.mjs > test/fixtures/tetrice-run.json`
 *
 * ── WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT ──────────────────────────────
 * The run is driven by a scripted player, not by a human. It is "real" in the sense that
 * matters for the verifier — every byte of the log comes out of the SAME `InputState` →
 * `drain()` → `InputRecorder.record()` → `step()` chain the browser runs, so the fixture
 * exercises the real recorder, the real auto-repeat and the real engine. It is NOT a
 * recording of somebody playing, and `test/tetrice-replay.test.ts` says so where it uses it
 * rather than letting "captured" imply a person.
 *
 * The scripted player is driven by its own xorshift, seeded from a constant, so re-running
 * this produces a byte-identical fixture. `Math.random()` appears nowhere: a fixture that
 * changed between runs would make every assertion about it unfalsifiable.
 */

import { collides, createInitialState } from "../src/games/tetrice/engine/state.ts";
import { step } from "../src/games/tetrice/engine/step.ts";
import { ENGINE_VERSION, cellsOf } from "../src/games/tetrice/engine/rules.ts";
import { InputRecorder, maskOf } from "../src/games/tetrice/client/inputLog.ts";
import { InputState } from "../src/games/tetrice/client/controls.ts";

const SEED = Number(process.env.CAPTURE_SEED ?? 0x7e781ce);
const PLAYER_SEED = Number(process.env.CAPTURE_PLAYER ?? 0x51ce1);
const MAX_TICKS = 60_000;
/** Lines to clear before the player deliberately stacks itself out. See the wind-down. */
const FINISH_AFTER_LINES = Number(process.env.CAPTURE_LINES ?? 24);

/** The scripted player's own generator. Never the engine's — two streams, no coupling. */
let rng = PLAYER_SEED >>> 0;
function next() {
  rng ^= rng << 13;
  rng >>>= 0;
  rng ^= rng >>> 17;
  rng ^= rng << 5;
  rng >>>= 0;
  return rng;
}
const pick = (n) => next() % n;

const input = new InputState();
const recorder = new InputRecorder();
let state = createInitialState(SEED);

/**
 * A player that STACKS RATHER THAN FLAILS, and that is the whole reason it is a heuristic
 * and not a coin toss.
 *
 * A random player never completes a line — measured, across sixteen seed pairs, every one
 * of them topped out with `lines: 0`. A fixture like that leaves the line-clear scoring,
 * the level-up boundary and `LINE_SCORES` entirely unexercised, which is exactly the part
 * of the score a forger would care about. So this one plays the flattest column it can
 * find and drops there.
 *
 * It still exercises the input layer properly: journeys are made with a HELD direction,
 * released the instant the piece arrives, so DAS and ARR do the walking and the log gets
 * its realistic one-entry-per-frame density.
 */
const COLS = 10;
const ROWS = state.well.length / COLS;

/** Height of each column: rows from the top down to the first filled cell. */
function heights(well) {
  const h = new Array(COLS).fill(0);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (well[r * COLS + c] !== 0) {
        h[c] = ROWS - r;
        break;
      }
    }
  }
  return h;
}

/**
 * Score a hypothetical placement — the standard four-term heuristic, and the reason this
 * script has one at all: **a player that does not avoid holes never completes a row.** The
 * first two versions of this script picked the lowest column and produced fixture after
 * fixture with `lines: 0`, which left line scoring, `LINE_SCORES` and the level-up boundary
 * untested — the exact part of the score that matters most.
 *
 * The search uses the engine's own `collides()`, so a placement it believes in is one the
 * engine agrees is legal. Even if this heuristic were wrong it could not corrupt a fixture:
 * it only decides which BUTTONS to press, and the log is whatever the real engine did with
 * them.
 */
function evaluate(well, shape, rot, x) {
  let y = 0;
  if (collides(well, shape, rot, x, y)) return null;
  while (!collides(well, shape, rot, x, y + 1)) y++;

  const after = Uint8Array.from(well);
  for (const [cx, cy] of cellsOf(shape, rot)) after[(y + cy) * COLS + (x + cx)] = 1;

  let cleared = 0;
  for (let r = 0; r < ROWS; r++) {
    let full = true;
    for (let c = 0; c < COLS; c++) {
      if (after[r * COLS + c] === 0) {
        full = false;
        break;
      }
    }
    if (full) cleared++;
  }

  const h = heights(after);
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    for (let r = ROWS - h[c]; r < ROWS; r++) if (after[r * COLS + c] === 0) holes++;
  }
  let bumpiness = 0;
  for (let c = 0; c + 1 < COLS; c++) bumpiness += Math.abs(h[c] - h[c + 1]);
  const aggregate = h.reduce((a, b) => a + b, 0);

  return -0.51 * aggregate + 0.76 * cleared - 0.36 * holes - 0.18 * bumpiness;
}

let piece = -1;
let target = 0;
let targetRot = 0;
let held = null;

for (let t = 0; t < MAX_TICKS && !state.over; t++) {
  const active = state.active;

  if (active && state.pieceCounter !== piece) {
    // A new piece: search every rotation at every legal x, take the best placement.
    piece = state.pieceCounter;
    let bestScore = -Infinity;
    target = active.x;
    targetRot = active.rot;

    // ── THE FIXTURE HAS TO END, AND A GOOD PLAYER DOES NOT ─────────────────────────
    // Left alone this heuristic clears over a thousand lines and reaches level 105 before
    // topping out: 32,560 ticks and 16,578 log entries, which is a 300 KB fixture nobody
    // will read. Past the line target it stops searching and stacks everything in one
    // column, so the well fills and the run ENDS — a fixture must be a finished run.
    // The interesting part (line clears, the level-up boundary, every action bit) has
    // already happened by then.
    const windDown = state.lines >= FINISH_AFTER_LINES;
    if (windDown) {
      const cx = cellsOf(active.shape, 0).map(([c]) => c);
      target = -Math.min(...cx);
      targetRot = 0;
    }

    for (let rot = 0; rot < 4 && !windDown; rot++) {
      // The legal x range for THIS rotation. `x` is the piece's origin, not its left edge,
      // so column 9 is not a legal x for anything — an unclamped target is one the piece
      // can never reach, and the player then holds a direction into the wall for ever and
      // never drops. That mistake is what produced the first sixteen `lines: 0` fixtures.
      const cx = cellsOf(active.shape, rot).map(([c]) => c);
      for (let x = -Math.min(...cx); x <= COLS - 1 - Math.max(...cx); x++) {
        const s = evaluate(state.well, active.shape, rot, x);
        if (s !== null && s > bestScore) {
          bestScore = s;
          target = x;
          targetRot = rot;
        }
      }
    }
    if (held) {
      input.release(held);
      held = null;
    }
    // A hold swap now and then, so the Hold bit appears in a real log.
    if (pick(11) === 0) input.pulse("Hold");
  }

  if (active) {
    if (active.rot !== targetRot) {
      // One rotation per tick; CCW when it is the shorter way round, so both bits appear.
      const cw = (active.rot + 1) % 4;
      input.pulse(cw === targetRot || pick(2) === 0 ? "RotateCW" : "RotateCCW");
    } else if (active.x < target) {
      if (held !== "Right") {
        if (held) input.release(held);
        input.press((held = "Right"));
      }
    } else if (active.x > target) {
      if (held !== "Left") {
        if (held) input.release(held);
        input.press((held = "Left"));
      }
    } else {
      // Arrived. Let go, then either slam it or ride it down.
      if (held === "Left" || held === "Right") {
        input.release(held);
        held = null;
      }
      if (pick(3) === 0) {
        if (held !== "SoftDrop") input.press((held = "SoftDrop"));
      } else {
        if (held) {
          input.release(held);
          held = null;
        }
        input.pulse("HardDrop");
      }
    }
  }

  const actions = input.drain();
  recorder.record(state.ticks, maskOf(actions));
  state = step(state, actions, state.ticks);
}

if (!state.over) {
  console.error(`[capture] run did not end in ${MAX_TICKS} ticks — the fixture must be a FINISHED run`);
  process.exit(1);
}

const log = recorder.build(SEED, ENGINE_VERSION, state.ticks);

process.stdout.write(
  `${JSON.stringify(
    {
      _note:
        "Generated by scripts/capture-tetrice-run.mjs through the real InputState/InputRecorder/step chain. Scripted player, not a human. Regenerate with: node --import tsx scripts/capture-tetrice-run.mjs > test/fixtures/tetrice-run.json",
      log,
      // The numbers the LIVE simulation produced. The test asserts the replay reproduces
      // these; storing them here is what makes that a comparison rather than a tautology.
      played: {
        score: state.score,
        level: state.level,
        lines: state.lines,
        ticks: state.ticks,
        over: state.over,
      },
    },
    null,
    2,
  )}\n`,
);
