/**
 * RICE CHOMP — the simulation.
 *
 * Pure module: no React, no DOM, no node builtins, no clock. The host component converts
 * wall-clock time into whole ticks and calls `tick()`; everything in here is integer
 * arithmetic, so the same inputs at the same tick numbers always produce the same state.
 * See ./types.ts for why that matters.
 *
 * PHASE 3 SCOPE: the four pests, the scatter/chase cycle, the pen, frightened mode,
 * collision, lives and the death animation — plus cornering, which is the other half of
 * the chase. Not here yet: bonus items, cutscenes, audio, touch controls, leaderboard.
 *
 * Every tuning number lives in ./levels.ts. If you find a bare number in this file that
 * a designer might want to change, it is in the wrong place.
 */

import {
  COLS,
  PEST_HOMES,
  PLAYER_SPAWN_COL,
  PLAYER_SPAWN_ROW,
  isOpenForPlayer,
  offsetFromCentre,
  parseMaze,
  setTile,
  tileAt,
  tileCentre,
  tileOf,
  wrapDeltaSub,
} from "./maze";
import {
  BONUS_COL,
  BONUS_DOT_TRIGGERS,
  BONUS_ROW,
  BONUS_SCORE_TICKS,
  BONUS_TICKS,
  CLEAR_TICKS,
  COLLIDE_DIST,
  CUTSCENE_AFTER_LEVELS,
  CUTSCENE_FOR_LEVEL,
  DEATH_PAUSE_TICKS,
  DEATH_TICKS,
  EAT_PEST_FREEZE_TICKS,
  EXTRA_LIFE_SCORE,
  GRAIN_FREEZE_TICKS,
  POWER_FREEZE_TICKS,
  READY_TICKS,
  RESPAWN_READY_TICKS,
  SCORE_GRAIN,
  SCORE_PEST_CHAIN,
  SCORE_POWER,
  STARTING_LIVES,
  bonusForLevel,
  levelTuning,
  type LevelTuning,
} from "./levels";
import {
  CHASE,
  EYES,
  OUT,
  PEN,
  EXITING,
  buildPenRouteField,
  createPests,
  modeAt,
  queueReversal,
  stepPests,
  type Mode,
  type Pest,
} from "./pests";
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
  type Dir,
  type DirOrNone,
} from "./types";

// Re-exported so callers that only want the movement dials do not have to know whether
// they live here or in levels.ts. They live in levels.ts; this is the compatibility seam.
export { PLAYER_SPEED, TURN_TOLERANCE, CORNER_LEAD } from "./levels";

// --- run phases -------------------------------------------------------------

/** Everything is still; the level is about to begin. */
export const READY = 0;
export const PLAYING = 1;
/** Caught. Nothing moves but the death animation. */
export const DYING = 2;
/** Every grain eaten; the maze flashes before the next level. */
export const CLEARED = 3;
export const GAMEOVER = 4;
/**
 * An interstitial is on screen. See the note on `tick()`: this phase consumes NO
 * simulation ticks at all, because a cutscene is presentation and a skippable one would
 * otherwise put a hole in the input trace.
 */
export const CUTSCENE = 5;
export type Phase =
  | typeof READY
  | typeof PLAYING
  | typeof DYING
  | typeof CLEARED
  | typeof GAMEOVER
  | typeof CUTSCENE;

// --- state ------------------------------------------------------------------

export interface Player {
  /** Position in subunits. The axis perpendicular to `dir` is always a tile centre. */
  x: number;
  y: number;
  /** Direction of travel. Never NONE — a stopped player still faces somewhere. */
  dir: Dir;
  /**
   * The direction the player has asked for. Persists until it is satisfied or replaced —
   * hold into a wall and you turn the instant the opening arrives, which is the arcade
   * behaviour and the reason the controls feel telepathic.
   */
  wanted: DirOrNone;
  /** Fractional-speed carry, in speed units. Keeps movement integral. */
  moveAcc: number;
  /** Total subunits travelled. Drives the chomp animation, so it stays deterministic. */
  distance: number;
  /** True when the player is pressed up against a wall and not moving. */
  blocked: boolean;
  /** Ticks of enforced stillness owed to grains already swallowed. See eatFreeze below. */
  freeze: number;
  /** Subunits of corner glide still to run. See cornerGlide. */
  glideSteps: number;
  /** The direction being left during the glide. */
  glideFrom: Dir;
  /** A late turn backs up along glideFrom instead of continuing along it. */
  glideBack: boolean;
}

