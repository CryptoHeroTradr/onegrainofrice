/**
 * RICE CHOMP — the simulation.
 *
 * Pure module: no React, no DOM, no node builtins, no clock. The host component
 * converts wall-clock time into whole ticks and calls `tick()`; everything in here is
 * integer arithmetic, so the same inputs at the same tick numbers always produce the
 * same state. See ./types.ts for why that matters.
 *
 * PHASE 2 SCOPE: maze, player movement, grain eating. No pests, no scoring rules, no
 * audio, no leaderboard. Movement feel is the whole deliverable, so the interesting
 * code is `stepOneSubunit` and the three things that make grid movement feel good:
 * persistent input buffering, forgiving turns, and free reversal.
 */

import {
  COLS,
  PLAYER_SPAWN_COL,
  PLAYER_SPAWN_ROW,
  isOpenForPlayer,
  offsetFromCentre,
  parseMaze,
  setTile,
  tileAt,
  tileCentre,
  tileOf,
} from "./maze";
import {
  DX,
  DY,
  EMPTY,
  GRAIN,
  LEFT,
  NONE,
  POWER,
  SPEED_SCALE,
  SUB,
  isVertical,
  opposite,
  tilesPerSecond,
  type Dir,
  type DirOrNone,
} from "./types";

// --- tunables ---------------------------------------------------------------
// These are the movement-feel dials. They are the numbers to argue about.

/**
 * Player speed. The arcade genre sits around 7.5–9.5 tiles/second; 8 is a brisk,
 * readable middle. tilesPerSecond(8) is exactly 16 subunits/tick at SUB=120, 60Hz,
 * so there is no rounding at the default speed.
 */
export const PLAYER_SPEED = tilesPerSecond(8);

/**
 * How far from a tile centre a perpendicular turn is still accepted, in subunits
 * (SUB=120, so 30 is a quarter tile). On acceptance the player snaps to the centre of
 * the axis being left.
 *
 * This is the single most important number for how the game feels. At 0 you must hit
 * the centre on the exact tick and the game feels broken; too high and the player
 * visibly teleports around corners. A quarter tile is ~2 ticks of travel at the
 * default speed — forgiving enough that a turn keyed slightly early or late still
 * takes, small enough that the snap is invisible.
 */
export const TURN_TOLERANCE = 30;

// --- state ------------------------------------------------------------------

export interface Player {
  /** Position in subunits. The axis perpendicular to `dir` is always a tile centre. */
  x: number;
  y: number;
  /** Direction of travel. Never NONE — a stopped player still faces somewhere. */
  dir: Dir;
  /**
   * The direction the player has asked for. Persists until it is satisfied or
   * replaced — hold into a wall and you turn the instant the opening arrives, which
   * is the arcade behaviour and the reason the controls feel telepathic.
   */
  wanted: DirOrNone;
  /** Fractional-speed carry, in speed units. Keeps movement integral. */
  moveAcc: number;
  /** Total subunits travelled. Drives the chomp animation, so it stays deterministic. */
  distance: number;
  /** True when the player is pressed up against a wall and not moving. */
  blocked: boolean;
}

export interface GameState {
  grid: Uint8Array;
  player: Player;
  /** Ticks simulated since the run began. The x-axis of the input trace. */
  tick: number;
  grainsEaten: number;
  powerEaten: number;
  grainsRemaining: number;
  /**
   * Every direction change, stamped with the tick it took effect on. This IS the
   * input trace: replaying these against a fresh state reproduces the run exactly.
   * Recorded from day one so server-side replay verification is later a server change
   * only, never a re-architecture.
   */
  inputLog: { tick: number; dir: Dir }[];
}

export function createGame(): GameState {
  const { grid, totalGrains, totalPower } = parseMaze();
  return {
    grid,
    player: {
      // Spawn straddling the boundary between two columns, so the first horizontal
      // input is legal immediately.
      x: PLAYER_SPAWN_COL * SUB,
      y: tileCentre(PLAYER_SPAWN_ROW),
      dir: LEFT,
      wanted: NONE,
      moveAcc: 0,
      distance: 0,
      blocked: false,
    },
    tick: 0,
    grainsEaten: 0,
    powerEaten: 0,
    grainsRemaining: totalGrains + totalPower,
    inputLog: [],
  };
}

/**
 * Queue a direction. Cheap and idempotent: re-pressing the direction already wanted
 * does nothing and is not logged, so holding a key does not flood the trace.
 */
