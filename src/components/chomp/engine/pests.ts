/**
 * RICE CHOMP — the four pests.
 *
 * Pure module: no React, no DOM, no clock, no Math.random. Unit-tested in
 * test/chomp-pests.test.ts. game.ts owns the game; this file owns how a pest decides
 * where to go and how it gets there.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────────
 * A pest never plans a route. At every tile centre it looks at the four neighbours,
 * throws away the one behind it and the ones that are walls, and steps into whichever of
 * the rest is nearest ITS OWN TARGET TILE as the crow flies. That is the entire
 * algorithm. Everything that makes the four of them feel like four different animals is
 * in `targetTile()` — one function, four cases, no route-finding anywhere.
 *
 * Consequences worth knowing before "fixing" one of them:
 *   - A pest can walk into a corner it could have avoided. That is correct. Greedy
 *     pursuit is legible; the player can read it and play against it, which is the
 *     entire reason the genre does it this way instead of running A*.
 *   - The distance comparison is WARP-BLIND: it does not know the tunnel joins the two
 *     edges of the maze. A player who exits left while a pest sits on the right is, to
 *     that pest, twenty-six tiles away. That is what makes the tunnel an escape route
 *     rather than a corridor with extra steps, and it is deliberate.
 *   - Distances are compared SQUARED. The square root is monotonic, so it changes no
 *     decision, and skipping it keeps the whole AI in integer arithmetic.
 *
 * The one exception to greedy targeting is a pair of eyes returning to the pen, which
 * follows a precomputed breadth-first distance field instead. Greedy pursuit of a fixed
 * point can stall in a local minimum, and an eye that never gets home is a pest that
 * never comes back.
 */

import {
  COLS,
  PEN_ENTRY_COL,
  PEN_ENTRY_ROW,
  PEN_LANE_COL,
  PEN_LANE_ROW,
  PEST_HOMES,
  ROWS,
  TUNNEL_ROW,
  isOpenForPest,
  offsetFromCentre,
  tileCentre,
  tileOf,
  wrapCol,
} from "./maze";
import {
  LOCUST,
  LOCUST_SHY_RANGE_SQ,
  PEN_BOB_AMPLITUDE,
  PEN_BOB_SPEED,
  PEN_SPEED,
  PEST_COUNT,
  RAT,
  SCATTER_CORNERS,
  SPARROW,
  SPARROW_LEAD,
  WEEVIL,
  WEEVIL_PIVOT,
  type LevelTuning,
  type PestKind,
} from "./levels";
import {
  DOWN,
  DX,
  DY,
  LEFT,
  RIGHT,
  SPEED_SCALE,
  SUB,
  UP,
  opposite,
  rngBelow,
  rngNext,
  type Dir,
} from "./types";

// --- modes ------------------------------------------------------------------

/** The global mode cycle. Frightened is per-pest, not a global mode — see Pest.frightened. */
export const SCATTER = 0;
export const CHASE = 1;
export type Mode = typeof SCATTER | typeof CHASE;

// --- per-pest state machine -------------------------------------------------

/** Bobbing in the pen, waiting for its dot count or the timer. */
export const PEN = 0;
/** Shuffling out through the gate. */
export const EXITING = 1;
/** Out in the maze, hunting (or fleeing, if `frightened`). */
export const OUT = 2;
/** Eaten. A pair of eyes routing back to the pen at speed. */
export const EYES = 3;
/** Eyes that have reached the gate and are descending to their home spot. */
export const ENTERING = 4;
export type PestState = typeof PEN | typeof EXITING | typeof OUT | typeof EYES | typeof ENTERING;

export interface Pest {
  kind: PestKind;
  /** Position in subunits. The axis perpendicular to `dir` is always a tile centre. */
  x: number;
  y: number;
  dir: Dir;
  state: PestState;
  /** Fractional-speed carry, in speed units. Keeps movement integral. */
  moveAcc: number;
  /**
   * Frightened is per-pest, not global: a pest eaten during a power window comes back as
   * itself and hunts again while its siblings are still running away.
   */
  frightened: boolean;
  /** Bob direction inside the pen. Cosmetic, but part of the simulation so it replays. */
  bobUp: boolean;
  /** Set on a mode change; consumed at the next opportunity. */
  reverseQueued: boolean;
  /**
   * Which leg of the pen route the pest is on. EXITING and ENTERING are multi-leg moves
   * (level off, slide to the lane, rise through the gate) and the stage has to be REMEMBERED
   * rather than re-derived from the position each subunit. Re-deriving it is a trap: the
   * moment the pest starts rising it is no longer on the lane row, so a position test says
   * "leg one is not finished" and shoves it back down, forever.
   */
  penStage: number;
}