/**
 * The bonus item. One at a time, twice a level, and it is the only thing on the board
 * that is not on the tile grid — it sits on the boundary between two columns so it is
 * exactly centred, and it is collected by proximity rather than by occupying a tile.
 */
export interface Bonus {
  /** How many have been summoned this level. Indexes BONUS_DOT_TRIGGERS. */
  spawned: number;
  /** How many the player has actually collected this level. */
  taken: number;
  /** Ticks the current item has left on the board; 0 when nothing is showing. */
  ticks: number;
  /** Ticks the collected score stays on screen; 0 when nothing is showing. */
  scoreTicks: number;
  /** What the last collected item was worth, for the floating score. */
  scoreValue: number;
  x: number;
  y: number;
}

export interface GameState {
  grid: Uint8Array;
  /** BFS distance to the pen gate, for eyes. Rebuilt per level; the walls never move. */
  penRoute: Int16Array;
  player: Player;
  pests: Pest[];
  tuning: LevelTuning;

  level: number;
  /**
   * The level this run STARTED on. 1 for every real run; anything else means the run was
   * launched from the debug entry point and is not a score — see isScoreSubmittable().
   */
  startLevel: number;
  phase: Phase;
  /** Ticks left in the current phase, where the phase is timed. */
  phaseTicks: number;
  lives: number;
  score: number;
  extraLifeGiven: boolean;

  /** Current global mode, and how far into the cycle we are. */
  mode: Mode;
  modeElapsed: number;
  modeIndex: number;
  /** Ticks of frightened left. Zero means no power window is open. */
  frightTicks: number;
  /** Pests eaten in the current power window; indexes SCORE_PEST_CHAIN. */
  chain: number;
  /** Everything holds still while an eaten pest's score is on screen. */
  hitFreeze: number;

  /** Grains eaten since the current life began. Drives pen release. */
  dotsThisLife: number;
  /**
   * Grains eaten since the current LEVEL began. Drives the bonus item, and is deliberately
   * a different counter from dotsThisLife: dying should not cost the player an item they
   * had nearly earned.
   */
  dotsThisLevel: number;
  /** Ticks since a pest was last released. The other half of pen release. */
  penTimer: number;

  /** The bonus item currently on the board, if any. */
  bonus: Bonus;
  /** Which interstitial to show, once the phase is CUTSCENE. */
  cutscene: number;

  /** Seeded PRNG state. The only randomness in the engine; see types.ts. */
  rng: number;
  /** Ticks simulated since the run began. The x-axis of the input trace. */
  tick: number;

  grainsEaten: number;
  powerEaten: number;
  grainsRemaining: number;
  pestsEaten: number;
  /**
   * Every direction change, stamped with the tick it took effect on. This IS the input
   * trace: replaying these against a fresh state reproduces the run exactly. Recorded
   * from day one so server-side replay verification is later a server change only.
   */
  inputLog: { tick: number; dir: Dir }[];
}

/** Default PRNG seed. A run may pass its own; the seed is part of the submitted trace. */
export const DEFAULT_SEED = 0x1ce9a17;

function freshPlayer(): Player {
  return {
    // Spawn straddling the boundary between two columns, so the first horizontal input
    // is legal immediately.
    x: PLAYER_SPAWN_COL * SUB,
    y: tileCentre(PLAYER_SPAWN_ROW),
    dir: LEFT,
    wanted: NONE,
    moveAcc: 0,
    distance: 0,
    blocked: false,
    freeze: 0,
    glideSteps: 0,
    glideFrom: LEFT,
    glideBack: false,
  };
}

