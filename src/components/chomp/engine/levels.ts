/**
 * RICE CHOMP — every tuning number in the game.
 *
 * Pure module: no React, no DOM, no clock. The spec's rule is absolute — "Every tuning
 * number — speeds, timers, mode durations, score values, and the per-grain eating freeze
 * — lives in levels.ts. No magic numbers in engine code." If you are about to type a
 * number into game.ts, pests.ts or render.ts that a designer might one day want to
 * change, it belongs here instead.
 *
 * Two constants that predate this file (PLAYER_SPEED and TURN_TOLERANCE, which Phase 2
 * kept in game.ts because levels.ts did not exist yet) have moved here as well.
 *
 * ── UNITS ───────────────────────────────────────────────────────────────────────
 * Speeds are authored in tiles/second and converted once, at module load, by
 * tilesPerSecond(). Durations are authored in seconds and converted by secondsToTicks().
 * Distances are in subunits (SUB = 120 per tile). Everything the simulation reads is an
 * integer, because the simulation is replayed server-side and floats do not replay.
 */

import { SUB, TICK_HZ, tilesPerSecond } from "./types";

/** Whole ticks for a duration in seconds. Rounds, so 0.5s is 30 ticks exactly. */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

// --- movement feel ----------------------------------------------------------
// These do not vary by level: they are how the game controls, not how hard it is.

/**
 * How far past a tile centre a perpendicular turn is still accepted, in subunits.
 * A quarter tile. This is LATE-turn forgiveness only — it exists so a turn keyed a
 * couple of ticks after the junction still takes.
 *
 * It is deliberately NOT the cornering dial. Widening this to make cornering feel
 * better would just make late inputs sloppier; see CORNER_LEAD.
 */
export const TURN_TOLERANCE = 30;

/**
 * CORNERING. How far BEFORE a tile centre a perpendicular turn may begin, in subunits.
 * A third of a tile.
 *
 * This is the skill ceiling of the genre and it is a separate dial from TURN_TOLERANCE
 * on purpose. A turn accepted this far early does not wait for the centre and then turn
 * — the player glides diagonally through the corner, advancing on BOTH axes at once,
 * and arrives on the new axis having skipped up to CORNER_LEAD subunits of path. Pests
 * cannot do this: they turn only at exact tile centres. So every corner a player takes
 * early buys real distance on a pursuer, and a player who turns late pays it back (the
 * glide runs the other way — see cornerGlide in game.ts).
 *
 * Sized by eye against the sprite: a third of a tile is enough to be worth chasing —
 * four corners of a loop is more than a whole tile of lead — while keeping the visible
 * clip into the wall corner smaller than the player's own outline.
 */
export const CORNER_LEAD = 40;

/**
 * How close two entities' centres must be to count as a collision, per axis, in
 * subunits. Half a tile: the sprites are about 0.9 tiles wide, so at this range they
 * are visibly overlapping and nobody feels robbed.
 */
export const COLLIDE_DIST = SUB / 2;

// --- eating -----------------------------------------------------------------

/**
 * The chomp freeze. Eating costs whole frozen ticks, not a reduced speed — this is the
 * mechanism that lets a pursuer close real distance on a player clearing a fresh
 * corridor, and it is why chases tighten where the grains are thickest.
 *
 * At the base speed the player crosses a tile in 7.5 ticks, so one frozen tick per
 * grain is a ~12% tax through dense corridor and none at all through cleared corridor.
 * There is no separate eating-speed dial; this is it.
 */
export const GRAIN_FREEZE_TICKS = 1;
export const POWER_FREEZE_TICKS = 3;

// --- scoring ----------------------------------------------------------------

export const SCORE_GRAIN = 10;
export const SCORE_POWER = 50;
/** Pest chain within a single power window. Resets when the window closes. */
export const SCORE_PEST_CHAIN: readonly number[] = [200, 400, 800, 1600];

export const STARTING_LIVES = 3;
export const EXTRA_LIFE_SCORE = 10_000;

// --- phase timings ----------------------------------------------------------

