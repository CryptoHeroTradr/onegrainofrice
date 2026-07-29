import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE DASHBOARD'S STRUCTURAL PROMISES.
 *
 * These components need a wallet, a live bridge and a browser to render, so what is asserted here
 * is the set of properties that are cheap to check in source and expensive to notice breaking.
 * Same discipline as `one-interface.test.ts` next door, and the same reasoning: a jsdom harness
 * around a wallet-adapter tree would test the mocks.
 *
 * Each one corresponds to a way this screen could quietly start lying about money.
 */

const ROOT = join(import.meta.dirname, "..");
const DCA_DIR = join(ROOT, "src/components/dca");

const DASHBOARD_FILES = [
  "DcaDashboard.tsx",
  "DashboardKeyMode.tsx",
  "DashboardWalletMode.tsx",
  "DashboardLink.tsx",
];

const read = (f: string): string => readFileSync(join(DCA_DIR, f), "utf8");
/** Comments describe the invariants; a grep that trips on the prose teaches people to delete it. */
const codeOf = (f: string): string =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Code with the ON-SCREEN COPY removed as well as the comments.
 *
 * The custody rules below are about what this screen can DO, and the copy is where it promises the
 * opposite — "your wallet, passphrase and keys are managed only in the bot" is the affordance, so a
 * check that banned the word would ban the sentence that exists to be read. Text between JSX tags
 * is dropped; identifiers, attributes, imports and handlers all survive, which is where a real key
 * field would have to appear.
 */
const codeWithoutCopy = (f: string): string =>
  // A text run starts after a tag or an interpolation and ends at the next one — `Use{" "}` and
  // `…the bot — <span>` both terminate one, which is why both delimiters appear on each side.
  codeOf(f).replace(/[>}][^<>{}]*[<{]/g, "><");

describe("the dashboard exists as its own screens", () => {
  it("every dashboard file is covered by the checks below", () => {
    // A new Dashboard*.tsx would otherwise be exempt from every rule in this file by not being
    // named in it — the same hole the bot's own site-bridge coverage test closes.
    const onDisk = readdirSync(DCA_DIR)
      .filter((f) => /^(Dca)?Dashboard.*\.tsx$/.test(f))
      .sort();
    expect(onDisk).toEqual(DASHBOARD_FILES.slice().sort());
  });
});

describe("no key, no passphrase, no seed — custody is a Telegram conversation", () => {
  it("no dashboard screen has an input for key material", () => {
    for (const f of DASHBOARD_FILES) {
      const code = codeWithoutCopy(f);
      for (const forbidden of ["privateKey", "secretKey", "passphrase", "mnemonic", "seedPhrase", "Keypair"]) {
        expect(code, `${f} references ${forbidden}`).not.toContain(forbidden);
      }
      // `type="password"` is the shape a key field takes even when it is not named one.
      expect(code, `${f} has a password field`).not.toContain('type="password"');
    }
  });

  it("points at the bot for anything to do with a wallet or a key", () => {
    const all = DASHBOARD_FILES.map(read).join("\n");
    expect(all).toContain("/wallet");
    expect(all).toMatch(/only in the bot|managed only in the bot/);
  });

  it("the site never offers a key-taking bridge action", () => {
    // The bot refuses these by name; the site must not have a control that asks for one, or the
    // refusal would be the first thing a user learns instead of the last.
    const all = DASHBOARD_FILES.map(codeOf).join("\n");
    for (const path of ["wallet/import", "wallet/generate", "wallet/export", "wallet/unlock"]) {
      expect(all, `a control targets ${path}`).not.toContain(path);
    }
  });
});