/**
 * A fresh run. `level` other than 1 is the debug entry point — the tests use it to read
 * the tail of the curve without playing there, and ?level= on /chomp uses it so the curve
 * can be FELT without playing six levels first. Such a run is permanently unrankable; see
 * isScoreSubmittable().
 */
export function createGame(level = 1, seed = DEFAULT_SEED): GameState {
  const { grid, totalGrains, totalPower } = parseMaze();
  const tuning = levelTuning(level);
  return {
    grid,
    penRoute: buildPenRouteField(grid),
    player: freshPlayer(),
    pests: createPests(),
    tuning,
    level,
    startLevel: level,
    phase: READY,
    phaseTicks: READY_TICKS,
    lives: STARTING_LIVES,
    score: 0,
    extraLifeGiven: false,
    mode: modeAt(tuning.modeCycle, 0).mode,
    modeElapsed: 0,
    modeIndex: 0,
    frightTicks: 0,
    chain: 0,
    hitFreeze: 0,
    dotsThisLife: 0,
    dotsThisLevel: 0,
    penTimer: 0,
    bonus: freshBonus(),
    cutscene: 0,
    rng: seed >>> 0,
    tick: 0,
    grainsEaten: 0,
    powerEaten: 0,
    grainsRemaining: totalGrains + totalPower,
    pestsEaten: 0,
    inputLog: [],
  };
}

/**
 * MAY THIS RUN'S SCORE BE SUBMITTED? Phase 7's leaderboard must call this before offering
 * to submit, and the server must apply the same rule to the trace it receives.
 *
 * A run that did not start on level 1 skipped the levels below it, so its score is not
 * comparable with anyone else's. Two independent things stop it counting, which is the
 * point — one guard on a cheat path is not a guard:
 *
 *   1. this flag, carried on the state from createGame() and never cleared (nothing in the
 *      engine writes startLevel after construction, and restarting builds a new state);
 *   2. replay itself. A submitted trace is (seed, inputLog) replayed from level 1 on the
 *      server. A trace recorded from level 7 replays to a different score and fails
 *      verification without anyone having to remember this rule.
 */
export function isScoreSubmittable(state: GameState): boolean {
  return state.startLevel === 1;
}

/**
 * Queue a direction. Cheap and idempotent: re-pressing the direction already wanted does
 * nothing and is not logged, so holding a key does not flood the trace.
 */
export function setWanted(state: GameState, dir: Dir): void {
  if (state.player.wanted === dir) return;
  state.player.wanted = dir;
  state.inputLog.push({ tick: state.tick, dir });
}

/** The tile the player currently occupies. */
export function playerTile(state: GameState): { col: number; row: number } {
  return { col: tileOf(state.player.x), row: tileOf(state.player.y) };
}

// --- cornering --------------------------------------------------------------

/**
 * How far the player is past the centre of its tile ALONG ITS DIRECTION OF TRAVEL, in
 * subunits. Negative before the centre, positive after, regardless of which way they are
 * facing — which is what lets one piece of arithmetic handle all four directions.
 */
function aheadOfCentre(p: Player): number {
  const along = isVertical(p.dir) ? p.y : p.x;
  const sign = isVertical(p.dir) ? DY[p.dir] : DX[p.dir];
  return offsetFromCentre(along) * sign;
}

/**
 * CORNERING — the skill ceiling of the genre, and the reason a player at the same speed
 * as a pest can still pull away.
 *
 * A pest turns only at exact tile centres: it runs to the middle of the junction, stops
 * turning right, and leaves. A player who presses the turn EARLY does not do that. From
 * up to CORNER_LEAD subunits before the centre, the player glides diagonally — advancing
 * on the old axis and the new one on the same subunit — and comes out of the corner
 * having skipped that much path. Press early by a third of a tile and you leave the
 * junction a third of a tile ahead of where the pest behind you will leave it. Four
 * corners of a loop is over a tile of lead, and it compounds.
 *
 * Press LATE and the glide runs the other way: the player backs up along the old axis
 * while advancing on the new one, and pays the distance instead of banking it. Same
 * mechanism, opposite sign. That symmetry is the point — the corner is a thing you can
 * be good or bad at, not a thing that happens to you.
 *
 * The whole glide is contained inside a single tile (both axes travel at most half a
 * tile from its centre), so it can never clip a wall, never skips a grain, and never
 * moves the player into a tile the turn did not check. It ends with the old axis exactly
 * on the centre, restoring the invariant that the off-axis coordinate is always centred.
 */
