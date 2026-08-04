/**
 * RICE CHOMP — shared test machinery.
 *
 * Not a suite (vitest only collects `*.test.ts`), and deliberately NOT in
 * src/components/chomp/engine: none of this ships. It is the measuring equipment —
 * a breadth-first distance function and a playing bot — that the cornering and kiting
 * suites use to ask questions the maze geometry can only half-answer.
 *
 * The bot exists because "can a competent player kite all four pests forever?" is not a
 * question a human can answer by playing for ten minutes and reporting a feeling. It is
 * a question about whether a good policy, run for a long time, survives.
 */

import {
  COLS,
  ROWS,
  isOpenForPlayer,
  tileCentre,
  tileOf,
  wrapCol,
} from "@/components/chomp/engine/maze";
import { DYING, GAMEOVER, PLAYING, setWanted, type GameState } from "@/components/chomp/engine/game";
import { OUT, type Pest } from "@/components/chomp/engine/pests";
import {
  DOWN,
  DX,
  DY,
  GRAIN,
  LEFT,
  POWER,
  RIGHT,
  UP,
  opposite,
  type Dir,
} from "@/components/chomp/engine/types";

export const DIRS: readonly Dir[] = [UP, LEFT, DOWN, RIGHT];

export function idx(col: number, row: number): number {
  return row * COLS + wrapCol(col);
}

/**
 * Breadth-first distance in tiles from every source tile, over tiles the PLAYER can walk.
 * Warp-aware. Unreached tiles hold -1.
 *
 * This is the bot's model of danger and of opportunity, and it is deliberately more
 * capable than anything the pests have: the bot is supposed to represent a competent
 * player, and a competent player does know the maze.
 */
export function playerBfs(
  grid: Uint8Array,
  sources: readonly { col: number; row: number }[],
): Int16Array {
  const dist = new Int16Array(COLS * ROWS).fill(-1);
  const queue = new Int32Array(COLS * ROWS);
  let head = 0;
  let tail = 0;
  for (const s of sources) {
    if (s.row < 0 || s.row >= ROWS) continue;
    const i = idx(s.col, s.row);
    if (dist[i] !== -1) continue;
    dist[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const at = queue[head++];
    const c = at % COLS;
    const r = (at - c) / COLS;
    for (const d of DIRS) {
      const nc = wrapCol(c + DX[d]);
      const nr = r + DY[d];
      if (nr < 0 || nr >= ROWS) continue;
      if (!isOpenForPlayer(grid, nc, nr)) continue;
      const ni = nr * COLS + nc;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[at] + 1;
      queue[tail++] = ni;
    }
  }
  return dist;
}

/** Tile-to-tile distance for the player, or -1 if unreachable. */
export function tileDistance(
  grid: Uint8Array,
  from: { col: number; row: number },
  to: { col: number; row: number },
): number {
  return playerBfs(grid, [from])[idx(to.col, to.row)];
}

/** The pests that can currently kill the player. Frightened ones are prey, not threats. */
export function threats(pests: readonly Pest[]): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  for (const p of pests) {
    if (p.state !== OUT || p.frightened) continue;
    out.push({ col: tileOf(p.x), row: tileOf(p.y) });
  }
  return out;
}

// --- the bot ----------------------------------------------------------------

/**
 * How far ahead the bot looks for somewhere safe to be, in tiles.
 *
 * Tunable so the kiting suite can check its own conclusion: if the bot survives far
 * longer at a deeper horizon then the limit was the bot's foresight, not the maze, and
 * "a competent player cannot kite here" would have been an unearned finding.
 */
export const DEFAULT_HORIZON = 14;

/**
 * Play the same game with cornering switched off, by setting the level's corner lead to
 * zero. This is the control run: the identical bot, the identical maze, the identical
 * pests, and the only difference is whether an early turn banks distance.
 */
export function disableCornering(state: GameState): void {
  state.tuning = { ...state.tuning, cornerLead: 0 };
}

/**
 * What the bot can still get to from a tile, assuming the pests keep coming.
 *
 * Breadth-first from (col,row), expanding a tile only if the bot would arrive there
 * STRICTLY before the nearest pest could. Two numbers come back:
 *
 *   room   — how many tiles it can still reach. This is the important one. A player about
 *            to be sealed into a pocket has a small number here well before they are
 *            actually caught, which is exactly the judgement the test is trying to make.
 *   margin — the biggest head start available anywhere in that space.
 */