export function createPest(kind: PestKind): Pest {
  const home = PEST_HOMES[kind];
  return {
    kind,
    x: tileCentre(home.col),
    y: tileCentre(home.row),
    dir: kind === RAT ? LEFT : UP,
    state: home.inPen ? PEN : OUT,
    moveAcc: 0,
    frightened: false,
    bobUp: kind % 2 === 0,
    reverseQueued: false,
    penStage: 0,
  };
}

export function createPests(): Pest[] {
  const out: Pest[] = [];
  for (let i = 0; i < PEST_COUNT; i++) out.push(createPest(i as PestKind));
  return out;
}

export function pestTile(pest: Pest): { col: number; row: number } {
  return { col: tileOf(pest.x), row: tileOf(pest.y) };
}

// --- the mode cycle ---------------------------------------------------------

/**
 * Which mode the cycle is in after `elapsed` ticks. The cycle alternates starting with
 * scatter, and its final entry is long enough to outlast any level — so a player who
 * survives deep into a level stops getting scatter reprieves, which is the intended
 * pressure curve rather than an oversight.
 *
 * `elapsed` counts ticks in which the pests were actually hunting: it is paused during
 * death, the ready hold and power windows, so a power window does not silently burn a
 * scatter phase.
 */
export function modeAt(cycle: readonly number[], elapsed: number): { mode: Mode; index: number } {
  let t = elapsed;
  for (let i = 0; i < cycle.length; i++) {
    if (t < cycle[i]) return { mode: (i % 2 === 0 ? SCATTER : CHASE) as Mode, index: i };
    t -= cycle[i];
  }
  return { mode: CHASE, index: cycle.length };
}

// --- targeting --------------------------------------------------------------

export interface TargetContext {
  /** The tile the player is standing in, and the direction they are facing. */
  playerCol: number;
  playerRow: number;
  playerDir: Dir;
  /** The Rat's tile. The Weevil's whole personality is a function of this. */
  ratCol: number;
  ratRow: number;
  /** The asking pest's own tile. Only the Locust cares. */
  pestCol: number;
  pestRow: number;
}

/**
 * Where a pest wants to be, in tiles. May be off the board — an unreachable target is
 * fine and often the point, because "head towards there" is all the junction rule needs.
 *
 *   Rat     — direct pursuit. The player's tile, no cleverness. It is the one you can
 *             always predict, and the one that punishes standing still.
 *   Sparrow — ambush. Four tiles ahead of the player's facing, so it goes where the
 *             player is GOING. On a loop the short way to a point ahead of the player is
 *             usually round the other side, which is why the Sparrow is the pest that
 *             breaks a kite: it arrives head-on rather than joining the tail.
 *   Weevil  — flanking vector. Take the point two tiles ahead of the player, then double
 *             the vector reaching it from the Rat. It swings wide when the Rat is far
 *             and pinches tight when the Rat is close, so the two of them together cover
 *             both ends of a corridor without either of them being told to.
 *   Locust  — skittish. Chases directly while it is more than eight tiles away and bolts
 *             for its own corner once it gets close, so it is forever wandering into and
 *             out of the fight instead of committing.
 */
export function targetTile(
  kind: PestKind,
  mode: Mode,
  ctx: TargetContext,
): { col: number; row: number } {
  if (mode === SCATTER) return SCATTER_CORNERS[kind];

  switch (kind) {
    case RAT:
      return { col: ctx.playerCol, row: ctx.playerRow };

    case SPARROW:
      return {
        col: ctx.playerCol + DX[ctx.playerDir] * SPARROW_LEAD,
        row: ctx.playerRow + DY[ctx.playerDir] * SPARROW_LEAD,
      };

    case WEEVIL: {
      const pivotCol = ctx.playerCol + DX[ctx.playerDir] * WEEVIL_PIVOT;
      const pivotRow = ctx.playerRow + DY[ctx.playerDir] * WEEVIL_PIVOT;
      return { col: 2 * pivotCol - ctx.ratCol, row: 2 * pivotRow - ctx.ratRow };
    }

    case LOCUST:
    default: {
      const dc = ctx.pestCol - ctx.playerCol;
      const dr = ctx.pestRow - ctx.playerRow;
      if (dc * dc + dr * dr > LOCUST_SHY_RANGE_SQ) {
        return { col: ctx.playerCol, row: ctx.playerRow };
      }
      return SCATTER_CORNERS[LOCUST];
    }
  }
}