function beginCornerGlide(p: Player, ahead: number): void {
  p.glideSteps = Math.abs(ahead);
  p.glideFrom = p.dir;
  p.glideBack = ahead > 0;
}

/**
 * Try to apply the buffered direction. Returns true if the direction changed.
 *
 * Three rules, and the differences between them are most of the feel:
 *  - A REVERSAL is always legal, anywhere in a tile, with no glide. Doubling back
 *    mid-corridor has to be instant or the game feels like it is arguing with you.
 *  - A PERPENDICULAR turn taken EARLY — up to CORNER_LEAD before the centre — starts a
 *    corner glide and gains distance.
 *  - A PERPENDICULAR turn taken LATE — up to TURN_TOLERANCE past the centre — is still
 *    accepted, because an input a couple of ticks late should not be thrown away, but it
 *    glides backwards and costs distance.
 */
function tryTurn(state: GameState): boolean {
  const p = state.player;
  const wanted = p.wanted;
  if (p.glideSteps > 0) return false; // committed to the corner already
  if (wanted === NONE || wanted === p.dir) return false;

  if (wanted === opposite(p.dir)) {
    p.dir = wanted;
    return true;
  }

  const ahead = aheadOfCentre(p);
  if (ahead < -state.tuning.cornerLead || ahead > state.tuning.turnTolerance) return false;

  const col = tileOf(p.x);
  const row = tileOf(p.y);
  if (!isOpenForPlayer(state.grid, col + DX[wanted], row + DY[wanted])) return false;

  beginCornerGlide(p, ahead);
  p.dir = wanted;
  return true;
}

// --- eating -----------------------------------------------------------------

/**
 * Eat whatever is under the player. Called after every subunit of movement.
 *
 * Eating costs whole FROZEN TICKS, not a reduced speed. The freeze is the mechanism that
 * lets a pursuer close real distance on a player clearing a fresh corridor, and it is why
 * the chase tightens exactly where the grains are thickest. There is no separate
 * eating-speed dial.
 */
function consume(state: GameState): void {
  const col = tileOf(state.player.x);
  const row = tileOf(state.player.y);
  const t = tileAt(state.grid, col, row);
  if (t !== GRAIN && t !== POWER) return;

  setTile(state.grid, col, row, EMPTY);
  state.grainsRemaining--;
  state.dotsThisLife++;
  state.dotsThisLevel++;

  if (t === POWER) {
    state.powerEaten++;
    state.player.freeze += POWER_FREEZE_TICKS;
    addScore(state, SCORE_POWER);
    startFright(state);
  } else {
    state.grainsEaten++;
    state.player.freeze += GRAIN_FREEZE_TICKS;
    addScore(state, SCORE_GRAIN);
  }
}

// --- the bonus item ---------------------------------------------------------

function freshBonus(): Bonus {
  return {
    spawned: 0,
    taken: 0,
    ticks: 0,
    scoreTicks: 0,
    scoreValue: 0,
    // Straddling the boundary between two columns, so it is exactly centred on the maze
    // the way the player's spawn is.
    x: BONUS_COL * SUB,
    y: tileCentre(BONUS_ROW),
  };
}

/**
 * Summon, expire and collect the bonus item.
 *
 * It appears on a dot count rather than a timer, so it is a reward for clearing rather
 * than a reward for surviving — a player hiding in a corner never sees one. It leaves on a
 * timer, so it is also a decision: the corridor under the pen is the middle of the board
 * and going for it costs position.
 */