function safeReach(
  grid: Uint8Array,
  danger: Int16Array,
  col: number,
  row: number,
  HORIZON: number,
): { room: number; margin: number } {
  const start = idx(col, row);
  const startDanger = danger[start];
  if (startDanger === -1) return { room: HORIZON * 4, margin: HORIZON }; // nobody hunting
  // A tile a pest is on, or reaches first, is not a step — it is a death.
  if (startDanger <= 1) return { room: 0, margin: -HORIZON };

  const seen = new Set<number>([start]);
  let frontier = [start];
  let room = 1;
  let margin = startDanger - 1;

  for (let step = 1; step <= HORIZON; step++) {
    const next: number[] = [];
    for (const at of frontier) {
      const c = at % COLS;
      const r = (at - c) / COLS;
      for (const d of DIRS) {
        const nc = wrapCol(c + DX[d]);
        const nr = r + DY[d];
        if (nr < 0 || nr >= ROWS) continue;
        if (!isOpenForPlayer(grid, nc, nr)) continue;
        const ni = nr * COLS + nc;
        if (seen.has(ni)) continue;
        const dd = danger[ni];
        if (dd !== -1 && dd <= step + 1) continue;
        seen.add(ni);
        next.push(ni);
        room++;
        const m = dd === -1 ? HORIZON : dd - (step + 1);
        if (m > margin) margin = m;
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return { room, margin };
}

/** How many ways out a tile has. Used to tell a corridor from a junction. */
function exits(grid: Uint8Array, col: number, row: number): number {
  let n = 0;
  for (const d of DIRS) {
    const nr = row + DY[d];
    if (nr < 0 || nr >= ROWS) continue;
    if (isOpenForPlayer(grid, wrapCol(col + DX[d]), nr)) n++;
  }
  return n;
}

/**
 * Pick a direction from `tile`.
 *
 * Two rules, and the second one is what makes it play like a person rather than like a
 * hill-climber:
 *
 *  1. COMMIT. In a corridor, keep going. A first version of this bot re-decided on every
 *     tile and spent whole runs oscillating between two adjacent tiles, because when two
 *     pests approach from opposite ends every direction scores about the same and the
 *     tiebreak flips each time the field shifts. Dithering is not a maze verdict, it is a
 *     bot bug, and it made the maze look far more dangerous than it is. So the bot only
 *     re-decides at a junction, or when the way ahead has stopped being safe.
 *
 *  2. PREFER ROOM, then margin. Score a first step by how much of the maze the bot can
 *     still reach from it before the pests could cut it off. Head start alone is a local
 *     measure and will happily walk into a pocket that is about to be closed; room is the
 *     measure that sees the trap coming.
 */
export function botChoose(
  state: GameState,
  tile: { col: number; row: number },
  facing: Dir,
  horizon = DEFAULT_HORIZON,
): Dir {
  const danger = playerBfs(state.grid, threats(state.pests));
  const back = opposite(facing);

  const scoreOf = (d: Dir): number => {
    const nc = wrapCol(tile.col + DX[d]);
    const nr = tile.row + DY[d];
    if (nr < 0 || nr >= ROWS) return -Infinity;
    if (!isOpenForPlayer(state.grid, nc, nr)) return -Infinity;
    const { room, margin } = safeReach(state.grid, danger, nc, nr, horizon);
    // Room dominates; margin breaks ties between equally roomy options. Reversing is
    // legal and sometimes right, but it must never win a tie.
    return room * 100 + margin - (d === back ? 1 : 0);
  };

  const straight = scoreOf(facing);
  if (exits(state.grid, tile.col, tile.row) <= 2 && straight > 0) return facing;

  let bestDir = facing;
  let bestScore = -Infinity;
  for (const d of DIRS) {
    const s = scoreOf(d);
    // Strictly greater, so DIRS order (up, left, down, right) breaks ties the same way
    // the pests do. Determinism matters more than which way it leans.
    if (s > bestScore) {
      bestScore = s;
      bestDir = d;
    }
  }
  return bestDir;
}

export interface BotRun {
  /** Ticks survived before the first death, or the full budget if it never died. */
  ticks: number;
  died: boolean;
  score: number;
  /** How many ticks the bot spent inside the spawn pocket. */
  pocketTicks: number;
  /** Ticks on which every route out of the pocket was covered while the bot was in it. */
  sealedTicks: number;
  state: GameState;
}

/**
 * Drive a game with the bot until it dies or the budget runs out.
 *
 * The bot decides ONE TILE AHEAD and buffers the turn immediately, which is what a
 * competent player does and what lets it corner: the engine takes a buffered turn at the
 * earliest legal moment, which is CORNER_LEAD subunits before the junction.
 */
export function runBot(
  state: GameState,
  budget: number,
  step: (s: GameState) => void,
  horizon = DEFAULT_HORIZON,
): BotRun {
  let lastTile = -1;
  let pocketTicks = 0;
  let sealedTicks = 0;
  let died = false;
  let t = 0;

  for (; t < budget; t++) {
    const tile = { col: tileOf(state.player.x), row: tileOf(state.player.y) };
    const here = idx(tile.col, tile.row);
    if (here !== lastTile) {
      lastTile = here;
      setWanted(state, botChoose(state, tile, state.player.dir, horizon));
    }

    if (inPocket(tile)) {
      pocketTicks++;
      if (pocketSealed(state)) sealedTicks++;
    }

    step(state);
    if (state.phase === DYING) {
      died = true;
      break;
    }
  }

  return { ticks: t, died, score: state.score, pocketTicks, sealedTicks, state };
}

/**
 * Drive the player round and round a fixed rectangular circuit until they are caught.
 *
 * This is the crudest possible kiting strategy and the one the question is actually about:
 * pick a loop, run laps, never think again. Cornering is in play — the turn is buffered on
 * arrival at each corner, so the engine takes it at the earliest legal moment — which
 * makes this the best case for kiting rather than a straw man.
 */
export function runOrbit(
  state: GameState,
  corners: readonly { col: number; row: number; turn: Dir }[],
  budget: number,
  step: (s: GameState) => void,
): { ticks: number; died: boolean; laps: number } {
  let next = 0;
  let laps = 0;
  let t = 0;
  for (; t < budget; t++) {
    const col = tileOf(state.player.x);
    const row = tileOf(state.player.y);
    const wp = corners[next];
    if (col === wp.col && row === wp.row) setWanted(state, wp.turn);
    if (state.player.dir === wp.turn) {
      next = (next + 1) % corners.length;
      if (next === 0) laps++;
    }
    step(state);
    if (state.phase === DYING) return { ticks: t, died: true, laps };
  }
  return { ticks: t, died: false, laps };
}

/** Put the player on a circuit's first corner, facing along it. */
export function placeOn(
  state: GameState,
  corner: { col: number; row: number },
  facing: Dir,
): void {
  state.player.x = tileCentre(corner.col);
  state.player.y = tileCentre(corner.row);
  state.player.dir = facing;
  state.player.wanted = facing;
}

// --- the spawn pocket -------------------------------------------------------

/**
 * The bottom-centre room the player spawns in: row 25 cols 10-17, the two shafts down
 * cols 10 and 17, and the stretch of row 29 beneath them.
 */
export function inPocket(tile: { col: number; row: number }): boolean {
  const c = wrapCol(tile.col);
  if (c < 10 || c > 17) return false;
  if (tile.row === 25) return true;
  return (c === 10 || c === 17) && tile.row >= 26 && tile.row <= 28;
}

/**
 * The tiles just OUTSIDE the pocket, one per way out — stand a pest on one and that route
 * is closed, because every corridor here is a single tile wide and there is no passing.
 *
 * There were two of these until 2026-08-04, both on row 29 and both reachable by a pest
 * strolling along the bottom corridor. Rows 24 added two more, upward into the row-23
 * corridor. Sealing the room the player spawns in now takes four pests in four places
 * rather than two pests in two.
 */
export const POCKET_EXITS: readonly { col: number; row: number }[] = [
  { col: 10, row: 29 }, // down the left shaft
  { col: 17, row: 29 }, // down the right shaft
  { col: 10, row: 24 }, // up the left lateral exit
  { col: 17, row: 24 }, // up the right lateral exit
];

/** The two exits that existed before the lateral cut. Kept so the old seal can be re-run. */
export const POCKET_EXITS_ORIGINAL = POCKET_EXITS.slice(0, 2);

/** Is every one of these routes currently covered by a pest? */
export function exitsCovered(
  state: GameState,
  gates: readonly { col: number; row: number }[],
): boolean {
  const t = threats(state.pests);
  // These tiles are nowhere near the warp, so plain arithmetic is honest here.
  return gates.every((gate) =>
    t.some((p) => Math.abs(p.col - gate.col) <= 1 && Math.abs(p.row - gate.row) <= 1),
  );
}

/** Is the pocket sealed against every route out of it? */
export function pocketSealed(state: GameState): boolean {
  return exitsCovered(state, POCKET_EXITS);
}

/**
 * Clear every grain, so a measurement is about pursuit and not about the chomp freeze.
 * `grainsRemaining` is left high rather than zeroed: at zero the engine would declare the
 * level complete on the next tick, and a kiting run needs a level that never ends.
 */
export function stripGrains(state: GameState): void {
  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i] === 2 || state.grid[i] === 3) state.grid[i] = 1;
  }
  state.grainsRemaining = 9999;
}