// --- the junction rule ------------------------------------------------------

/**
 * The tiebreak order, and it is not arbitrary: when two directions are exactly equally
 * good the pest prefers up, then left, then down, then right. Every pest shares it, which
 * is why they bunch up in predictable ways on open ground and why an experienced player
 * can herd them.
 */
const TIEBREAK: readonly Dir[] = [UP, LEFT, DOWN, RIGHT];

export interface ChoiceOptions {
  /** Reversing is illegal except on a mode change. */
  allowReverse?: boolean;
  /** Only a pest leaving or returning may path through the pen. */
  allowPen?: boolean;
}

/**
 * Choose the direction out of (col,row) that minimises straight-line distance to the
 * target, honouring the no-reversing rule and the tiebreak order.
 *
 * Returns the current direction if nothing is legal, which the maze guarantees never
 * happens (no dead ends) — but the engine must not depend on a maze property to avoid
 * returning undefined.
 */
export function chooseDirection(
  grid: Uint8Array,
  col: number,
  row: number,
  dir: Dir,
  target: { col: number; row: number },
  opts: ChoiceOptions = {},
): Dir {
  const back = opposite(dir);
  const allowPen = opts.allowPen === true;
  let best: Dir | null = null;
  let bestDist = Infinity;

  for (const d of TIEBREAK) {
    if (d === back && opts.allowReverse !== true) continue;
    const nc = col + DX[d];
    const nr = row + DY[d];
    if (!isOpenForPest(grid, nc, nr, allowPen)) continue;
    // Warp-blind and squared. See the header note — both are deliberate.
    const dc = wrapCol(nc) - target.col;
    const dr = nr - target.row;
    const dist = dc * dc + dr * dr;
    // Strictly less, so the first direction in TIEBREAK order wins a tie.
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }

  if (best !== null) return best;
  // Everything but the way we came is blocked. Turn around rather than stop dead.
  return isOpenForPest(grid, col + DX[back], row + DY[back], allowPen) ? back : dir;
}

/**
 * A frightened pest picks at random from the legal directions rather than aiming at
 * anything — it is running, not thinking. Returns the direction and the advanced seed,
 * because the caller owns the RNG state (the engine has no ambient randomness).
 */
export function chooseFrightened(
  grid: Uint8Array,
  col: number,
  row: number,
  dir: Dir,
  seed: number,
): { dir: Dir; seed: number } {
  const back = opposite(dir);
  const legal: Dir[] = [];
  for (const d of TIEBREAK) {
    if (d === back) continue;
    if (!isOpenForPest(grid, col + DX[d], row + DY[d], false)) continue;
    legal.push(d);
  }
  const next = rngNext(seed);
  if (legal.length === 0) return { dir: back, seed: next };
  return { dir: legal[rngBelow(next, legal.length)], seed: next };
}

// --- routing eyes home ------------------------------------------------------

/**
 * Breadth-first distance, in tiles, from every pest-walkable tile to the tile above the
 * pen gate. Built once per maze at boot; the walls never move, so nothing invalidates it.
 * Unreachable tiles hold -1.
 *
 * Eyes follow this instead of greedy targeting because greedy pursuit of a FIXED point
 * can sit in a local minimum forever, and unlike a chase there is no player movement to
 * shake it loose.
 */
export function buildPenRouteField(grid: Uint8Array): Int16Array {
  const dist = new Int16Array(COLS * ROWS).fill(-1);
  const queue = new Int32Array(COLS * ROWS);
  let head = 0;
  let tail = 0;

  const start = PEN_ENTRY_ROW * COLS + PEN_ENTRY_COL;
  dist[start] = 0;
  queue[tail++] = start;

  while (head < tail) {
    const idx = queue[head++];
    const c = idx % COLS;
    const r = (idx - c) / COLS;
    for (const d of TIEBREAK) {
      const nc = wrapCol(c + DX[d]);
      const nr = r + DY[d];
      if (nr < 0 || nr >= ROWS) continue;
      // Pen-blind on purpose: eyes route to the gate, then descend under their own
      // state machine, so the field never needs to model the inside of the pen.
      if (!isOpenForPest(grid, nc, nr, false)) continue;
      const nIdx = nr * COLS + nc;
      if (dist[nIdx] !== -1) continue;
      dist[nIdx] = dist[idx] + 1;
      queue[tail++] = nIdx;
    }
  }
  return dist;
}