function stepBonus(state: GameState): void {
  const b = state.bonus;

  if (b.scoreTicks > 0) b.scoreTicks--;

  if (b.ticks > 0) {
    b.ticks--;
    // Collected by proximity, like a pest, because it does not sit on a tile centre.
    const dx = Math.abs(wrapDeltaSub(b.x, state.player.x));
    const dy = Math.abs(b.y - state.player.y);
    if (dx < COLLIDE_DIST && dy < COLLIDE_DIST) {
      const { value } = bonusForLevel(state.level);
      b.ticks = 0;
      b.taken++;
      b.scoreTicks = BONUS_SCORE_TICKS;
      b.scoreValue = value;
      addScore(state, value);
    }
    return;
  }

  if (b.spawned >= BONUS_DOT_TRIGGERS.length) return;
  if (state.dotsThisLevel < BONUS_DOT_TRIGGERS[b.spawned]) return;
  b.spawned++;
  b.ticks = BONUS_TICKS;
}

function addScore(state: GameState, points: number): void {
  state.score += points;
  if (!state.extraLifeGiven && state.score >= EXTRA_LIFE_SCORE) {
    state.extraLifeGiven = true;
    state.lives++;
  }
}

function startFright(state: GameState): void {
  state.chain = 0;
  const ticks = state.tuning.frightenedTicks;
  if (ticks <= 0) return; // deep levels: golden grains are points, not protection
  state.frightTicks = ticks;
  for (const pest of state.pests) {
    if (pest.state === OUT) {
      pest.frightened = true;
      pest.reverseQueued = true;
    }
  }
}

// --- player movement --------------------------------------------------------

/**
 * Advance exactly one subunit. Moving a subunit at a time (rather than jumping the whole
 * tick's distance and then resolving) means the player can never tunnel through a wall or
 * skip a grain, at a cost of ~16 trivial iterations per tick.
 */
function stepOneSubunit(state: GameState): void {
  const p = state.player;
  tryTurn(state);

  if (p.glideSteps > 0) {
    // Diagonal. New axis forward, old axis toward the centre it left.
    const back = p.glideBack ? -1 : 1;
    p.x += DX[p.dir] + DX[p.glideFrom] * back;
    p.y += DY[p.dir] + DY[p.glideFrom] * back;
    p.glideSteps--;
    p.blocked = false;
    p.distance++;
    consume(state);
    return;
  }

  // A player is only ever committed to entering the next tile once they leave a centre,
  // so the wall test only has to happen AT a centre.
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

  // Warp. Only row 14 is open at the edges; every other row is walled there, so this can
  // never trigger elsewhere.
  const span = COLS * SUB;
  if (p.x < 0) p.x += span;
  else if (p.x >= span) p.x -= span;

  consume(state);
}

function movePlayer(state: GameState): void {
  const p = state.player;
  if (p.freeze > 0) {
    // Frozen mid-chomp. Not moving is the cost; the pests keep coming.
    p.freeze--;
    p.blocked = false;
    return;
  }
  p.moveAcc += state.tuning.playerSpeed;
  const steps = Math.floor(p.moveAcc / SPEED_SCALE);
  p.moveAcc -= steps * SPEED_SCALE;
  // The tick in which a grain is swallowed still completes — the freeze is spent on the
  // NEXT tick, so a grain costs exactly the number of ticks levels.ts says it costs and
  // not that plus whatever was left of this one.
  for (let i = 0; i < steps; i++) stepOneSubunit(state);
}

// --- modes ------------------------------------------------------------------

/**
 * Advance the scatter/chase cycle and reverse everybody on a change.
 *
 * The cycle clock is PAUSED while a power window is open. Otherwise a long frightened
 * phase would silently eat a scatter phase, and the player would be punished for using
 * the item that is supposed to help them.
 */
function advanceMode(state: GameState): void {
  if (state.frightTicks > 0) {
    state.frightTicks--;
    if (state.frightTicks === 0) {
      for (const pest of state.pests) pest.frightened = false;
      state.chain = 0;
    }
    return;
  }

  state.modeElapsed++;
  const next = modeAt(state.tuning.modeCycle, state.modeElapsed);
  if (next.index !== state.modeIndex) {
    state.modeIndex = next.index;
    state.mode = next.mode;
    // Reversing on a mode change is the one exception to "never reverse", and it is what
    // breaks a stable orbit: the pest chasing your tail is suddenly coming the other way.
    queueReversal(state.pests);
  }
}