/** Turn golden grains into ordinary ones, so no power window can ever open. */
export function disarmPower(state: GameState): void {
  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i] === 3) state.grid[i] = 2;
  }
}

// --- the clearing bot -------------------------------------------------------

/**
 * Breadth-first OUT from every remaining grain at once, so `dist[tile]` is the number of
 * steps from that tile to the nearest thing still worth eating.
 */
export function grainField(grid: Uint8Array): Int16Array {
  const sources: { col: number; row: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[idx(c, r)];
      if (t === GRAIN || t === POWER) sources.push({ col: c, row: r });
    }
  }
  return sources.length ? playerBfs(grid, sources) : new Int16Array(COLS * ROWS).fill(-1);
}

/** How much sooner than a pest the clearing bot insists on reaching a tile, in steps. */
export const DEFAULT_SAFETY_MARGIN = 2;

/**
 * Choose a direction for a bot that is trying to FINISH THE BOARD, not merely survive.
 *
 * ── WHY THIS EXISTS, SEPARATELY FROM botChoose ──────────────────────────────────
 * `botChoose` maximises reachable safe space. That is the right objective for "can a
 * competent player evade forever?" and completely the wrong one for "can a competent
 * player clear level 1?" — it will circle an already-eaten corridor indefinitely because
 * empty corridor is just as safe as full corridor. Measured with it, level 1 looked
 * unclearable at every pest speed down to 75% of the player's, which said nothing about
 * the game and everything about the bot.
 *
 * This one heads for the nearest remaining grain and refuses any step a pest could reach
 * within `margin` moves, falling back to pure survival when nothing safe leads anywhere.
 * Still an OPTIMISTIC proxy for a human: it has exact pest positions and a whole-board
 * breadth-first search every tile. Treat a clear here as "the level is completable",
 * never as "the level is easy".
 */