/** "Ready" hold at the start of a life, before anything moves. */
export const READY_TICKS = secondsToTicks(2);
/** Everything stops for a beat when the player is caught, before the death animation. */
export const DEATH_PAUSE_TICKS = secondsToTicks(0.5);
/** Length of the death animation itself. */
export const DEATH_TICKS = secondsToTicks(1.5);
/** Both sides freeze while an eaten pest's score is on screen. */
export const EAT_PEST_FREEZE_TICKS = secondsToTicks(0.5);

// --- clearing a level -------------------------------------------------------

/**
 * The maze flash. A beat of stillness with the pests gone, then the walls strobe.
 *
 * Split into a hold and a strobe rather than one blob of time because they do different
 * jobs: the hold is the full stop that tells you the level is over, the strobe is the
 * reward. Under `prefers-reduced-motion` the strobe is not drawn and the hold covers the
 * whole phase — the simulation is unchanged either way, so a reduced-motion run and a
 * normal run stay tick-for-tick identical.
 */
export const CLEAR_HOLD_TICKS = secondsToTicks(0.6);
export const CLEAR_FLASHES = 4;
export const CLEAR_FLASH_TICKS = secondsToTicks(0.35);
/** Total length of the CLEARED phase. */
export const CLEAR_TICKS = CLEAR_HOLD_TICKS + CLEAR_FLASHES * CLEAR_FLASH_TICKS;

// --- cutscenes --------------------------------------------------------------

/**
 * Levels that are followed by an interstitial. Indexed by the level just COMPLETED, so
 * finishing level 2 plays the first and finishing level 5 plays the second.
 */
export const CUTSCENE_AFTER_LEVELS: readonly number[] = [2, 5];

/** Which beat plays after each of those levels, in the same order. */
export const CUTSCENE_STEAL = 0;
export const CUTSCENE_REVENGE = 1;
export const CUTSCENE_FOR_LEVEL: readonly number[] = [CUTSCENE_STEAL, CUTSCENE_REVENGE];

/**
 * Length of a cutscene, in ticks. The spec caps them at four seconds; three and a half
 * leaves room to be under it rather than exactly on it.
 *
 * Cutscenes consume NO simulation ticks — see the CUTSCENE phase in game.ts. This clock
 * belongs to the host's animation, not to the run.
 */
export const CUTSCENE_TICKS = secondsToTicks(3.5);

// --- bonus items ------------------------------------------------------------

export const SOY = 0;
export const CHOPSTICKS = 1;
export const NORI = 2;
export const SAKE = 3;
export const CHILI = 4;
export const SESAME = 5;
export type BonusKind =
  | typeof SOY
  | typeof CHOPSTICKS
  | typeof NORI
  | typeof SAKE
  | typeof CHILI
  | typeof SESAME;
export const BONUS_KIND_COUNT = 6;

/**
 * Which item a level shows, and what it is worth.
 *
 * The order is the spec's own list — soy sauce, chopsticks, nori, sake cup, chili, sesame
 * — used as the level sequence, with the value escalating as the levels do. A single
 * sesame seed ending up as the rarest and most valuable prize in a game about one grain of
 * rice is the joke, not an oversight. Levels past the end of the table clamp to the last
 * row, so level 99 still shows something.
 */
export const BONUS_BY_LEVEL: readonly { kind: BonusKind; value: number }[] = [
  { kind: SOY, value: 100 }, //         1
  { kind: CHOPSTICKS, value: 200 }, //  2
  { kind: NORI, value: 500 }, //        3
  { kind: NORI, value: 500 }, //        4
  { kind: SAKE, value: 700 }, //        5
  { kind: SAKE, value: 700 }, //        6
  { kind: CHILI, value: 1000 }, //      7
  { kind: CHILI, value: 1000 }, //      8
  { kind: SESAME, value: 2000 }, //     9
  { kind: SESAME, value: 2000 }, //    10
  { kind: SESAME, value: 3000 }, //    11+
];

/**
 * Grains eaten THIS LEVEL that summon each of the two bonus items. The maze holds 286
 * collectables, so these land at roughly a quarter and three fifths of the way through —
 * far enough apart that the second is a reason to keep clearing rather than a second
 * helping of the first.
 *
 * Counted per level and not per life: dying should not cost the player an item they had
 * already almost earned.
 */
