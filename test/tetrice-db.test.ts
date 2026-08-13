/**
 * TETRICE's database and run lifecycle: its own file, its own tables, nothing shared, and
 * a run id that can be spent exactly once.
 *
 * The single-writer design is only worth anything if this feature genuinely cannot reach
 * the other databases, so the first suite asserts that structurally — by reading the source
 * — rather than by hoping. `chomp.db`, `grainsnake.db` and `grains.db` each have one
 * legitimate writer, and SQLite will let a second one appear to work right up until it does
 * not.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tetrice-db-"));
process.env.TETRICE_DB_PATH = join(dir, "tetrice.db");
process.env.GRAINS_COOKIE_SECRET ||= "x".repeat(32);
process.env.GRAINS_IP_SALT ||= "y".repeat(32);

const SRC = join(__dirname, "..", "src", "lib", "tetrice");

/** Source with comments stripped — a rule named in prose must not satisfy a source check. */
function code(file: string): string {
  return readFileSync(join(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("it owns one database and cannot reach the others", () => {
  it("never names chomp.db, grainsnake.db or grains.db", () => {
    const src = code("db.ts");
    expect(src).not.toMatch(/chomp\.db/);
    expect(src).not.toMatch(/grainsnake\.db/);
    expect(src).not.toMatch(/grains\.db/);
    // ...and does not import a module that could open one read-write.
    expect(src).not.toMatch(/from\s+["']@\/lib\/chomp\/db["']/);
    expect(src).not.toMatch(/from\s+["']@\/lib\/grains\/db["']/);
    expect(src).not.toMatch(/from\s+["']@\/lib\/grainsnake\/db["']/);
  });

  it("carries its positive control", () => {
    // THE CONTROL: the same matchers against source that DOES name them must fire.
    // Without it, a stripper that removed everything would look like a clean module.
    const fixture = `import { getChompDb } from "@/lib/chomp/db";\nconst p = "data/chomp.db";\n`;
    expect(fixture).toMatch(/chomp\.db/);
    expect(fixture).toMatch(/from\s+["']@\/lib\/chomp\/db["']/);
    // ...and the stripper leaves real code alone.
    expect(code("db.ts")).toMatch(/tetrice_runs/);
  });

  it("declares its own owner flag, not another game's", () => {
    const env = readFileSync(join(SRC, "env.ts"), "utf8");
    expect(env).toMatch(/TETRICE_DB_OWNER/);
    expect(env).not.toMatch(/CHOMP_DB_OWNER/);
    expect(env).not.toMatch(/GRAINSNAKE_DB_OWNER/);
  });

  it("refuses the default path for a process that has not claimed it", async () => {
    const { resetTetriceEnvCache, getTetriceEnv } = await import("@/lib/tetrice/env");
    const saved = process.env.TETRICE_DB_PATH;
    delete process.env.TETRICE_DB_PATH;
    delete process.env.TETRICE_DB_OWNER;
    resetTetriceEnvCache();
    // A guard that can take down production is worse than the hazard it prevents, so the
    // failure is a refusal with a message naming its own fix — not a lockfile.
    expect(() => getTetriceEnv()).toThrow(/TETRICE_DB_OWNER/);
    process.env.TETRICE_DB_PATH = saved;
    resetTetriceEnvCache();
  });
});

describe("the deploy story is complete, in both files", () => {
  const root = join(__dirname, "..");

  it("ecosystem.config.js declares the flag", () => {
    const eco = readFileSync(join(root, "ecosystem.config.js"), "utf8");
    expect(eco).toMatch(/TETRICE_DB_OWNER:\s*"1"/);
  });

  it("promote.sh's preflight loop covers it — the file that gets forgotten", () => {
    // Shipping a board is a TWO-file env change and the second is this one (CLAUDE.md). A
    // plain `pm2 restart` does not re-read ecosystem.config.js, so without the warning
    // every /api/tetrice/* request 500s and nothing says why.
    const promote = readFileSync(join(root, "deploy", "promote.sh"), "utf8");
    const loop = promote.match(/for flag in ([A-Z_ ]+); do/);
    expect(loop).not.toBeNull();
    expect(loop?.[1]).toContain("TETRICE_DB_OWNER");
    // The loop's case arm has to name the API too, or the warning points at nothing.
    expect(promote).toMatch(/TETRICE_DB_OWNER\)\s*api="\/api\/tetrice\/\*"/);
  });
});

describe("the run lifecycle", () => {
  let db: typeof import("@/lib/tetrice/db");
  const VID = "vid-under-test";
  const OTHER = "somebody-else";

  beforeAll(async () => {
    db = await import("@/lib/tetrice/db");
    db.getTetriceDb();
  });

  it("issues a seed the caller had no say in", () => {
    const a = db.issueRun(VID, null);
    const b = db.issueRun(VID, null);
    expect(a.runId).not.toBe(b.runId);
    expect(a.seed).toBeGreaterThanOrEqual(0);
    expect(a.seed).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(a.seed)).toBe(true);
    expect(a.issuedAt).toBeGreaterThan(0);
  });

  it("A RUN ID IS SINGLE-USE", () => {
    const issued = db.issueRun(VID, null);
    const first = db.claimRun(issued.runId, VID);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.seed).toBe(issued.seed);

    // The second claim is the one that matters: a replayed submission must not take a
    // second board row, and the id is spent whatever happened downstream of the claim.
    const second = db.claimRun(issued.runId, VID);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.why).toBe("spent");
  });

  it("refuses an id it never issued", () => {
    const verdict = db.claimRun("0".repeat(32), VID);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.why).toBe("unknown");
  });

  it("refuses an id issued to a different player", () => {
    const issued = db.issueRun(OTHER, null);
    const verdict = db.claimRun(issued.runId, VID);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.why).toBe("wrong-vid");
    // ...and it is still claimable by its owner, so a probe cannot burn someone's run.
    expect(db.claimRun(issued.runId, OTHER).ok).toBe(true);
  });

  it("refuses an expired id, and the deadline is the GENEROUS one", () => {
    const issued = db.issueRun(VID, null);
    const wellInside = issued.issuedAt + db.CLAIM_TTL_MS - 1;
    const justPast = issued.issuedAt + db.CLAIM_TTL_MS + 1;

    // THE PAIRING THAT MATTERS. The spec's 90 s TTL is on issuance→START, explicitly not
    // on issuance→submission, "because a submission deadline of 90 s would reject every
    // honest player who lasted two minutes". So a two-minute-old run must still be
    // claimable — a test that only checked the expiry would pass on the wrong bound.
    expect(db.CLAIM_TTL_MS).toBeGreaterThan(2 * 60_000);
    const late = db.claimRun(issued.runId, VID, justPast);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.why).toBe("expired");

    const other = db.issueRun(VID, null);
    expect(db.claimRun(other.runId, VID, wellInside).ok).toBe(true);
  });

  it("counts issued-to-submitted per vid — observability, not a block", () => {
    const usage = db.seedUsageByVid(0).find((u) => u.vid === VID);
    expect(usage).toBeDefined();
    expect(usage!.issued).toBeGreaterThan(usage!.submitted);
    // Nothing anywhere refuses on the strength of this. Asserted so a future threshold is
    // a deliberate change rather than a quiet one.
    expect(code("db.ts")).not.toMatch(/seedUsageByVid[\s\S]{0,400}throw/);
  });
});

describe("the board", () => {
  let db: typeof import("@/lib/tetrice/db");

  const run = (vid: string, name: string, score: number, level: number, lines: number, tag: string) => ({
    runId: `run-${tag}`,
    vid,
    name,
    score,
    level,
    lines,
    ticks: 1000 + score,
    durationMs: Math.round(((1000 + score) * 1000) / 60),
    seed: 42,
    inputs: `[[0,0],[1,${score}]]`,
    engineVersion: 1,
    countryCode: "JP",
    countryName: "Japan",
    ipHash: null,
  });

  beforeAll(async () => {
    db = await import("@/lib/tetrice/db");
    db.submitRun(run("v1", "ICHI", 5000, 4, 30, "a"));
    db.submitRun(run("v2", "NI", 9000, 6, 55, "b"));
    db.submitRun(run("v3", "SAN", 100, 1, 0, "c"));
  });

  it("ranks by best score and carries level and lines", () => {
    const top = db.getTopPlayers(50);
    expect(top.map((p) => p.name)).toEqual(["NI", "ICHI", "SAN"]);
    expect(top[0].best_score).toBe(9000);
    expect(top[0].best_level).toBe(6);
    expect(top[0].best_lines).toBe(55);
    expect(top[0].country_code).toBe("JP");
    expect(top[0].best_engine_version).toBe(1);
  });

  it("keeps the better run when a player submits a worse one", () => {
    db.submitRun(run("v2", "NI", 10, 1, 0, "d"));
    const me = db.getYou("v2");
    expect(me?.best).toBe(9000);
    expect(me?.bestLines).toBe(55);
    expect(me?.games).toBe(2);
    expect(me?.rank).toBe(1);
  });

  it("dedupes an identical resubmission rather than double-counting it", () => {
    const before = db.getYou("v1")?.games ?? 0;
    const result = db.submitRun(run("v1", "ICHI", 5000, 4, 30, "a"));
    expect(result.duplicate).toBe(true);
    expect(db.getYou("v1")?.games).toBe(before);
  });
});
