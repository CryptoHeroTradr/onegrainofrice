/**
 * Replay — the suite that proves the Phase 7 verifier is possible.
 *
 * The claim being tested is structural, not numeric: a recorded run can be re-scored
 * by the SAME step function the browser ran, in plain Node, with nothing DOM-shaped
 * anywhere in the import graph. If that stops being true the anti-cheat design is
 * broken, and this is where it should show up — before a route exists, not after.
 *
 * It also pins the two policies that make replay survive contact with a tuning pass:
 * an unknown `engineVersion` is REFUSED rather than rescored, and the recorded format
 * carries no time-typed field.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_VERSION, MAX_INPUT_EVENTS, MAX_REPLAY_TICKS } from "@/lib/grainsnake/rules";
import {
  durationMsFromTicks,
  outcomeOf,
  replay,
  runLog,
  snapshot,
} from "@/lib/grainsnake/engine";
// Namespace import so the "no inverse of durationMsFromTicks" assertion can inspect
// the module's own export list. `require()` cannot: the `@` alias is a vitest/tsconfig
// resolver alias and does not exist for CJS.
import * as engineModule from "@/lib/grainsnake/engine";
import { DOWN, LEFT, RIGHT, UP, type Dir, type InputEvent, type ReplayLog } from "@/lib/grainsnake/types";

const SEED = 0x1ce9a17;
const TICKS = 500;
const INPUTS: InputEvent[] = [
  { tick: 0, dir: RIGHT },
  { tick: 20, dir: DOWN },
  { tick: 44, dir: RIGHT },
  { tick: 70, dir: UP },
  { tick: 101, dir: RIGHT },
  { tick: 140, dir: DOWN },
  { tick: 190, dir: LEFT },
  { tick: 240, dir: DOWN },
];

function log(overrides: Partial<ReplayLog> = {}): ReplayLog {
  return { seed: SEED, inputs: INPUTS, ticks: TICKS, engineVersion: ENGINE_VERSION, ...overrides };
}

describe("replay", () => {
  it("re-scores a recorded run to the same score the simulation produced", () => {
    const live = runLog(SEED, INPUTS, TICKS);
    const verdict = replay(log(), ENGINE_VERSION);
    expect(verdict.ok).toBe(true);
    expect(verdict.outcome).toEqual(outcomeOf(live));
  });

  it("reproduces the whole state, not merely the score", () => {
    // A verifier that agreed only on the score could be agreeing by accident.
    const live = runLog(SEED, INPUTS, TICKS);
    const verdict = replay(log(), ENGINE_VERSION);
    expect(snapshot(verdict.state!)).toBe(snapshot(live));
  });

  it("a tampered score cannot survive, because the score is COMPUTED not accepted", () => {
    // There is no field to tamper with: the outcome comes out of the replay. This
    // asserts the shape of that guarantee — a claim is compared, never stored.
    const claimed = 999_999;
    const verdict = replay(log(), ENGINE_VERSION);
    expect(verdict.ok).toBe(true);
    expect(verdict.outcome!.score).not.toBe(claimed);
  });

  it("a tampered INPUT LOG produces a different outcome", () => {
    // Run it against the failure: change one turn and the replay must disagree.
    const tampered: InputEvent[] = INPUTS.map((e, i) => (i === 3 ? { ...e, dir: DOWN as Dir } : e));
    const a = replay(log(), ENGINE_VERSION);
    const b = replay(log({ inputs: tampered }), ENGINE_VERSION);
    expect(snapshot(a.state!)).not.toBe(snapshot(b.state!));
  });

  it("REFUSES an unknown engine version rather than rescoring it", () => {
    const verdict = replay(log({ engineVersion: ENGINE_VERSION + 1 }), ENGINE_VERSION);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/version/i);
    expect(verdict.outcome).toBeUndefined();
  });

  it("bounds the work before simulating any of it", () => {
    expect(replay(log({ ticks: MAX_REPLAY_TICKS + 1 }), ENGINE_VERSION).ok).toBe(false);
    expect(replay(log({ ticks: -1 }), ENGINE_VERSION).ok).toBe(false);
    const tooMany: InputEvent[] = Array.from({ length: MAX_INPUT_EVENTS + 1 }, (_, i) => ({
      tick: i,
      dir: UP as Dir,
    }));
    expect(replay(log({ inputs: tooMany }), ENGINE_VERSION).ok).toBe(false);
  });

  it("rejects an input log that is not strictly ascending by tick", () => {
    expect(
      replay(log({ inputs: [{ tick: 5, dir: UP }, { tick: 5, dir: LEFT }] }), ENGINE_VERSION).ok,
    ).toBe(false);
    expect(
      replay(log({ inputs: [{ tick: 9, dir: UP }, { tick: 2, dir: LEFT }] }), ENGINE_VERSION).ok,
    ).toBe(false);
  });

  it("derives duration from ticks, and offers no way back", () => {
    expect(durationMsFromTicks(60)).toBe(1000);
    expect(durationMsFromTicks(0)).toBe(0);
    // The engine exports no inverse. If one ever appears, this is the reminder why
    // it must not: a client-supplied duration is a second, forgeable field saying the
    // same thing as the tick count — and, given the accumulator clamp, saying it wrong.
    const inverses = Object.keys(engineModule).filter((k) =>
      /ticksFrom(Duration|Ms)|msTo/i.test(k),
    );
    expect(inverses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The import graph — the structural half of the claim
// ---------------------------------------------------------------------------

const SRC = join(__dirname, "..", "src", "lib", "grainsnake");
const MODULES = ["rules.ts", "types.ts", "engine.ts"];

/**
 * Identifiers that would make a module unusable in a route handler, or would make it
 * non-deterministic. Matched against source text rather than against behaviour,
 * because the failure is "someone adds an import" and that is a source-shape change.
 */
