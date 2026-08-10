/**
 * DEATH, ASSERTED POSITIVELY.
 *
 * *Added 2026-08-08, with `ENGINE_VERSION` 2.* Before this file the suite contained
 * **eleven** `expect(dead).toBe(false)` assertions and **zero** asserting that a death
 * happens. Removing the walls — the only hazard that could fire at short lengths —
 * therefore failed none of 517 tests. That is not a clean bill of health; it is the
 * signature of coverage that was never there.
 *
 * Self-collision is now the only death in the game, so this file is the whole of the
 * game's terminal condition. Each test names its reason: not "the run ended" but "the
 * head entered a cell its own trail occupied, which was not the vacating tail, on a
 * step whose tick we can state".
 *
 * ── THE TWO HALVES, AND BOTH ARE NEEDED ─────────────────────────────────────────
 * A test that a death HAPPENS is satisfied by an engine that kills on every step. A
 * test that a death does NOT happen is satisfied by an engine that never kills. Every
 * killing case below is therefore paired with the nearest surviving case — the tail
 * exemption, the empty cell, the shorter snake — so the pair pins the boundary rather
 * than one side of it.
 */
import { describe, it, expect } from "vitest";
import { CELL_COUNT, START_LENGTH, ticksPerStepFor } from "@/lib/grainsnake/rules";
import { createGame, neighbour, segmentAt, stepMut } from "@/lib/grainsnake/engine";
import { DOWN, LEFT, RIGHT, UP, type Dir } from "@/lib/grainsnake/types";
import {
  DIRS,
  MIN_LETHAL_LENGTH,
  bodyCells,
  dieBySelfCollision,
  dirBetween,
  feed,
  head,
  nearlyFullState,
  serpentine,
  stateWithBody,
  stepOneCell,
  suicideDir,
} from "./grainsnake-support";

describe("a run that must die, dies — for the named reason, at a known tick", () => {
  it("ends by entering its own trail, and reports which cell", () => {
    const s = createGame(4242);
    feed(s, 12);
    expect(s.dead, "the fixture died while being set up").toBe(false);
    expect(s.length).toBe(START_LENGTH + 12);

    const trailBefore = new Set(bodyCells(s));
    const tailBefore = segmentAt(s, s.length - 1);

    const death = dieBySelfCollision(s);

    expect(s.dead, "the run did not end").toBe(true);
    // THE NAMED REASON, not merely "dead".
    expect(death.wasOwnTrail, "died without entering its own trail").toBe(true);
    expect(trailBefore.has(death.intoCell) || bodyCells(s).includes(death.intoCell)).toBe(true);
    expect(death.intoCell, "died on the exempt vacating tail, which must survive").not.toBe(
      tailBefore,
    );
  });

  it("dies on exactly the step it was steered into the trail", () => {
    // "At a known tick": the tick is not a magic constant, it is derived from the tier
    // in force — which is what makes it an assertion rather than a golden value nobody
    // can check.
    const s = createGame(4242);
    feed(s, 12);
    const kill = suicideDirAfterCoiling(s);
    const tickBefore = s.tick;
    const remaining = s.ticksToNextStep;

    stepOneCell(s, kill);

    expect(s.dead).toBe(true);
    expect(s.tick - tickBefore, "death landed on the wrong tick of the step").toBe(remaining);
    expect(remaining).toBeLessThanOrEqual(ticksPerStepFor(s.foodEaten));
  });

  it("stops advancing once dead — no tick, no step, no score", () => {
    const s = createGame(4242);
    feed(s, 12);
    dieBySelfCollision(s);
    const after = { tick: s.tick, score: s.score, length: s.length, headCell: head(s) };

    for (let i = 0; i < 200; i++) stepMut(s, i % 7 === 0 ? RIGHT : null);

    expect(s.tick).toBe(after.tick);
    expect(s.score).toBe(after.score);
    expect(s.length).toBe(after.length);
    expect(head(s)).toBe(after.headCell);
  });
});

/** Coil until a lethal move exists and return it, without taking it. */
function suicideDirAfterCoiling(s: ReturnType<typeof createGame>): Dir {
  const CW: Record<Dir, Dir> = { [UP]: RIGHT, [RIGHT]: DOWN, [DOWN]: LEFT, [LEFT]: UP };
  for (let i = 0; i < 64; i++) {
    const d = suicideDir(s);
    if (d !== null) return d;
    stepOneCell(s, CW[s.dir]);
  }
  throw new Error("no self-collision reachable");
}

