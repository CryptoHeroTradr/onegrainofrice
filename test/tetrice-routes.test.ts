/**
 * TETRICE's three routes, driven end to end: start → play → submit → board.
 *
 * These call the real handlers with real `Request`s against a real (temporary) database.
 * The unit suites cover the verifier (`tetrice-replay`) and the storage layer
 * (`tetrice-db`); this one covers the thing neither can: **the contract**. Every rejection
 * the design promises gets its own status, and a status is the only part of this feature a
 * caller can actually observe.
 *
 * ── THE SUBMISSION BODY HAS NO SCORE FIELD, AND THAT IS ASSERTED HERE ───────────────
 * Not as a comment: the happy-path test submits `{ runId, engineVersion, inputLog, name }`
 * and then checks that the score on the board is the one the ENGINE produced from the seed
 * the SERVER issued — a number the client never sent and could not have chosen.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tetrice-routes-"));
process.env.TETRICE_DB_PATH = join(dir, "tetrice.db");
process.env.GRAINS_COOKIE_SECRET ||= "s".repeat(32);
process.env.GRAINS_IP_SALT ||= "p".repeat(32);
// Generous enough that the happy path is never the thing that trips it; the rate-limit
// test sets its own tiny bucket by asking for more starts than this.
process.env.TETRICE_MAX_STARTS_PER_VID = "12";
process.env.TETRICE_MAX_RUNS_PER_VID = "12";

import { ENGINE_VERSION } from "@/games/tetrice/engine/rules";
import { createInitialState } from "@/games/tetrice/engine/state";
import { step, type Action } from "@/games/tetrice/engine/step";
import { InputRecorder, actionsAt, maskOf, type LogEntry, type RunLog } from "@/games/tetrice/client/inputLog";
import { InputState } from "@/games/tetrice/client/controls";
import { signVid, VID_COOKIE_NAME } from "@/lib/grains/cookie";
import type { LeaderboardResponse, StartResponse, SubmitResponse } from "@/lib/tetrice/wire";

import { POST as startRoute } from "@/app/api/tetrice/start/route";
import { POST as submitRoute } from "@/app/api/tetrice/submit/route";
import { GET as boardRoute } from "@/app/api/tetrice/leaderboard/route";

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "tetrice-run.json"), "utf8"),
) as { log: RunLog; played: { score: number; level: number; lines: number; ticks: number } };

function cookie(vid: string): string {
  return `${VID_COOKIE_NAME}=${encodeURIComponent(signVid(vid))}`;
}

function post(url: string, vid: string | null, body?: unknown): Request {
  const headers = new Headers({ "content-type": "application/json", "x-country-code": "JP" });
  if (vid) headers.set("cookie", cookie(vid));
  return new Request(url, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function start(vid: string): Promise<StartResponse> {
  const res = await startRoute(post("http://x/api/tetrice/start", vid));
  expect(res.status).toBe(200);
  return (await res.json()) as StartResponse;
}

/**
 * Play a real run on a given seed, through the real input layer, and return its log.
 *
 * The scripted player is the one from `scripts/capture-tetrice-run.mjs` reduced to its
 * essentials: it presses buttons, `InputState` turns them into per-tick actions, the
 * recorder writes what was drained. **The seed is the server's**, so this cannot reuse the
 * fixture — the whole point is that the run belongs to the issued seed.
 */
function playRun(seed: number): { log: RunLog; score: number; level: number; lines: number } {
  const input = new InputState();
  const recorder = new InputRecorder();
  let state = createInitialState(seed);
  let rng = 0x1234567 ^ seed;
  const pick = (n: number) => {
    rng ^= rng << 13;
    rng >>>= 0;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    rng >>>= 0;
    return rng % n;
  };

  for (let t = 0; t < 40_000 && !state.over; t++) {
    if (state.active) {
      const roll = pick(10);
      if (roll < 2) input.pulse("RotateCW");
      else if (roll < 3) input.pulse("Hold");
      else if (roll < 7) input.pulse("HardDrop");
      else if (roll < 8) input.press("Left");
      else if (roll < 9) input.press("Right");
      else {
        input.release("Left");
        input.release("Right");
      }
    }
    const actions: Action[] = input.drain();
    recorder.record(state.ticks, maskOf(actions));
    state = step(state, actions, state.ticks);
  }

  return {
    log: recorder.build(seed, ENGINE_VERSION, state.ticks),
    score: state.score,
    level: state.level,
    lines: state.lines,
  };
}