describe("raw u64 amounts are never put through Number()", () => {
  it("no dashboard screen coerces a raw amount", () => {
    for (const f of DASHBOARD_FILES) {
      const code = codeOf(f);
      // The formatters take strings and split digits. A `Number(...Raw)` anywhere here is the
      // silent-corruption path: it renders a plausible figure that is simply wrong.
      expect(code, `${f} coerces a raw amount to a float`).not.toMatch(/Number\(\s*\w*[Rr]aw/);
      expect(code, `${f} parses a raw amount`).not.toMatch(/parse(Int|Float)\(\s*\w*[Rr]aw/);
      expect(code, `${f} does arithmetic on a raw amount`).not.toMatch(/BigInt\(\s*\w*[Rr]aw/);
    }
  });

  it("the one exception is basis points, and it is in the formatter, not a screen", () => {
    // `percent_of_balance` stores BPS — small by construction, so a Number is safe there. It lives
    // in dcaFormat.ts with its reasoning, and screens call that rather than repeating the trick.
    const fmt = readFileSync(join(ROOT, "src/lib/dcaFormat.ts"), "utf8");
    expect(fmt).toContain("bps");
  });
});

describe("countdowns run on the bot's clock", () => {
  it("relative time is derived from serverTime, never from the browser's wall clock", () => {
    for (const f of ["DashboardKeyMode.tsx", "DashboardWalletMode.tsx"]) {
      const code = codeOf(f);
      expect(code, `${f} must derive its clock from the payload`).toContain("serverNow(");
      // Date.now() is allowed ONLY to measure elapsed time since the read (a delta), never as an
      // absolute instant compared against a bot timestamp. Every comparison goes through serverNow.
      const abuses = [...code.matchAll(/Date\.now\(\)\s*[-+]\s*(\w+)/g)].map((m) => m[1] as string);
      for (const operand of abuses) {
        expect(["readAt"], `${f} compares Date.now() against ${operand}`).toContain(operand);
      }
    }
  });
});

describe("the banner is the bot's, printed, not the site's, authored", () => {
  it("prints banner.text and banner.modeText and styles on the boolean", () => {
    const code = codeOf("DcaDashboard.tsx");
    expect(code).toContain("banner.text");
    expect(code).toContain("banner.modeText");
    expect(code).toContain("banner.tradeLive");
  });

  it("does not author its own wording for the most important sentence in the product", () => {
    // If the site spelled these itself they would be a second place for them to be wrong, and the
    // one that is wrong would be the one nobody is watching.
    const code = codeOf("DcaDashboard.tsx");
    expect(code).not.toContain("DRY RUN");
    expect(code).not.toMatch(/LIVE — /);
  });

  it("renders the banner before it knows whether the wallet is linked", () => {
    // An unlinked wallet still learns whether the bot is trading live. The banner sits above the
    // branch in the returned tree, so there is no path that renders a dashboard without it.
    const code = codeOf("DcaDashboard.tsx");
    const banner = code.indexOf("<Banner");
    const linkedBranch = code.indexOf("data.linked");
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(linkedBranch);
  });
});

describe("wallet mode is a different screen, not a hidden one", () => {
  it("branches on walletMode and never renders schedules for it", () => {
    const container = codeOf("DcaDashboard.tsx");
    expect(container).toMatch(/data\.walletMode/);
    expect(container).toContain("DashboardWalletMode");

    // The wallet-mode screen has no schedule list and no control to change one: there is nothing
    // custodial to show, and empty rows would describe machinery that is not running.
    const wallet = codeOf("DashboardWalletMode.tsx");
    expect(wallet).not.toContain("data.schedules");
    expect(wallet).not.toContain("runAction");
    expect(wallet).not.toContain("STOP ALL");
  });

  it("an unlinked wallet gets the link affordance, not an empty dashboard", () => {
    const container = codeOf("DcaDashboard.tsx");
    expect(container).toMatch(/!\w*\.?data\.linked/); // the read is held with its timestamp, so the branch reads snap.data
    expect(container).toContain("DashboardLink");
    expect(read("DashboardLink.tsx")).toContain("/linksite");
  });
});

describe("writes-off degrades, it does not break", () => {
  it("the key-mode screen has a writes-disabled state and disables controls with it", () => {
    const code = codeOf("DashboardKeyMode.tsx");
    expect(code).toContain('"writes-disabled"');
    expect(code).toContain("setWritesOff(true)");
    // Every control is disabled through the same flag, so one cannot be forgotten.
    expect(code).toMatch(/const disabled = writesOff/);
  });

  it("says the controls are turned off rather than reporting a failure", () => {
    const copy = read("DashboardKeyMode.tsx");
    expect(copy).toMatch(/turned off/i);
    // The word that must NOT appear in that state: this is a configuration, not an error.
    const offBlock = copy.slice(copy.indexOf("writesOff &&"), copy.indexOf("</section>"));
    expect(offBlock).not.toMatch(/error|failed|broken/i);
  });

  it("re-reads after every successful mutation, so nothing is rendered stale", () => {
    const code = codeOf("DashboardKeyMode.tsx");
    const okBranch = code.slice(code.indexOf('case "ok"'), code.indexOf('case "refused"'));
    expect(okBranch, "a successful mutation must re-read the dashboard").toContain("onRefresh()");
  });

  it("STOP ALL acts on one tap — a confirmation on an emergency stop is a design error", () => {
    const code = codeOf("DashboardKeyMode.tsx");
    const stop = code.slice(code.indexOf("stop-all"), code.indexOf("STOP ALL") + 200);
    expect(stop).not.toMatch(/confirm|window\.confirm|areYouSure/i);
  });
});

describe("the dashboard reads the bot, and only the bot", () => {
  it("every fetch from a dashboard screen goes to /api/dca/*", () => {
    for (const f of DASHBOARD_FILES) {
      const fetches = [...codeOf(f).matchAll(/fetch\(\s*"([^"]+)"/g)].map((m) => m[1] as string);
      for (const url of fetches) expect(url, `${f} fetches ${url}`).toMatch(/^\/api\/dca\//);
    }
  });

  it("holds no order state of its own — nothing persisted, anywhere", () => {
    for (const f of DASHBOARD_FILES) {
      const code = codeOf(f);
      for (const sink of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
        expect(code, `${f} persists to ${sink}`).not.toContain(sink);
      }
    }
  });

  it("the shared secret never appears on the client side of the wire", () => {
    for (const f of DASHBOARD_FILES) {
      expect(read(f)).not.toContain("SITE_BRIDGE_SECRET");
      expect(read(f)).not.toContain("x-site-bridge-secret");
    }
  });
});