describe("the boundary: what kills and what does not", () => {
  /**
   * A coil whose flank sits directly below the head, with two more cells behind it so
   * the target is NOT the tail — the vacating-tail exemption would otherwise make this
   * manoeuvre survivable and the test would be asserting the opposite rule by accident.
   */
  const COIL = [100, 101, 102, 125, 124, 123, 146, 147];

  it("a head entering a body cell dies", () => {
    const s = stateWithBody(COIL, LEFT);
    const target = neighbour(head(s), DOWN);
    expect(s.occupied[target], "fixture: the target is not body").toBe(1);
    expect(target, "fixture: the target is the exempt tail").not.toBe(segmentAt(s, s.length - 1));
    stepOneCell(s, DOWN);
    expect(s.dead).toBe(true);
  });

  it("CONTROL: the SAME shape stepping into empty space does not", () => {
    // Without this the assertion above is satisfied by an engine that kills on any step.
    const s = stateWithBody(COIL, LEFT);
    expect(s.occupied[neighbour(head(s), UP)], "fixture: UP is not empty").toBe(0);
    stepOneCell(s, UP);
    expect(s.dead).toBe(false);
  });

  /**
   * A 2×2 ring — 100 and 101 on one row, 124 and 123 directly below them. The head is
   * at 100 having arrived from 101, so it is heading LEFT, and its tail (123) sits
   * directly BELOW it. Stepping DOWN therefore enters the cell the tail is vacating on
   * this very step.
   */
  const RING = [100, 101, 124, 123];

  it("the vacating tail is not a collision — the one exception, still the only one", () => {
    const s = stateWithBody(RING, LEFT);
    const tail = segmentAt(s, s.length - 1);
    expect(neighbour(head(s), DOWN), "fixture: DOWN is not the tail").toBe(tail);
    stepOneCell(s, DOWN);
    expect(s.dead, "the vacating-tail exemption was lost").toBe(false);
    expect(head(s)).toBe(tail);
  });

  it("but the tail is fatal on a GROWING step, when it does not move", () => {
    // Food never spawns on the body, so the engine cannot reach this in play — the
    // condition is written out in `advanceOneCell` anyway rather than relying on that
    // invariant holding elsewhere, so it is asserted here the same way.
    const s = stateWithBody(RING, LEFT);
    const tail = segmentAt(s, s.length - 1);
    s.grain = tail; // the invariant, deliberately violated by the fixture
    stepOneCell(s, DOWN);
    expect(s.dead, "growing into a tail that does not move must be fatal").toBe(true);
  });
});

describe("death is impossible below length 5, and the engine agrees with the spec", () => {
  /**
   * The measured claim from the spec's *The board*, re-derived here against the REAL
   * engine rather than a model of it: at lengths 3 and 4 no reachable shape offers a
   * lethal move, and at 5 one does.
   *
   * This is what licenses `MIN_LETHAL_LENGTH`, which the audited survival assertions
   * elsewhere in the suite now lean on.
   */
  function lethalMovesAcross(targetLength: number): number {
    const seen = new Set<string>();
    const queue: { body: number[]; dir: Dir }[] = [];
    let lethal = 0;

    // Seed: grow from the real starting shape, one eat per step.
    const start = createGame(1);
    let frontier: { body: number[]; dir: Dir }[] = [{ body: bodyCells(start), dir: start.dir }];
    for (let len = START_LENGTH; len < targetLength; len++) {
      const next: { body: number[]; dir: Dir }[] = [];
      for (const st of frontier) {
        for (const d of DIRS) {
          if (d === ((st.dir ^ 2) as Dir)) continue;
          const s = stateWithBody(st.body, st.dir);
          s.grain = neighbour(head(s), d);
          stepOneCell(s, d);
          if (s.dead) continue;
          next.push({ body: bodyCells(s), dir: s.dir });
        }
      }
      frontier = next;
    }
    // Close under non-growing moves, which preserve the length.
    for (const st of frontier) queue.push(st);
    while (queue.length > 0) {
      const st = queue.pop()!;
      const key = JSON.stringify(st);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const d of DIRS) {
        if (d === ((st.dir ^ 2) as Dir)) continue;
        const s = stateWithBody(st.body, st.dir);
        stepOneCell(s, d);
        if (s.dead) {
          lethal++;
          continue;
        }
        if (seen.size < 4000) queue.push({ body: bodyCells(s), dir: s.dir });
      }
    }
    return lethal;
  }

  it("length 3 offers no lethal move at all", () => {
    expect(lethalMovesAcross(3)).toBe(0);
  });

  it("length 4 offers no lethal move at all", () => {
    expect(lethalMovesAcross(4)).toBe(0);
  });

  it("length 5 does — and it is MIN_LETHAL_LENGTH", () => {
    expect(lethalMovesAcross(5)).toBeGreaterThan(0);
    expect(MIN_LETHAL_LENGTH).toBe(5);
  });

  it("a length-3 snake held on one heading never dies, however long it runs", () => {
    // The consequence stated in the spec: a player who touches nothing after starting
    // circles the torus forever. It is correct, not a hang — the run has no terminator
    // until they eat.
    const s = createGame(7);
    s.grain = -1; // nothing to eat, so it stays at length 3
    stepMut(s, RIGHT);
    for (let i = 0; i < 2000; i++) {
      if (s.dead) break;
      stepMut(s, null);
    }
    expect(s.dead, "a length-3 snake found a way to die").toBe(false);
    expect(s.length).toBe(START_LENGTH);
    expect(s.tick).toBeGreaterThan(1000);
  });
});

describe("the win is not a death", () => {
  it("a full board ends the run without dying", () => {
    // `nearlyFullState` rather than a hand-built one: `createGame()` leaves `started`
    // false, and a state that never started does not advance a single tick — the first
    // draft of this test asserted a fill that had not been attempted.
    const s = nearlyFullState(CELL_COUNT - 1);
    const ahead = serpentine()[CELL_COUNT - 1];
    expect(s.occupied[ahead], "fixture: the last cell is not free").toBe(0);
    s.grain = ahead;
    stepOneCell(s, dirBetween(head(s), ahead));
    expect(s.filled).toBe(true);
    expect(s.length).toBe(CELL_COUNT);
    expect(s.dead, "filling the board must not read as a death").toBe(false);
  });
});
