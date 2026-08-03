import { describe, expect, it } from "vitest";
import {
  COLS,
  MAZE,
  PLAYER_SPAWN_COL,
  PLAYER_SPAWN_ROW,
  ROWS,
  TUNNEL_ROW,
  isOpenForPlayer,
  offsetFromCentre,
  parseMaze,
  tileAt,
  tileCentre,
  tileOf,
  wrapCol,
} from "@/components/chomp/engine/maze";
import { EMPTY, GATE, GRAIN, POWER, SUB, WALL } from "@/components/chomp/engine/types";

/**
 * The maze is a hand-authored constant, and every property the game depends on is a
 * property of that constant: symmetry, no dead ends, one-tile corridors, a working
 * tunnel, a sealed pen. These are exactly the invariants that a "quick tweak" to the
 * layout silently breaks, and they are cheap to assert, so they are asserted.
 *
 * The maze was signed off on these numbers (docs/rice-chomp-plan.md §7); if one of
 * these fails, the layout changed and the sign-off is stale.
 */

const { grid } = parseMaze();

/** Walkable-by-player neighbours, with the tunnel row wrapping. */
function playerNeighbours(col: number, row: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dc, dr] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const) {
    const nr = row + dr;
    if (nr < 0 || nr >= ROWS) continue;
    const nc = wrapCol(col + dc);
    if (isOpenForPlayer(grid, nc, nr)) out.push([nc, nr]);
  }
  return out;
}

/** The pen interior: open floor, but sealed off from the player by the gate. */
function inPen(col: number, row: number): boolean {
  return row >= 13 && row <= 15 && col >= 11 && col <= 16;
}

/** Every tile the player can stand on. Excludes the pen interior (pest-only). */
function playerTiles(): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isOpenForPlayer(grid, c, r) && !inPen(c, r)) out.push([c, r]);
    }
  }
  return out;
}

describe("maze shape", () => {
  it("is 28 columns by 31 rows", () => {
    expect(MAZE).toHaveLength(ROWS);
    for (const row of MAZE) expect(row).toHaveLength(COLS);
  });

  it("is mirror-symmetric about the vertical axis", () => {
    const asymmetric: string[] = [];
    MAZE.forEach((row, y) => {
      for (let x = 0; x < COLS / 2; x++) {
        if (row.charAt(x) !== row.charAt(COLS - 1 - x)) asymmetric.push(`row ${y} col ${x}`);
      }
    });
    expect(asymmetric).toEqual([]);
  });

  it("parses to the counts the design was signed off on", () => {
    const parsed = parseMaze();
    expect(parsed.totalGrains).toBe(280);
    expect(parsed.totalPower).toBe(4);
    expect(parsed.grid).toHaveLength(COLS * ROWS);
  });

  it("rejects a malformed maze rather than half-building one", () => {
    expect(() => parseMaze(["####"])).toThrow(/31 rows/);
    expect(() => parseMaze(MAZE.map((r, i) => (i === 5 ? "###" : r)))).toThrow(/28 wide/);
    expect(() => parseMaze(MAZE.map((r, i) => (i === 5 ? "X".repeat(COLS) : r)))).toThrow(
      /unknown maze char/,
    );
  });
});