function submitBody(runId: string, log: RunLog, name = "TESTER") {
  return {
    runId,
    engineVersion: log.engineVersion,
    inputLog: { seed: log.seed, engineVersion: log.engineVersion, ticks: log.ticks, entries: log.entries },
    name,
  };
}

const VID = "route-test-vid";

describe("POST /api/tetrice/start", () => {
  it("issues a run id and a seed, and needs a session to do it", async () => {
    const anon = await startRoute(post("http://x/api/tetrice/start", null));
    expect(anon.status).toBe(401);

    const issued = await start(VID);
    expect(typeof issued.runId).toBe("string");
    expect(issued.runId.length).toBeGreaterThan(16);
    expect(Number.isInteger(issued.seed)).toBe(true);
    expect(issued.engineVersion).toBe(ENGINE_VERSION);
  });

  it("takes no body, so there is nothing for a client to express a seed preference in", () => {
    // Structural, and cheap: the handler is synchronous and never reads the request body.
    const src = readFileSync(
      join(__dirname, "..", "src", "app", "api", "tetrice", "start", "route.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/req\.(json|text)\(\)/);
  });
});

describe("POST /api/tetrice/submit — the happy path", () => {
  it("stores the score IT computed from the seed IT issued", async () => {
    const issued = await start(VID);
    const played = playRun(issued.seed);
    expect(played.score).toBeGreaterThan(0);

    const res = await submitRoute(post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, played.log)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SubmitResponse;

    // The client sent no score. This one came out of the server's own replay.
    expect(body.score).toBe(played.score);
    expect(body.level).toBe(played.level);
    expect(body.lines).toBe(played.lines);
    expect(body.durationMs).toBe(Math.round((played.log.ticks * 1000) / 60));
  });

  it("puts it on the board with the country from the header, not the payload", async () => {
    const res = boardRoute(new Request("http://x/api/tetrice/leaderboard", { headers: { cookie: cookie(VID) } }));
    expect(res.status).toBe(200);
    const board = (await res.json()) as LeaderboardResponse;
    expect(board.players.length).toBeGreaterThan(0);
    expect(board.players[0].rank).toBe(1);
    expect(board.players[0].code).toBe("JP");
    expect(board.players[0].name).toBe("TESTER");
    expect(board.you?.games).toBeGreaterThan(0);
  });
});

describe("POST /api/tetrice/submit — every rejection, with its own status", () => {
  it("401 without a session", async () => {
    const res = await submitRoute(post("http://x/api/tetrice/submit", null, submitBody("x", FIXTURE.log)));
    expect(res.status).toBe(401);
  });

  it("409 for an unknown engine version — never rescored under new rules", async () => {
    const issued = await start(VID);
    const body = { ...submitBody(issued.runId, FIXTURE.log), engineVersion: ENGINE_VERSION + 1 };
    const res = await submitRoute(post("http://x/api/tetrice/submit", VID, body));
    expect(res.status).toBe(409);
    // ...and the run id was NOT spent on it, so a player on a stale build can retry after
    // reloading rather than losing the run.
    const retry = await submitRoute(
      post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, playRun(issued.seed).log)),
    );
    expect(retry.status).toBe(200);
  });

  it("409 for an unknown run id", async () => {
    const res = await submitRoute(
      post("http://x/api/tetrice/submit", VID, submitBody("f".repeat(32), FIXTURE.log)),
    );
    expect(res.status).toBe(409);
  });

  it("409 for a run id that was already submitted — single use", async () => {
    const issued = await start(VID);
    const played = playRun(issued.seed);
    const first = await submitRoute(post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, played.log)));
    expect(first.status).toBe(200);
    const again = await submitRoute(post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, played.log)));
    expect(again.status).toBe(409);
  });

  it("409 for a run id issued to somebody else", async () => {
    const theirs = await start("a-different-player");
    const res = await submitRoute(
      post("http://x/api/tetrice/submit", VID, submitBody(theirs.runId, playRun(theirs.seed).log)),
    );
    expect(res.status).toBe(409);
  });

  it("422 for a zero-score run", async () => {
    const issued = await start(VID);
    // No input at all: the well fills on gravity alone and nothing scores.
    const empty: RunLog = { seed: issued.seed, engineVersion: ENGINE_VERSION, ticks: 0, entries: [] };
    let s = createInitialState(issued.seed);
    while (!s.over) s = step(s, [], s.ticks);
    const res = await submitRoute(
      post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, { ...empty, ticks: s.ticks })),
    );
    expect(res.status).toBe(422);
    expect(s.score).toBe(0); // the control: this really is a zero-score run
  });

  it("422 for a log that runs past the top-out — trailing input is not absorbed", async () => {
    const issued = await start(VID);
    const played = playRun(issued.seed);
    const entries: LogEntry[] = [
      ...played.log.entries.map((e) => [e[0], e[1]] as LogEntry),
      [played.log.ticks + 30, 1 << 2],
    ];
    const extended: RunLog = { ...played.log, ticks: played.log.ticks + 90, entries };

    // THE CONTROL: the engine itself absorbs this silently — `step()` no-ops after `over`.
    // Without the verifier's explicit end-of-run check the route would accept it.
    const perTick = actionsAt(entries, extended.ticks);
    let s = createInitialState(issued.seed);
    for (let t = 0; t < extended.ticks && !s.over; t++) s = step(s, perTick[t], t);
    expect(s.ticks).toBe(played.log.ticks);
    expect(s.score).toBe(played.score);

    const res = await submitRoute(post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, extended)));
    expect(res.status).toBe(422);
  });

  it("422 for a run that never topped out", async () => {
    const issued = await start(VID);
    const played = playRun(issued.seed);
    const cut = Math.floor(played.log.ticks / 2);
    const truncated: RunLog = {
      ...played.log,
      ticks: cut,
      entries: played.log.entries.filter(([f]) => f < cut),
    };
    const res = await submitRoute(post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, truncated)));
    expect(res.status).toBe(422);
  });

  it("400 for frame indices that go backwards", async () => {
    const issued = await start(VID);
    const played = playRun(issued.seed);
    const entries = played.log.entries.map((e) => [e[0], e[1]] as LogEntry);
    [entries[5], entries[6]] = [
      [entries[6][0], entries[5][1]],
      [entries[5][0], entries[6][1]],
    ];
    const res = await submitRoute(
      post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, { ...played.log, entries })),
    );
    expect(res.status).toBe(400);
  });

  it("400 for a log longer than the verifier will simulate", async () => {
    const issued = await start(VID);
    const played = playRun(issued.seed);
    const res = await submitRoute(
      post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, { ...played.log, ticks: 10_000_000 })),
    );
    expect(res.status).toBe(400);
  });

  it("400 for a name the shared checker refuses", async () => {
    const issued = await start(VID);
    const played = playRun(issued.seed);
    const res = await submitRoute(
      post("http://x/api/tetrice/submit", VID, submitBody(issued.runId, played.log, "x")),
    );
    expect(res.status).toBe(400);
  });

  it("413 for an oversized body, refused before it is parsed", async () => {
    const req = new Request("http://x/api/tetrice/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookie(VID),
        "content-length": String(50_000_000),
      },
      body: "{}",
    });
    expect((await submitRoute(req)).status).toBe(413);
  });
});

describe("rate limiting", () => {
  it("429s a vid that asks for seeds in a loop, and start is the tighter bucket", async () => {
    const vid = "loop-caller";
    let sawLimit = false;
    for (let i = 0; i < 20; i++) {
      const res = await startRoute(post("http://x/api/tetrice/start", vid));
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});