export function setWanted(state: GameState, dir: Dir): void {
  if (state.player.wanted === dir) return;
  state.player.wanted = dir;
  state.inputLog.push({ tick: state.tick, dir });
}

// --- movement ---------------------------------------------------------------

/** The tile the player currently occupies. */
export function playerTile(state: GameState): { col: number; row: number } {
  return { col: tileOf(state.player.x), row: tileOf(state.player.y) };
}

/**
 * Try to apply the buffered direction. Returns true if the direction changed.
 *
 * Two rules, and the difference between them is most of the feel:
 *  - A REVERSAL is always legal, anywhere in a tile, with no snapping. Doubling back
 *    mid-corridor has to be instant or the game feels like it is arguing with you.
 *  - A PERPENDICULAR turn needs the target tile to be open and the player to be within
 *    TURN_TOLERANCE of the centre of the tile they are in. Accepting it snaps the axis
 *    being left onto that centre, which keeps the invariant that the off-axis
 *    coordinate is always exactly a tile centre.
 */
function tryTurn(state: GameState): boolean {
  const p = state.player;
  const wanted = p.wanted;
  if (wanted === NONE || wanted === p.dir) return false;

  if (wanted === opposite(p.dir)) {
    p.dir = wanted;
    return true;
  }

  const along = isVertical(p.dir) ? p.y : p.x;
  if (Math.abs(offsetFromCentre(along)) > TURN_TOLERANCE) return false;

  const col = tileOf(p.x);
  const row = tileOf(p.y);
  if (!isOpenForPlayer(state.grid, col + DX[wanted], row + DY[wanted])) return false;

  // Snap the axis we are leaving; the other axis is already centred.
  if (isVertical(p.dir)) p.y = tileCentre(row);
  else p.x = tileCentre(col);

  p.dir = wanted;
  return true;
}

/** Eat whatever is under the player. Called after every subunit of movement. */
function consume(state: GameState): void {
  const col = tileOf(state.player.x);
  const row = tileOf(state.player.y);
  const t = tileAt(state.grid, col, row);
  if (t !== GRAIN && t !== POWER) return;

  setTile(state.grid, col, row, EMPTY);
  state.grainsRemaining--;
  if (t === POWER) state.powerEaten++;
  else state.grainsEaten++;
}

/**
 * Advance exactly one subunit. Moving a subunit at a time (rather than jumping the
 * whole tick's distance and then resolving) means the player can never tunnel through
 * a wall or skip a grain, at a cost of ~16 trivial iterations per tick.
 */
function stepOneSubunit(state: GameState): void {
  const p = state.player;
  tryTurn(state);

  // A player is only ever committed to entering the next tile once they leave a
  // centre, so the wall test only has to happen AT a centre.
  const along = isVertical(p.dir) ? p.y : p.x;
  if (offsetFromCentre(along) === 0) {
    const col = tileOf(p.x);
    const row = tileOf(p.y);
    if (!isOpenForPlayer(state.grid, col + DX[p.dir], row + DY[p.dir])) {
      p.blocked = true;
      return;
    }
  }

  p.blocked = false;
  p.x += DX[p.dir];
  p.y += DY[p.dir];
  p.distance++;

  // Warp. Only row 14 is open at the edges; every other row is walled there, so this
  // can never trigger elsewhere.
  const span = COLS * SUB;
  if (p.x < 0) p.x += span;
  else if (p.x >= span) p.x -= span;

  consume(state);
}

/** Advance the simulation by one fixed tick. */
export function tick(state: GameState): void {
  const p = state.player;
  p.moveAcc += PLAYER_SPEED;
  const steps = Math.floor(p.moveAcc / SPEED_SCALE);
  p.moveAcc -= steps * SPEED_SCALE;
  for (let i = 0; i < steps; i++) stepOneSubunit(state);
  state.tick++;
}

/** Advance `n` ticks. Used by tests and by the future replay verifier. */
export function advance(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/**
 * Re-run a recorded trace against a fresh game and return the resulting state. This is
 * the whole point of the integer simulation: when the server-side verifier lands it
 * calls exactly this and compares the result against what the client claimed.
 */
export function replay(inputLog: readonly { tick: number; dir: Dir }[], ticks: number): GameState {
  const state = createGame();
  let next = 0;
  for (let t = 0; t < ticks; t++) {
    while (next < inputLog.length && inputLog[next].tick === t) {
      setWanted(state, inputLog[next].dir);
      next++;
    }
    tick(state);
  }
  return state;
}