export function botChooseClearing(
  state: GameState,
  tile: { col: number; row: number },
  facing: Dir,
  margin = DEFAULT_SAFETY_MARGIN,
  horizon = DEFAULT_HORIZON,
): Dir {
  const danger = playerBfs(state.grid, threats(state.pests));
  const grains = grainField(state.grid);

  let bestDir: Dir | null = null;
  let bestDist = Infinity;
  for (const d of DIRS) {
    const nc = wrapCol(tile.col + DX[d]);
    const nr = tile.row + DY[d];
    if (nr < 0 || nr >= ROWS) continue;
    if (!isOpenForPlayer(state.grid, nc, nr)) continue;
    const i = idx(nc, nr);
    const toGrain = grains[i];
    if (toGrain < 0) continue;
    const toPest = danger[i];
    if (toPest >= 0 && toPest <= margin) continue;
    // Strictly less, so DIRS order breaks ties the same way everything else here does.
    if (toGrain < bestDist) {
      bestDist = toGrain;
      bestDir = d;
    }
  }
  return bestDir ?? botChoose(state, tile, facing, horizon);
}

export interface ClearRun {
  cleared: boolean;
  /** Simulated seconds elapsed when the level was cleared, or when the run gave up. */
  seconds: number;
  grainsEaten: number;
  grainsTotal: number;
  score: number;
  livesLeft: number;
}

/**
 * Play a level with the clearing bot until the board is empty, the run is over, or the
 * budget expires. Deaths are played through: the point is whether the LEVEL falls, not
 * whether a particular life does.
 */
export function runClearBot(
  state: GameState,
  budgetTicks: number,
  step: (s: GameState) => void,
  margin = DEFAULT_SAFETY_MARGIN,
): ClearRun {
  let lastTile = -1;
  for (let t = 0; t < budgetTicks; t++) {
    if (state.phase === GAMEOVER || state.grainsRemaining === 0) break;
    if (state.phase === PLAYING) {
      const tile = { col: tileOf(state.player.x), row: tileOf(state.player.y) };
      const here = idx(tile.col, tile.row);
      if (here !== lastTile) {
        lastTile = here;
        setWanted(state, botChooseClearing(state, tile, state.player.dir, margin));
      }
    }
    step(state);
  }
  return {
    cleared: state.grainsRemaining === 0,
    seconds: state.tick / 60,
    grainsEaten: state.grainsEaten,
    grainsTotal: state.grainsEaten + state.grainsRemaining,
    score: state.score,
    livesLeft: state.lives,
  };
}

export { LEFT, RIGHT, UP, DOWN };