/** Step downhill on the route field. Reversing is allowed — eyes are not hunting. */
export function chooseHomeward(
  grid: Uint8Array,
  field: Int16Array,
  col: number,
  row: number,
  dir: Dir,
): Dir {
  let best: Dir = dir;
  let bestDist = Infinity;
  for (const d of TIEBREAK) {
    const nc = wrapCol(col + DX[d]);
    const nr = row + DY[d];
    if (nr < 0 || nr >= ROWS) continue;
    if (!isOpenForPest(grid, nc, nr, false)) continue;
    const v = field[nr * COLS + nc];
    if (v < 0) continue;
    if (v < bestDist) {
      bestDist = v;
      best = d;
    }
  }
  return best;
}

// --- movement ---------------------------------------------------------------

/**
 * Everything a pest needs to know about the world to take a step. GameState satisfies
 * this structurally, so game.ts passes itself in and there is no circular import.
 */
export interface PestWorld {
  grid: Uint8Array;
  penRoute: Int16Array;
  mode: Mode;
  rng: number;
  tuning: LevelTuning;
  player: { x: number; y: number; dir: Dir };
  pests: Pest[];
}

/** Is this tile inside the warp tunnel, where pests are slowed? */
function inTunnel(col: number, row: number): boolean {
  return row === TUNNEL_ROW && (col <= 5 || col >= 22);
}

/** Speed for a pest this tick, in speed units. */
function speedOf(world: PestWorld, pest: Pest): number {
  const t = world.tuning;
  if (pest.state === EYES) return t.eyesSpeed;
  if (pest.state === PEN || pest.state === EXITING || pest.state === ENTERING) return PEN_SPEED;
  if (pest.frightened) return t.pestFrightSpeed;
  const { col, row } = pestTile(pest);
  return inTunnel(col, row) ? t.pestTunnelSpeed : t.pestSpeed;
}

/** Build the targeting context once per tick, since every pest reads the same player. */
export function targetContext(world: PestWorld): TargetContext {
  const rat = world.pests[RAT];
  return {
    playerCol: tileOf(world.player.x),
    playerRow: tileOf(world.player.y),
    playerDir: world.player.dir,
    ratCol: tileOf(rat.x),
    ratRow: tileOf(rat.y),
    pestCol: 0,
    pestRow: 0,
  };
}

/**
 * Decide where to go next. Called only when the pest is exactly on a tile centre — a
 * pest, unlike the player, NEVER turns between centres. That asymmetry is the whole
 * reason cornering earns the player distance.
 */
function decide(world: PestWorld, pest: Pest, ctx: TargetContext): void {
  const col = tileOf(pest.x);
  const row = tileOf(pest.y);

  if (pest.state === EYES) {
    pest.dir = chooseHomeward(world.grid, world.penRoute, col, row, pest.dir);
    return;
  }

  if (pest.frightened) {
    const r = chooseFrightened(world.grid, col, row, pest.dir, world.rng);
    world.rng = r.seed;
    pest.dir = r.dir;
    return;
  }

  ctx.pestCol = col;
  ctx.pestRow = row;
  const target = targetTile(pest.kind, world.mode, ctx);
  pest.dir = chooseDirection(world.grid, col, row, pest.dir, target, {});
}

/** Move toward a subunit coordinate on one axis. Returns true once it has arrived. */
function glideTo(pest: Pest, axis: "x" | "y", goal: number, step: number): boolean {
  const cur = pest[axis];
  if (cur === goal) return true;
  const delta = goal - cur;
  const move = Math.min(Math.abs(delta), step) * Math.sign(delta);
  pest[axis] = cur + move;
  if (axis === "x") pest.dir = move > 0 ? RIGHT : LEFT;
  else pest.dir = move > 0 ? DOWN : UP;
  return pest[axis] === goal;
}

/**
 * One subunit of pest movement. Mirrors the player's stepper: moving a subunit at a time
 * means a pest can never tunnel through a wall or overshoot a decision point, whatever
 * the level speed is.
 */
