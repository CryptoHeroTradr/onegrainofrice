import { createGame, beginPlay, tick, PLAYING, GAMEOVER, DYING } from "@/components/chomp/engine/game";
import { playerBfs, threats, botChoose, DEFAULT_HORIZON } from "./test/chomp-support";
import { COLS, ROWS, isOpenForPlayer, tileOf, wrapCol } from "@/components/chomp/engine/maze";
import { DX, DY, GRAIN, POWER, type Dir } from "@/components/chomp/engine/types";
import type { GameState } from "@/components/chomp/engine/game";

const DIRS: Dir[] = [0, 1, 2, 3];
const idx = (c: number, r: number) => r * COLS + c;

/** BFS out from every remaining grain: dist[tile] = steps to the nearest uneaten grain. */
function grainField(grid: Uint8Array): Int16Array {
  const sources: { col: number; row: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[idx(c, r)];
      if (t === GRAIN || t === POWER) sources.push({ col: c, row: r });
    }
  }
  return sources.length ? playerBfs(grid, sources) : new Int16Array(COLS * ROWS).fill(-1);
}

/**
 * A bot that actually plays: head for grains, but never into a tile a pest reaches first.
 * `botChoose` is pure survival and will happily circle a cleared corridor forever, which
 * is why it never finished a board.
 */
function chooseClearing(state: GameState, tile: { col: number; row: number }, facing: Dir, margin: number): Dir {
  const danger = playerBfs(state.grid, threats(state.pests));
  const grains = grainField(state.grid);

  let bestDir: Dir | null = null;
  let bestScore = Infinity;
  for (const d of DIRS) {
    const nc = wrapCol(tile.col + DX[d]);
    const nr = tile.row + DY[d];
    if (nr < 0 || nr >= ROWS) continue;
    if (!isOpenForPlayer(state.grid, nc, nr)) continue;
    const i = idx(nc, nr);
    const dgr = grains[i];
    if (dgr < 0) continue;
    const threat = danger[i];
    // Refuse a step a pest can reach at least as soon as we can (plus a safety margin).
    if (threat >= 0 && threat <= margin) continue;
    if (dgr < bestScore) { bestScore = dgr; bestDir = d; }
  }
  // Nothing safe leads to a grain — fall back to pure survival for this tile.
  return bestDir ?? botChoose(state, tile, facing, DEFAULT_HORIZON);
}

function playLevel1(seed: number, margin: number, override?: (t: GameState["tuning"]) => void) {
  const g = beginPlay(createGame(1, seed));
  if (override) override(g.tuning);
  let lastTile = -1;
  for (let t = 0; t < 60 * 600; t++) {
    if (g.phase === GAMEOVER || g.grainsRemaining === 0) break;
    if (g.phase === PLAYING) {
      const tile = { col: tileOf(g.player.x), row: tileOf(g.player.y) };
      const here = idx(tile.col, tile.row);
      if (here !== lastTile) {
        lastTile = here;
        const d = chooseClearing(g, tile, g.player.dir, margin);
        (g.player as { wanted: Dir }).wanted = d;
        g.inputLog.push({ tick: g.tick, dir: d });
      }
    }
    tick(g);
  }
  return { cleared: g.grainsRemaining === 0, secs: g.tick / 60, grains: g.grainsEaten,
           total: g.grainsEaten + g.grainsRemaining, score: g.score, lives: g.lives };
}

const SEEDS = Array.from({ length: 10 }, (_, i) => 1000 + i * 7919);
console.log("=== clearing bot, level 1 as shipped — margin sweep ===");
for (const m of [0, 1, 2, 3, 4, 5]) {
  const rows = SEEDS.map((s) => playLevel1(s, m));
  const cleared = rows.filter((r) => r.cleared).length;
  const board = rows.reduce((a, r) => a + r.grains / r.total, 0) / rows.length;
  const times = rows.filter((r) => r.cleared).map((r) => r.secs);
  console.log(
    `safety margin ${m}`.padEnd(20),
    `cleared ${String(cleared).padStart(2)}/10 | mean board ${(board * 100).toFixed(0)}%`,
    times.length ? `| clear ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)}s` : "",
  );
}