export const BONUS_DOT_TRIGGERS: readonly number[] = [70, 170];

/** How long an uncollected bonus item stays on the board. */
export const BONUS_TICKS = secondsToTicks(9);

/** How long the score for a collected item hangs in the air. */
export const BONUS_SCORE_TICKS = secondsToTicks(1.5);

/** Where the item appears: dead centre horizontally, on the corridor under the pen. */
export const BONUS_COL = 14;
export const BONUS_ROW = 18;

/** Bonus for a level, clamped past the end of the table. */
export function bonusForLevel(level: number): { kind: BonusKind; value: number } {
  return pick(BONUS_BY_LEVEL, Math.max(1, Math.floor(level)) - 1);
}

// --- the pests --------------------------------------------------------------

/** Index order is fixed and load-bearing: it is the pen release order. */
export const RAT = 0;
export const SPARROW = 1;
export const WEEVIL = 2;
export const LOCUST = 3;
export type PestKind = typeof RAT | typeof SPARROW | typeof WEEVIL | typeof LOCUST;
export const PEST_COUNT = 4;

/**
 * Scatter corners, in tiles. Each pest owns one, so scatter breaks up any stable orbit
 * by pulling the four of them to four different places and then re-entering the maze
 * from four different directions.
 *
 * All four are real corridor tiles rather than off-board points: the maze's corners are
 * open loops, so a pest that reaches its corner circles it instead of jamming into a
 * wall, which is the behaviour we want and one fewer special case.
 */
export const SCATTER_CORNERS: readonly { col: number; row: number }[] = [
  { col: 26, row: 1 }, // Rat     — top right
  { col: 1, row: 1 }, //  Sparrow — top left
  { col: 26, row: 29 }, // Weevil — bottom right
  { col: 1, row: 29 }, //  Locust — bottom left
];

/** How far ahead of the player the Sparrow aims, in tiles. */
export const SPARROW_LEAD = 4;
/** How far ahead of the player the Weevil's pivot sits, in tiles. */
export const WEEVIL_PIVOT = 2;
/** Inside this range the Locust loses its nerve and runs for its corner. Tiles. */
export const LOCUST_SHY_RANGE = 8;
/** Squared, because the AI never takes a square root. */
export const LOCUST_SHY_RANGE_SQ = LOCUST_SHY_RANGE * LOCUST_SHY_RANGE;

// --- the pen ----------------------------------------------------------------

/** Vertical bob of a penned pest, in subunits either side of its home row. */
export const PEN_BOB_AMPLITUDE = 10;
/** Subunits of bob travel per tick. */
export const PEN_BOB_SPEED = 1;
/** Speed of the shuffle out of the pen and of eyes descending back into it. */
export const PEN_SPEED = tilesPerSecond(4);

// --- per-level tuning -------------------------------------------------------

export interface LevelTuning {
  /** Player speed on open path, in speed units. */
  playerSpeed: number;
  /**
   * The two movement-feel dials, carried per level so they can be varied and, more
   * usefully, so a test can set cornerLead to 0 and measure exactly what cornering is
   * worth by playing the same game twice. They do not currently change with the level.
   */
  cornerLead: number;
  turnTolerance: number;
  /** Pest speed in chase and scatter. */
  pestSpeed: number;
  /** Pest speed inside the warp tunnel. Slower — the tunnel is an escape route. */
  pestTunnelSpeed: number;
  /** Pest speed while frightened. */
  pestFrightSpeed: number;
  /** Speed of a pair of eyes routing home. Fast, so a kill is not a free rest. */
  eyesSpeed: number;
  /** How long a golden grain frightens for. Zero means golden grains no longer scare. */
  frightenedTicks: number;
  /**
   * Alternating scatter/chase durations in ticks, starting with SCATTER. The last entry
   * is effectively forever — once the cycle is exhausted the pests stay in chase.
   */
  modeCycle: readonly number[];
  /** Grains that must be eaten this life before each pest leaves the pen. */
  penDotLimits: readonly number[];
  /** A penned pest leaves anyway if this long passes with nobody released. */
  penTimeoutTicks: number;
}

