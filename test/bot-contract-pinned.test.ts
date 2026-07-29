import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE VENDORED CONTRACT IS CURRENT — asserted, not remembered.
 *
 * `src/lib/bot-contract/dashboard-contract.ts` is a copy of a file that lives in the ricebuybot
 * repo. A copy is a fine way to consume a zero-import type file (see the prose in
 * `src/lib/bot-contract/index.ts` for why a git dependency or a shared package would both be worse
 * trades) — but only if something mechanical notices when it stops matching its source.
 *
 * It goes stale QUIETLY, which is the whole danger. Nothing fails to compile; the types simply
 * start describing a payload the bot no longer sends, and the first symptom is a dashboard field
 * that renders `undefined` in production.
 *
 * Two checks, and they fail for different reasons:
 *
 *   1. THE COPY MATCHES ITS RECORDED HASH. Runs everywhere, including CI and any machine without
 *      the bot checked out. This catches the copy being edited in place — which is the tempting
 *      thing to do when a type is *almost* right, and which silently forks the contract.
 *   2. THE PINNED COMMIT STILL PRODUCES THOSE BYTES. Runs wherever the bot repo is present, via
 *      `git show <ref>:<path>` — so it reads the pinned commit rather than whatever is checked out.
 *      This catches a rewritten history or a wrong `ref`.
 *
 * Note what is deliberately NOT asserted: that the pin is the bot's LATEST commit. Being behind is
 * legitimate — the site pins a contract and moves when it chooses to. What must never happen is
 * being behind WITHOUT KNOWING, and that is what the hash pins down.
 */

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "src/lib/bot-contract");

interface Pinned {
  readonly repo: string;
  readonly localCheckout: string;
  readonly path: string;
  readonly ref: string;
  readonly sha256: string;
}

const pinned = JSON.parse(readFileSync(join(DIR, "pinned.json"), "utf8")) as Pinned;
const vendored = readFileSync(join(DIR, "dashboard-contract.ts"));
const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

describe("the vendored bot contract has not drifted", () => {
  it("the copy still hashes to the pin", () => {
    expect(
      sha256(vendored),
      "src/lib/bot-contract/dashboard-contract.ts was edited in place. It is a COPY of the bot's " +
        "file — change it there, re-copy, and update pinned.json. Editing it here forks the contract " +
        "silently: the site would compile against types the bot does not implement.",
    ).toBe(pinned.sha256);
  });

  it("the pinned commit in the bot repo still produces exactly these bytes", () => {
    if (!existsSync(join(pinned.localCheckout, ".git"))) {
      // No bot checkout here (CI, a fresh clone). The hash check above still ran, so the copy is
      // known-unmodified; what cannot be verified from this machine is the upstream side.
      expect(pinned.ref).toMatch(/^[0-9a-f]{40}$/); // a full sha, not a branch that can move
      return;
    }
    const upstream = execFileSync("git", ["show", `${pinned.ref}:${pinned.path}`], {
      cwd: pinned.localCheckout,
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(
      sha256(upstream),
      `the bot's ${pinned.path} at ${pinned.ref.slice(0, 12)} no longer matches the vendored copy`,
    ).toBe(pinned.sha256);
    expect(upstream.equals(vendored)).toBe(true);
  });

  it("the contract it pins is still import-free, so copying it stays honest", () => {
    // The bot asserts this too. It is re-asserted here because it is the property that makes
    // vendoring viable at all: a contract that dragged runtime code along could not be copied.
    const src = vendored.toString("utf8");
    expect(src).not.toMatch(/^import\s/m);
    expect(src).not.toMatch(/\brequire\(/);
  });

  it("the site consumes it through the wrapper, never by reaching past it", () => {
    // One import path means one place to change when the pin moves.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !full.startsWith(DIR)) {
          if (readFileSync(full, "utf8").includes("bot-contract/dashboard-contract")) {
            offenders.push(full.replace(`${ROOT}/`, ""));
          }
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders, "import from @/lib/bot-contract, not from the vendored file directly").toEqual([]);
  });
});