const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\bfrom\s+["']react["']/, why: "React" },
  { pattern: /\buse[A-Z]\w*\s*\(/, why: "a React hook" },
  { pattern: /\bdocument\b/, why: "the DOM" },
  { pattern: /\bwindow\b/, why: "window" },
  { pattern: /\bnavigator\b/, why: "navigator" },
  { pattern: /\bHTMLCanvas|getContext\s*\(/, why: "a canvas" },
  { pattern: /\bnew\s+Date\b|\bDate\s*\.\s*now\b/, why: "a clock" },
  { pattern: /\bperformance\s*\.\s*now\b/, why: "a clock" },
  { pattern: /\bMath\s*\.\s*random\b/, why: "Math.random" },
  { pattern: /\bfrom\s+["']node:/, why: "a node builtin" },
  { pattern: /\brequire\s*\(\s*["']node:/, why: "a node builtin" },
];

/**
 * Source with comments removed. These files document what they must NOT do by naming
 * it — "no `Date`", "no `window`" — so a check that reads comments finds every
 * forbidden identifier in the very sentence forbidding it.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("the engine is importable by a route handler", () => {
  it.each(MODULES)("%s contains nothing DOM-shaped, no clock and no Math.random", (file) => {
    const code = stripComments(readFileSync(join(SRC, file), "utf8"));
    for (const { pattern, why } of FORBIDDEN) {
      expect(pattern.test(code), `${file} references ${why}`).toBe(false);
    }
  });

  it("imports nothing outside its own directory", () => {
    // The replayer is this code. A single import of a component, a hook or a database
    // driver is what would make it unrunnable in a route handler.
    for (const file of MODULES) {
      // Comments must be stripped first: prose containing the word "from" followed by
      // a quoted phrase reads as an import to a naive regex, and did.
      const src = stripComments(readFileSync(join(SRC, file), "utf8"));
      const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec.startsWith("./"), `${file} imports ${spec}`).toBe(true);
      }
    }
  });

  it("the recorded format carries no time-typed field", () => {
    // The acceptance criterion, asserted against the type's own source: the
    // accumulator clamp makes any such field a client/server divergence by
    // construction, so this is structural rather than stylistic.
    const src = readFileSync(join(SRC, "types.ts"), "utf8");
    const block = src.slice(src.indexOf("interface ReplayLog"));
    const body = block.slice(0, block.indexOf("}"));
    expect(/\b(timestamp|elapsed|durationMs|startedAt|playedFor|wallClock|at)\s*:/i.test(body)).toBe(
      false,
    );
    // ...and the only temporal thing it does carry is an integer tick count.
    expect(body).toMatch(/ticks\s*:\s*number/);
  });
});