// --- the pen ----------------------------------------------------------------

/**
 * Release at most one pest per tick, in kind order. Dot counter OR timer, whichever comes
 * first: the counter paces release against how fast the player is clearing, and the timer
 * makes sure a player who stops eating still gets company.
 */
function releaseFromPen(state: GameState): void {
  state.penTimer++;
  for (const pest of state.pests) {
    if (pest.state !== PEN) continue;
    const limit = state.tuning.penDotLimits[pest.kind];
    if (state.dotsThisLife >= limit || state.penTimer >= state.tuning.penTimeoutTicks) {
      pest.state = EXITING;
      pest.penStage = 0;
      state.penTimer = 0;
    }
    // Only ever the first penned pest, so they come out one at a time rather than as a
    // pack. This break IS the stagger.
    break;
  }
}

// --- collision --------------------------------------------------------------

/** Are these two within touching distance? Wrap-aware, so the tunnel is not a safe zone. */
function touching(state: GameState, pest: Pest): boolean {
  const dx = Math.abs(wrapDeltaSub(pest.x, state.player.x));
  const dy = Math.abs(pest.y - state.player.y);
  return dx < COLLIDE_DIST && dy < COLLIDE_DIST;
}

function resolveCollisions(state: GameState): void {
  for (const pest of state.pests) {
    // Eyes are harmless and a penned pest is unreachable; only a pest out in the maze
    // can touch the player either way.
    if (pest.state !== OUT) continue;
    if (!touching(state, pest)) continue;

    if (pest.frightened) {
      pest.frightened = false;
      pest.state = EYES;
      pest.moveAcc = 0;
      state.pestsEaten++;
      const idx = Math.min(state.chain, SCORE_PEST_CHAIN.length - 1);
      addScore(state, SCORE_PEST_CHAIN[idx]);
      state.chain++;
      state.hitFreeze = EAT_PEST_FREEZE_TICKS;
      return;
    }

    state.phase = DYING;
    state.phaseTicks = DEATH_PAUSE_TICKS + DEATH_TICKS;
    state.player.freeze = 0;
    state.player.glideSteps = 0;
    return;
  }
}

// --- life cycle -------------------------------------------------------------

/** Put everyone back on their marks. Used after a death and at the start of a level. */
function resetPositions(state: GameState): void {
  const keptDistance = state.player.distance;
  state.player = freshPlayer();
  state.player.distance = keptDistance;
  state.pests = createPests();
  state.modeElapsed = 0;
  state.modeIndex = 0;
  state.mode = modeAt(state.tuning.modeCycle, 0).mode;
  state.frightTicks = 0;
  state.chain = 0;
  state.hitFreeze = 0;
  state.dotsThisLife = 0;
  state.penTimer = 0;
  // The item on the board goes with the life that was chasing it. The dot counter behind
  // it does not — see Bonus.spawned.
  state.bonus.ticks = 0;
  state.bonus.scoreTicks = 0;
  state.phase = READY;
  // A respawn gets its own hold: the board has just rearranged itself and the player is
  // looking for four pests that were not there a second ago. See RESPAWN_READY_TICKS.
  state.phaseTicks = RESPAWN_READY_TICKS;
}

function nextLevel(state: GameState): void {
  const { grid, totalGrains, totalPower } = parseMaze();
  state.level++;
  state.tuning = levelTuning(state.level);
  state.grid = grid;
  state.penRoute = buildPenRouteField(grid);
  state.grainsRemaining = totalGrains + totalPower;
  // Both of these are per-level, not per-life, so they reset HERE and not in
  // resetPositions() — which also runs after a death.
  state.dotsThisLevel = 0;
  state.bonus = freshBonus();
  resetPositions(state);
}

/**
 * The maze has been cleared. Either an interstitial is due, or the next level starts.
 * `state.level` is still the level that was just finished.
 */