/**
 * Player speed is flat across levels and the pests ramp past it. That is the difficulty
 * curve: the only way to gain ground on a faster pest is cornering. Making the player
 * faster instead would flatten the skill expression the corner glide exists to create.
 */
const PLAYER_TILES_PER_SEC = 8;

/**
 * THE CROSSOVER. The level at which a pest on open path first matches the player's
 * straight-line speed. Parity here; strictly faster from the level after.
 *
 * ── THIS IS A BIGGER LEVER THAN IT LOOKS ────────────────────────────────────────
 * The reference game never lets a pursuer exceed the player's open-corridor speed: the
 * pressure comes from the eating freeze and the shrinking frightened window, so a player
 * who plays perfectly can always out-run one in a straight line. Past the crossover that
 * stops being true here — a straight corridor is no longer an escape, and CORNERING
 * becomes the player's only remaining resource.
 *
 * That is a deliberate choice, not an oversight, and the loop maths says it holds: see
 * "cornering survives the speed curve" in test/chomp-levels.test.ts, which proves a
 * perfect player keeps the tight loops at every level in the table. But it holds for a
 * PERFECT player, so if levels 7+ read as unfair rather than hard, PEST_RATIO_CAP below
 * is the one edit that reverts it.
 */
export const PEST_CROSSOVER_LEVEL = 7;

/**
 * Top of the speed table as a multiple of player speed: 6.25% faster. Asserted against
 * the table in the level tests, so the two cannot drift apart silently.
 *
 * The size of this number is load-bearing. It sits ~0.2% under the ratio at which perfect
 * cornering stops holding the 22-tile spawn loop (break-even 1.065) — margin that thin is
 * luck unless it is asserted, which is why the test asserts it.
 */
export const PEST_TOP_RATIO = 1.0625;

/**
 * THE REVERT LEVER. Hard ceiling on pest speed as a multiple of player speed, applied
 * after the table lookup.
 *
 * At PEST_TOP_RATIO it changes nothing — the table already tops out there. Set it below 1
 * (0.98, say) and the curve becomes strictly-slower-pests in the reference game's mould:
 * every entry above the ceiling flattens onto it, every entry below is untouched, and the
 * shape of the early levels is preserved exactly. One number, no table surgery.
 */
const PEST_RATIO_CAP = PEST_TOP_RATIO;

/**
 * Pest speed by level, tiles/second. Index 0 is level 1; later levels clamp to the end.
 * Crosses the player's 8 tiles/sec at PEST_CROSSOVER_LEVEL and tops out at
 * PLAYER_TILES_PER_SEC * PEST_TOP_RATIO.
 */
const PEST_TILES_PER_SEC: readonly number[] = [
  7.2, 7.4, 7.6, 7.7, 7.8, 7.9, 8.0, 8.05, 8.1, 8.15, 8.2, 8.25, 8.3, 8.32, 8.34, 8.36,
  8.38, 8.4, 8.42, 8.44, 8.5,
];

/** Table lookup, then the ceiling. The only place pest speed is decided. */
function pestTilesPerSec(idx: number): number {
  return Math.min(pick(PEST_TILES_PER_SEC, idx), PLAYER_TILES_PER_SEC * PEST_RATIO_CAP);
}

/** Fraction of pest speed inside the tunnel, and while frightened. */
const TUNNEL_SPEED_FACTOR = 0.55;
const FRIGHT_SPEED_FACTOR = 0.62;
/** Eyes move at a flat multiple of the player's speed. */
const EYES_TILES_PER_SEC = 15;

/**
 * The level from which a golden grain never frightens again — it is pure points from here
 * on, and the only tool the player has left is the maze itself.
 *
 * ── ON THE SPEC'S WORDING ───────────────────────────────────────────────────────
 * The spec says "From level 5 frightened mode is eventually disabled entirely." That
 * sentence has two readings, and they build different games:
 *
 *   (a) level 5 is where the shrinking STARTS to bite and zero arrives later — "from
 *       level 5 … eventually";
 *   (b) level 5 is where it is already gone.
 *
 * (a) is implemented, because "eventually" is doing real work in that sentence and
 * because (b) removes the mechanic before most players ever see it — a 2-second window at
 * level 5 is already vestigial, and killing it outright there costs the chain-scoring
 * ceiling the whole rest of the curve. If (b) turns out to be what was meant, it is this
 * one number plus the tail of the table below, and nothing else.
 */
