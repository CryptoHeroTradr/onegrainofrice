import { createGame, beginPlay, tick, PLAYING, GAMEOVER } from "@/components/chomp/engine/game";
import { runBot } from "./test/chomp-support";
import { levelTuning } from "@/components/chomp/engine/levels";
import { tilesPerSecond } from "@/components/chomp/engine/types";

const secsT = (t: number) => t / 60;
const SEEDS = Array.from({ length: 10 }, (_, i) => 1000 + i * 7919);

type Override = (t: ReturnType<typeof levelTuning>) => void;

/** Play level 1 to a clear or a game over. Returns whether it cleared, and how long. */
function playLevel1(seed: number, override?: Override) {
  const g = beginPlay(createGame(1, seed));
  if (override) override(g.tuning);
  let guard = 0;
  while (g.lives > 0 && g.grainsRemaining > 0 && guard++ < 40) {
    runBot(g, 60 * 400, tick);
    if (g.grainsRemaining === 0) break;
    let spin = 0;
    while (g.phase !== PLAYING && g.phase !== GAMEOVER && g.lives > 0 && spin++ < 2000) tick(g);
    if (g.phase === GAMEOVER || g.lives <= 0) break;
  }
  return {
    cleared: g.grainsRemaining === 0,
    ticks: g.tick,
    grains: g.grainsEaten,
    total: g.grainsEaten + g.grainsRemaining,
    score: g.score,
  };
}

function measure(label: string, override?: Override) {
  const rows = SEEDS.map((s) => playLevel1(s, override));
  const cleared = rows.filter((r) => r.cleared).length;
  const meanGrains = rows.reduce((a, r) => a + r.grains / r.total, 0) / rows.length;
  const clearTimes = rows.filter((r) => r.cleared).map((r) => secsT(r.ticks));
  console.log(
    label.padEnd(38),
    `cleared ${String(cleared).padStart(2)}/10`,
    `| mean board ${(meanGrains * 100).toFixed(0)}%`,
    clearTimes.length ? `| clear time ${(clearTimes.reduce((a, b) => a + b, 0) / clearTimes.length).toFixed(0)}s` : "",
  );
  return cleared;
}

console.log("=== baseline ===");
measure("as shipped");

console.log("\n=== lever A: pest speed at level 1 (player 8.0) ===");
for (const tps of [7.0, 6.8, 6.6, 6.4, 6.0]) {
  measure(`pests ${tps} t/s (${((tps / 8) * 100).toFixed(0)}% of player)`, (t) => {
    t.pestSpeed = tilesPerSecond(tps);
    t.pestTunnelSpeed = tilesPerSecond(tps * 0.55);
    t.pestFrightSpeed = tilesPerSecond(tps * 0.62);
  });
}

console.log("\n=== lever B: mode cycle — keep scatter recurring ===");
const CYCLES: Record<string, number[]> = {
  "shipped 7/20 x3 then forever": [7, 20, 7, 20, 5, 20, 5],
  "longer scatters 10/18": [10, 18, 10, 18, 10, 18, 10],
  "more cycles before forever": [7, 20, 7, 20, 7, 20, 7, 20, 7, 20, 7],
  "long scatters, many cycles": [10, 18, 10, 18, 10, 18, 10, 18, 10, 18, 10],
};
for (const [name, secs] of Object.entries(CYCLES)) {
  measure(name, (t) => {
    const ticks = secs.map((s) => Math.round(s * 60));
    ticks.push(60 * 60 * 60);
    (t as { modeCycle: readonly number[] }).modeCycle = ticks;
  });
}

console.log("\n=== lever C: pen stagger at level 1 ===");
for (const limits of [[0, 0, 30, 60], [0, 0, 60, 90], [0, 30, 90, 140], [0, 40, 120, 200]]) {
  measure(`pen dots ${JSON.stringify(limits)}`, (t) => {
    (t as { penDotLimits: readonly number[] }).penDotLimits = limits;
  });
}
