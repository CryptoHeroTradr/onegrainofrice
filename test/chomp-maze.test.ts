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

/**
 * Every tile the player can actually stand on. The pen interior is open floor but is
 * sealed behind the gate, so it is walkable-looking and permanently unreachable — and
 * including it in a topology measurement gives an answer about a room nobody can enter.
 */
function reachableFromSpawn(): Set<string> {
  const seen = new Set([`${PLAYER_SPAWN_COL},${PLAYER_SPAWN_ROW}`]);
  const stack: [number, number][] = [[PLAYER_SPAWN_COL, PLAYER_SPAWN_ROW]];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) break;
    for (const n of playerNeighbours(cur[0], cur[1])) {
      const k = n.join(",");
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(n);
    }
  }
  return seen;
}

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

/**
 * The pen interior: open floor, but sealed off from the player by the gate.
 * Rows 13-16 since 2026-08-04 (Phase 5.5) — the pit gained a fourth floor row when the
 * wall band below it was thinned from two rows to one. Deliberately NOT derived from
 * PEN_TOP/PEN_BOTTOM: this file's job is to catch the maze constant drifting away from
 * the geometry it was signed off on, and a bound that follows the code cannot do that.
 */
function inPen(col: number, row: number): boolean {
  return row >= 13 && row <= 16 && col >= 11 && col <= 16;
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
    // 280 until 2026-08-04, when opening (10,24) and (17,24) to give the spawn pocket
    // two more ways out added a grain each. See the amendment note in maze.ts.
    expect(parsed.totalGrains).toBe(282);
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
    // The pen is exempt: it is a 6x4 ROOM by design, and its mouth over the gate is
    // legitimately two tiles wide. Nothing outside it may be.
    const inPenBlock = (c: number, r: number) =>
      c >= 10 && c + 1 <= 17 && r >= 11 && r + 1 <= 16;

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
    for (let r = 13; r <= 16; r++) {
      for (let c = 11; c <= 16; c++) {
        // Floor, not wall — pests live in here.
        expect(tileAt(grid, c, r)).toBe(EMPTY);
        // But the player can never walk to it: the only way in is the gate.
        expect(reachable.has(`${c},${r}`)).toBe(false);
      }
    }
  });

  /**
   * GIRTH — the length of the shortest cycle in the corridor network.
   *
   * It is the number that says whether the maze is a network of loops or a set of tight
   * rings a player can spin in. It was verified once by a throwaway script when the layout
   * was signed off; it is a test now because the row-24 amendment (see maze.ts) changed
   * the loop structure and "I checked it that one time" is not a guarantee that survives
   * the next edit.
   *
   * The pen is excluded, and that exclusion matters: the pen is a 6×3 room, so including
   * it reports a girth of 4 and ten 2×2 blocks that are not corridors at all.
   */
  it("has a shortest cycle of at least ten tiles", () => {
    const reachable = reachableFromSpawn();
    const key = (c: number, r: number) => `${c},${r}`;
    const nbrs = (c: number, r: number) =>
      playerNeighbours(c, r).filter(([nc, nr]) => reachable.has(key(nc, nr)));

    // Standard shortest-cycle search: drop each edge in turn and find the shortest path
    // that still joins its endpoints. That path plus the dropped edge is a cycle.
    let girth = Infinity;
    for (const cell of reachable) {
      const [c, r] = cell.split(",").map(Number);
      for (const [nc, nr] of nbrs(c, r)) {
        // Breadth-first from (c,r) to (nc,nr) without using the direct edge.
        const seen = new Map<string, number>([[key(c, r), 0]]);
        let frontier: [number, number][] = [[c, r]];
        let found = Infinity;
        while (frontier.length && found === Infinity) {
          const next: [number, number][] = [];
          for (const [cc, rr] of frontier) {
            const d = seen.get(key(cc, rr)) as number;
            if (d + 1 >= girth) continue;
            for (const [xc, xr] of nbrs(cc, rr)) {
              if (cc === c && rr === r && xc === nc && xr === nr) continue; // the dropped edge
              if (xc === c && xr === r && cc === nc && rr === nr) continue;
              const k = key(xc, xr);
              if (seen.has(k)) continue;
              seen.set(k, d + 1);
              if (xc === nc && xr === nr) {
                found = d + 1;
                break;
              }
              next.push([xc, xr]);
            }
            if (found !== Infinity) break;
          }
          frontier = next;
        }
        if (found + 1 < girth) girth = found + 1;
      }
    }
    expect(girth).toBeGreaterThanOrEqual(10);
  });

  /**
   * The room the player spawns in must not be sealable by two pests.
   *
   * It was, until 2026-08-04: row 25 cols 10-17 plus the two shafts under it had exactly
   * two ways out, both on row 29, and a pest on each one is a closed box — every corridor
   * here is one tile wide, so there is nothing to slip past. Two pests wandering into
   * position ended the run wherever the player happened to be standing.
   * test/chomp-kiting.test.ts measures that end of it; this asserts the geometry that
   * makes it survivable.
   */
  it("gives the spawn pocket more than two ways out", () => {
    const inPocket = (c: number, r: number) => {
      if (c < 10 || c > 17) return false;
      if (r === 25) return true;
      return (c === 10 || c === 17) && r >= 26 && r <= 28;
    };
    const ways: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!inPocket(c, r)) continue;
        for (const [nc, nr] of playerNeighbours(c, r)) {
          if (!inPocket(nc, nr)) ways.push(`${c},${r} -> ${nc},${nr}`);
        }
      }
    }
    expect(ways).toHaveLength(4);
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