export const FRIGHTENED_GONE_FROM_LEVEL = 17;

/**
 * Frightened duration by level, in seconds. Shortens, with the occasional reprieve level
 * — a monotonic slide gives the player nothing to look forward to, and a level that hands
 * back five seconds after three levels of one is where a run gets its points.
 *
 * Level 5 is where it stops being protection and becomes a tight scoring window (2s), and
 * FRIGHTENED_GONE_FROM_LEVEL is where it disappears for good.
 */
const FRIGHTENED_SECONDS: readonly number[] = [
  //1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21
  6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 0, 0, 0, 0,
];

/**
 * Mode cycles. Authored in seconds, alternating scatter/chase and starting with scatter.
 * Scatter phases shorten as levels progress; chase lengthens. The trailing chase is
 * unbounded — after the last listed phase the pests never scatter again, which is what
 * makes a long level frightening rather than merely long.
 */
const CYCLE_SECONDS: readonly (readonly number[])[] = [
  [7, 20, 7, 20, 5, 20, 5], // levels 1
  [6, 22, 6, 22, 4, 24, 3], // levels 2-4
  [5, 24, 5, 24, 3, 26, 2], // levels 5-12
  [4, 26, 4, 28, 2, 30, 1], // levels 13+
];

/** The last chase phase runs for this long, i.e. longer than any level will last. */
const FOREVER_TICKS = secondsToTicks(60 * 60);

/** Pen dot limits by level band, per pest index. The Rat never waits in the pen. */
const PEN_DOT_LIMITS: readonly (readonly number[])[] = [
  [0, 0, 30, 60], // level 1
  [0, 0, 0, 50], //  levels 2-4
  [0, 0, 0, 0], //   levels 5+
];

const PEN_TIMEOUT_SECONDS: readonly number[] = [4, 4, 3];

function pick<T>(table: readonly T[], index: number): T {
  const i = Math.max(0, Math.min(table.length - 1, index));
  return table[i];
}

/** Which band a level falls into, for the tables above that are banded rather than per-level. */
function band(level: number): number {
  if (level <= 1) return 0;
  if (level <= 4) return 1;
  if (level <= 12) return 2;
  return 3;
}

function cycleTicks(level: number): readonly number[] {
  const seconds = pick(CYCLE_SECONDS, band(level));
  const ticks = seconds.map(secondsToTicks);
  ticks.push(FOREVER_TICKS);
  return ticks;
}

/**
 * Every dial for a level. Levels beyond the end of the tables clamp to the last entry,
 * so level 99 is playable rather than undefined.
 */
export function levelTuning(level: number): LevelTuning {
  const lv = Math.max(1, Math.floor(level));
  const idx = lv - 1;
  const pest = pestTilesPerSec(idx);
  const penBand = Math.min(band(lv), PEN_DOT_LIMITS.length - 1);
  return {
    playerSpeed: tilesPerSecond(PLAYER_TILES_PER_SEC),
    cornerLead: CORNER_LEAD,
    turnTolerance: TURN_TOLERANCE,
    pestSpeed: tilesPerSecond(pest),
    pestTunnelSpeed: tilesPerSecond(pest * TUNNEL_SPEED_FACTOR),
    pestFrightSpeed: tilesPerSecond(pest * FRIGHT_SPEED_FACTOR),
    eyesSpeed: tilesPerSecond(EYES_TILES_PER_SEC),
    frightenedTicks: secondsToTicks(pick(FRIGHTENED_SECONDS, idx)),
    modeCycle: cycleTicks(lv),
    penDotLimits: pick(PEN_DOT_LIMITS, penBand),
    penTimeoutTicks: secondsToTicks(pick(PEN_TIMEOUT_SECONDS, penBand)),
  };
}

/**
 * Player speed at level 1, exported for the Phase 2 movement tests and for anything that
 * wants the base value without building a whole tuning record.
 */
export const PLAYER_SPEED = tilesPerSecond(PLAYER_TILES_PER_SEC);