function finishLevel(state: GameState): void {
  const at = CUTSCENE_AFTER_LEVELS.indexOf(state.level);
  if (at >= 0) {
    state.phase = CUTSCENE;
    state.cutscene = CUTSCENE_FOR_LEVEL[at];
    state.phaseTicks = 0;
    return;
  }
  nextLevel(state);
}

/**
 * End the interstitial and start the next level. Called by the host when the cutscene's
 * own animation finishes, when the player skips it, or immediately under reduced motion.
 * Safe to call in any phase; it does nothing unless a cutscene is showing.
 */
export function endCutscene(state: GameState): void {
  if (state.phase !== CUTSCENE) return;
  nextLevel(state);
}

function finishDeath(state: GameState): void {
  state.lives--;
  if (state.lives <= 0) {
    state.lives = 0;
    state.phase = GAMEOVER;
    state.phaseTicks = 0;
    return;
  }
  resetPositions(state);
}

// --- the tick ---------------------------------------------------------------

/**
 * Advance the simulation by one fixed tick.
 *
 * ── WHY CUTSCENE IS A NO-OP ─────────────────────────────────────────────────────
 * An interstitial is presentation, and it is skippable. If it consumed simulation ticks
 * then whether the player pressed skip would shift every later tick number, and the
 * tick-stamped input trace — the thing server-side replay verification is built on —
 * would no longer line up. So the CUTSCENE phase freezes the simulation completely: no
 * tick counter, no timers, nothing. The host runs the cutscene on its own clock and calls
 * endCutscene() when it is done or skipped, and the run resumes exactly where it stopped.
 * Whether the interstitial was watched, skipped, or never drawn at all is invisible to
 * the simulation, which is the property that matters.
 */
export function tick(state: GameState): void {
  if (state.phase === CUTSCENE) return;

  switch (state.phase) {
    case READY:
      if (--state.phaseTicks <= 0) state.phase = PLAYING;
      break;

    case DYING:
      if (--state.phaseTicks <= 0) finishDeath(state);
      break;

    case CLEARED:
      if (--state.phaseTicks <= 0) finishLevel(state);
      break;

    case GAMEOVER:
      break;

    default: {
      if (state.hitFreeze > 0) {
        state.hitFreeze--;
        break;
      }
      advanceMode(state);
      movePlayer(state);
      stepPests(state);
      resolveCollisions(state);
      releaseFromPen(state);
      stepBonus(state);
      if (state.grainsRemaining <= 0 && state.phase === PLAYING) {
        state.phase = CLEARED;
        state.phaseTicks = CLEAR_TICKS;
        // Nothing should be left hanging over a cleared board.
        state.bonus.ticks = 0;
        state.bonus.scoreTicks = 0;
      }
    }
  }
  state.tick++;
}

/**
 * Skip the ready hold and start playing on the next tick. The tests and the kiting bot
 * measure the chase, not the two seconds of anticipation before it.
 */
export function beginPlay(state: GameState): GameState {
  state.phase = PLAYING;
  state.phaseTicks = 0;
  return state;
}

/**
 * Advance `n` ticks. Used by tests and by the future replay verifier.
 *
 * Ends any interstitial on sight. Headless there is nobody to watch one, and a phase that
 * consumes no ticks would otherwise spin here forever — which is also precisely why
 * skipping one cannot desync a replay: neither the watched nor the skipped case moves the
 * clock at all.
 */
export function advance(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    if (state.phase === CUTSCENE) endCutscene(state);
    tick(state);
  }
}

/**
 * Re-run a recorded trace against a fresh game and return the resulting state. This is
 * the whole point of the integer simulation: when the server-side verifier lands it calls
 * exactly this and compares the result against what the client claimed.
 */
export function replay(
  inputLog: readonly { tick: number; dir: Dir }[],
  ticks: number,
  seed = DEFAULT_SEED,
): GameState {
  const state = createGame(1, seed);
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

/** Convenience for the HUD and for tests: is a power window open right now? */
export function isFrightened(state: GameState): boolean {
  return state.frightTicks > 0;
}

/** Where each pest lives when penned. Re-exported so the renderer need not import maze. */
export { PEST_HOMES };
export { CHASE };