describe("maze topology", () => {
  it("has no dead ends — every reachable tile has at least two exits", () => {
    const bad = playerTiles().filter(([c, r]) => playerNeighbours(c, r).length < 2);
    expect(bad).toEqual([]);
  });

  it("has no 2x2 open block in the corridor network", () => {
    // A two-wide corridor would let pests pass each other and let the player sidestep,
    // which breaks pursuit outright. This is the check that caught the original row 28
    // (rows 28-29 formed a 2-tile-wide room; girth was 4).
    //
    // The pen is exempt: it is a 6x3 ROOM by design, and its mouth over the gate is
    // legitimately two tiles wide. Nothing outside it may be.
    const inPenBlock = (c: number, r: number) =>
      c >= 10 && c + 1 <= 17 && r >= 11 && r + 1 <= 15;

    const bad: string[] = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        if (inPenBlock(c, r)) continue;
        const open =
          tileAt(grid, c, r) !== WALL &&
          tileAt(grid, c + 1, r) !== WALL &&
          tileAt(grid, c, r + 1) !== WALL &&
          tileAt(grid, c + 1, r + 1) !== WALL;
        if (open) bad.push(`(${c},${r})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("connects every player tile to the spawn", () => {
    const start: [number, number] = [PLAYER_SPAWN_COL, PLAYER_SPAWN_ROW];
    const seen = new Set([start.join(",")]);
    const stack: [number, number][] = [start];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) break;
      for (const n of playerNeighbours(cur[0], cur[1])) {
        const k = n.join(",");
        if (!seen.has(k)) {
          seen.add(k);
          stack.push(n);
        }
      }
    }
    expect(seen.size).toBe(playerTiles().length);
  });

  it("seals the pen: open floor inside, but unreachable by the player", () => {
    const reachable = new Set<string>();
    const stack: [number, number][] = [[PLAYER_SPAWN_COL, PLAYER_SPAWN_ROW]];
    reachable.add(stack[0].join(","));
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) break;
      for (const n of playerNeighbours(cur[0], cur[1])) {
        const k = n.join(",");
        if (!reachable.has(k)) {
          reachable.add(k);
          stack.push(n);
        }
      }
    }
    for (let r = 13; r <= 15; r++) {
      for (let c = 11; c <= 16; c++) {
        // Floor, not wall — pests live in here.
        expect(tileAt(grid, c, r)).toBe(EMPTY);
        // But the player can never walk to it: the only way in is the gate.
        expect(reachable.has(`${c},${r}`)).toBe(false);
      }
    }
  });

  it("has a gate above the pen that the player cannot pass", () => {
    const gates: number[] = [];
    for (let c = 0; c < COLS; c++) if (tileAt(grid, c, 12) === GATE) gates.push(c);
    expect(gates).toEqual([13, 14]);
    for (const c of gates) expect(isOpenForPlayer(grid, c, 12)).toBe(false);
  });
});

describe("warp tunnel", () => {
  it("is open at both edges on the tunnel row and nowhere else", () => {
    for (let r = 0; r < ROWS; r++) {
      const openEdges = tileAt(grid, 0, r) !== WALL && tileAt(grid, COLS - 1, r) !== WALL;
      expect(openEdges).toBe(r === TUNNEL_ROW);
    }
  });

  it("carries no grains, so it is an escape route and not a scoring lane", () => {
    for (const c of [0, 1, 2, 3, 4, 5, 22, 23, 24, 25, 26, 27]) {
      const t = tileAt(grid, c, TUNNEL_ROW);
      expect(t === GRAIN || t === POWER).toBe(false);
    }
  });

  it("wraps columns past both edges", () => {
    expect(wrapCol(-1)).toBe(COLS - 1);
    expect(wrapCol(COLS)).toBe(0);
    expect(wrapCol(COLS + 3)).toBe(3);
    expect(wrapCol(-COLS - 1)).toBe(COLS - 1);
    // Reading off the left edge of the tunnel row lands on the right edge.
    expect(tileAt(grid, -1, TUNNEL_ROW)).toBe(tileAt(grid, COLS - 1, TUNNEL_ROW));
  });
});

describe("bounds guarding", () => {
  it("reads rows outside the maze as wall rather than undefined", () => {
    expect(tileAt(grid, 5, -1)).toBe(WALL);
    expect(tileAt(grid, 5, ROWS)).toBe(WALL);
    expect(tileAt(grid, 5, 9999)).toBe(WALL);
    expect(isOpenForPlayer(grid, 5, -1)).toBe(false);
  });
});

describe("subunit conversion", () => {
  it("round-trips tile centres", () => {
    for (const t of [0, 1, 13, 27]) {
      expect(tileOf(tileCentre(t))).toBe(t);
      expect(offsetFromCentre(tileCentre(t))).toBe(0);
    }
  });

  it("reports a signed offset either side of the centre", () => {
    const c = tileCentre(4);
    expect(offsetFromCentre(c - 10)).toBe(-10);
    expect(offsetFromCentre(c + 10)).toBe(10);
  });

  it("puts a tile boundary exactly between two centres", () => {
    expect(tileCentre(1) - tileCentre(0)).toBe(SUB);
    expect(tileOf(SUB - 1)).toBe(0);
    expect(tileOf(SUB)).toBe(1);
  });
});

describe("spawn", () => {
  it("straddles two open tiles below the pen", () => {
    expect(isOpenForPlayer(grid, PLAYER_SPAWN_COL, PLAYER_SPAWN_ROW)).toBe(true);
    expect(isOpenForPlayer(grid, PLAYER_SPAWN_COL - 1, PLAYER_SPAWN_ROW)).toBe(true);
  });
});