function stepOneSubunit(world: PestWorld, pest: Pest, ctx: TargetContext): void {
  switch (pest.state) {
    case PEN: {
      // Bob in place. Deterministic, so it replays; cosmetic, so it changes nothing else.
      const home = tileCentre(PEST_HOMES[pest.kind].row);
      const top = home - PEN_BOB_AMPLITUDE;
      const bottom = home + PEN_BOB_AMPLITUDE;
      pest.y += pest.bobUp ? -PEN_BOB_SPEED : PEN_BOB_SPEED;
      pest.dir = pest.bobUp ? UP : DOWN;
      if (pest.y <= top) pest.bobUp = false;
      else if (pest.y >= bottom) pest.bobUp = true;
      return;
    }

    case EXITING: {
      // Three legs, in order: level off the bob, slide to the lane, rise through the gate.
      if (pest.penStage === 0) {
        if (glideTo(pest, "y", tileCentre(PEN_LANE_ROW), 1)) pest.penStage = 1;
        return;
      }
      if (pest.penStage === 1) {
        if (glideTo(pest, "x", tileCentre(PEN_LANE_COL), 1)) pest.penStage = 2;
        return;
      }
      if (!glideTo(pest, "y", tileCentre(PEN_ENTRY_ROW), 1)) return;
      pest.state = OUT;
      pest.penStage = 0;
      // Emerging pests turn along the corridor above the pen rather than carrying on
      // upward into it, so the first thing they do is commit to a side.
      pest.dir = pest.kind % 2 === 0 ? LEFT : RIGHT;
      pest.moveAcc = 0;
      return;
    }

    case ENTERING: {
      if (pest.penStage === 0) {
        if (glideTo(pest, "y", tileCentre(PEN_LANE_ROW), 1)) pest.penStage = 1;
        return;
      }
      const home = PEST_HOMES[pest.kind];
      if (!glideTo(pest, "x", tileCentre(home.col), 1)) return;
      pest.state = PEN;
      pest.penStage = 0;
      pest.frightened = false;
      pest.bobUp = true;
      return;
    }

    default: {
      // OUT and EYES both walk the maze proper.
      const atCentreOfTravel = offsetFromCentre(pest.dir === UP || pest.dir === DOWN ? pest.y : pest.x) === 0;
      const offAxisCentred = offsetFromCentre(pest.dir === UP || pest.dir === DOWN ? pest.x : pest.y) === 0;
      if (atCentreOfTravel && offAxisCentred) {
        const col = tileOf(pest.x);
        const row = tileOf(pest.y);
        if (pest.state === EYES && col === PEN_ENTRY_COL && row === PEN_ENTRY_ROW) {
          pest.state = ENTERING;
          pest.penStage = 0;
          pest.dir = DOWN;
          return;
        }
        decide(world, pest, ctx);
        // A decision can only ever pick an open neighbour, so no wall test is needed
        // here — but a pest that somehow faces a wall must not walk into it.
        if (!isOpenForPest(world.grid, col + DX[pest.dir], row + DY[pest.dir], pest.state === EYES)) {
          return;
        }
      }

      pest.x += DX[pest.dir];
      pest.y += DY[pest.dir];

      const span = COLS * SUB;
      if (pest.x < 0) pest.x += span;
      else if (pest.x >= span) pest.x -= span;
    }
  }
}

/** Advance every pest by one tick. */
export function stepPests(world: PestWorld): void {
  // A world with no pests is a legitimate configuration — it is how the movement tests
  // isolate the player — and targetContext would read pests[RAT] off the end of it.
  if (world.pests.length === 0) return;
  const ctx = targetContext(world);
  for (const pest of world.pests) {
    if (pest.reverseQueued) {
      pest.reverseQueued = false;
      // Reversing mid-tile is safe: the off-axis coordinate is always a tile centre, so
      // the pest is only ever retracing a path it has already walked.
      if (pest.state === OUT) pest.dir = opposite(pest.dir);
    }
    pest.moveAcc += speedOf(world, pest);
    const steps = Math.floor(pest.moveAcc / SPEED_SCALE);
    pest.moveAcc -= steps * SPEED_SCALE;
    for (let i = 0; i < steps; i++) stepOneSubunit(world, pest, ctx);
  }
}

/** Tell every pest out in the maze to turn around. Called on a mode change. */
export function queueReversal(pests: readonly Pest[]): void {
  for (const pest of pests) {
    if (pest.state === OUT) pest.reverseQueued = true;
  }
}
