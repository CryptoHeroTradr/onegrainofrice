/**
 * RICE CHOMP — the compressed input trace.
 *
 * The engine records every direction change as `{ tick, dir }` (game.ts,
 * `setWanted`). That array IS the run: replaying it against a fresh state
 * reproduces the score exactly, which is what server-side replay verification will
 * eventually check. This module is only how it travels over the wire.
 *
 * ── WHY IT LIVES HERE AND NOT IN engine/ ────────────────────────────────────────
 * The leaderboard is a HOST concern. No module under `components/chomp/engine/`
 * may import anything about it — that is asserted in `test/chomp-audio.test.ts`
 * alongside the same rule for audio, the cutscenes and the pit video. The engine
 * hands out an input log; this module turns one into a string. The arrow only
 * points this way.
 *
 * ISOMORPHIC AND PURE: no React, no DOM, no node builtins. The browser encodes and
 * the route handler decodes, and they must agree exactly, so there is one
 * implementation and both import it.
 *
 * ── FORMAT ──────────────────────────────────────────────────────────────────────
 * `<delta><DIR>` repeated, no separators:
 *
 *   - `delta` is the gap in ticks since the previous entry, base-36 LOWERCASE.
 *     An empty delta means zero, so two turns on the same tick cost one character.
 *   - `DIR` is one UPPERCASE letter: U L D R, matching UP/LEFT/DOWN/RIGHT.
 *
 * Uppercase is load-bearing. base-36 uses `0-9a-z`, which already contains `d`,
 * `l`, `r` and `u` — a lowercase terminator could not be told from a digit, and
 * the decoder would silently mis-split a real trace rather than fail. The two
 * alphabets are disjoint on purpose.
 *
 * A ten-minute run turning four times a second encodes to about 10 KB.
 */

import { DOWN, LEFT, RIGHT, UP, type Dir } from "@/components/chomp/engine/types";

export interface TraceEntry {
  tick: number;
  dir: Dir;
}

/** Indexed by Dir — UP, LEFT, DOWN, RIGHT. */
const DIR_CHARS = ["U", "L", "D", "R"] as const;

const CHAR_TO_DIR: Record<string, Dir> = {
  U: UP,
  L: LEFT,
  D: DOWN,
  R: RIGHT,
};

/**
 * Hard ceilings, applied on DECODE so a hostile body cannot make the server do
 * unbounded work before validation gets a look at it. Both are far above any real
 * run: 60,000 ticks is 16 minutes and 20,000 turns is one every three ticks for
 * that whole time.
 */
export const MAX_TRACE_ENTRIES = 20_000;
export const MAX_TRACE_TICKS = 60 * 60 * 60; // 60 minutes at 60 Hz

export function encodeTrace(log: readonly TraceEntry[]): string {
  let out = "";
  let prev = 0;
  for (const e of log) {
    const delta = e.tick - prev;
    prev = e.tick;
    // A negative delta means the caller handed us an unsorted log, which the engine
    // never produces. Encoding it would be silently lossy, so refuse.
    if (delta < 0) throw new Error("input trace is not in tick order");
    out += (delta === 0 ? "" : delta.toString(36)) + DIR_CHARS[e.dir];
  }
  return out;
}

export interface TraceDecodeOk {
  ok: true;
  log: TraceEntry[];
  /** The tick of the last entry, or 0 for an empty trace. */
  lastTick: number;
}
export interface TraceDecodeFail {
  ok: false;
  reason: string;
}

/**
 * Parse a trace. Never throws — a submission handler wants a reason string, not an
 * exception, and every malformed body is a client's problem rather than ours.
 */
export function decodeTrace(raw: unknown): TraceDecodeOk | TraceDecodeFail {
  if (typeof raw !== "string") return { ok: false, reason: "trace must be a string" };
  const log: TraceEntry[] = [];
  let tick = 0;
  let digits = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const dir = CHAR_TO_DIR[c];
    if (dir === undefined) {
      // Still inside a delta. base-36 lowercase only; anything else is malformed.
      if (!((c >= "0" && c <= "9") || (c >= "a" && c <= "z"))) {
        return { ok: false, reason: `unexpected character in trace at ${i}` };
      }
      digits += c;
      // 8 base-36 digits is 2.8e12 ticks — well past MAX_TRACE_TICKS, and the cap
      // stops a run of a million digits becoming a giant parseInt.
      if (digits.length > 8) return { ok: false, reason: "trace delta is absurd" };
      continue;
    }
    tick += digits === "" ? 0 : Number.parseInt(digits, 36);
    digits = "";
    if (tick > MAX_TRACE_TICKS) return { ok: false, reason: "trace runs longer than any run can" };
    log.push({ tick, dir });
    if (log.length > MAX_TRACE_ENTRIES) return { ok: false, reason: "trace has too many entries" };
  }
  // Trailing digits with no direction letter is a truncated trace, not an empty one.
  if (digits !== "") return { ok: false, reason: "trace ends mid-entry" };
  return { ok: true, log, lastTick: log.length ? log[log.length - 1].tick : 0 };
}
