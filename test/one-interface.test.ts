import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { handOffUrl } from "../src/components/dca/frame";

/**
 * PHASE 8 — "one interface in two frames", asserted rather than asserted-to.
 *
 * The phase's acceptance criterion is that an order created in the Telegram Mini App is visible and
 * controllable on the website and vice versa, *because it is the same on-chain order*. The real
 * proof of that is a wallet, a phone and a live chain, and it is the user's to run — see the
 * hand-back notes. What CAN be proved here is the structural property the criterion rests on, and
 * it is the part that would silently rot:
 *
 *   the two frames cannot disagree about a wallet's orders, because neither of them stores any.
 *
 * If some future change adds a cache, a database row, or an optimistic local list of orders, the
 * frames gain a way to disagree — and that is precisely the change that looks harmless in review
 * and shows up as "I cancelled it on the site but Telegram still shows it".
 */

const ROOT = join(import.meta.dirname, "..");
const DCA_DIR = join(ROOT, "src/components/dca");

const dcaFiles = (): string[] =>
  readdirSync(DCA_DIR)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => join(DCA_DIR, f));

const read = (p: string): string => readFileSync(p, "utf8");
/** Comments describe invariants; a grep that trips on the prose teaches people to delete it. */
const codeOf = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// ==========================================================================================
// ONE JUPITER CLIENT
// ==========================================================================================

describe("there is exactly one Jupiter client", () => {
  it("only src/lib/jupiter.ts talks to @rice/jupiter-dca", () => {
    // Everything else goes through the site adapter, so a change of base URL, fee constant or
    // error shape lands in one place for every frame at once.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && full !== join(ROOT, "src/lib/jupiter.ts")) {
          // codeOf, not read: an import is code, and a file that MENTIONS the package while
          // explaining why it does not use it is not an offender. This grep read raw text until
          // src/lib/bot-contract explained (in prose) why it is a vendored copy rather than a git
          // dependency like this package — and tripped on the explanation, which is precisely the
          // way a check teaches people to delete documentation. Same rule as everywhere else here.
          if (codeOf(full).includes("@rice/jupiter-dca")) offenders.push(full.replace(`${ROOT}/`, ""));
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders, "import the shared package through src/lib/jupiter.ts, not directly").toEqual([]);
  });

  it("no second implementation of the Jupiter endpoints survives anywhere", () => {
    // The duplicate that used to live in src/lib/jupiter.ts is gone; this fails if one grows back.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const src = read(full);
          if (/recurring\/v1\/(createOrder|cancelOrder|getRecurringOrders)|swap\/v1\/(quote|swap)/.test(src)) {
            offenders.push(full.replace(`${ROOT}/`, ""));
          }
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders, "Jupiter endpoint paths belong in @rice/jupiter-dca, not in this repo").toEqual([]);
  });
});

// ==========================================================================================
// NO ORDER STORAGE — the reason the frames can never disagree
// ==========================================================================================

describe("neither frame stores orders, so neither can disagree with the chain", () => {
  it("order state is only ever read, live, from Jupiter", () => {
    // One reader, in one component, used by every frame. Both the website and the Mini App mount
    // ActiveDcaOrders; it fetches by wallet address and holds the result in component state that
    // dies with the mount.
    const readers = dcaFiles().filter((f) => codeOf(f).includes("fetchRecurringOrders"));
    expect(readers.map((f) => f.split("/").pop())).toEqual(
      expect.arrayContaining(["ActiveDcaOrders.tsx"]),
    );
    // RecurringPanel re-reads once after a create, to surface the new order's account. That is a
    // read, not a store — so at most these two files, and no others.
    expect(readers.length).toBeLessThanOrEqual(2);
  });

  it("no order is ever persisted — no storage, no cookie, no database", () => {
    for (const file of dcaFiles()) {
      const code = codeOf(file);
      for (const sink of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
        expect(code, `${file.split("/").pop()} persists to ${sink} — orders must live only on-chain`).not.toContain(sink);
      }
    }
  });

  it("the Mini App has no order endpoint of its own to fall out of sync with", () => {
    // The bot bridge answers exactly one question for the Mini App — which wallet is mine — and
    // the order list is then read from Jupiter by that address, exactly as the website does it.
    const app = codeOf(join(DCA_DIR, "TelegramMiniApp.tsx"));
    const fetches = [...app.matchAll(/fetch\(\s*`?([^`,)]+)/g)].map((m) => m[1] as string);
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toContain("/api/tma/wallet");
  });
});

// ==========================================================================================
// THE MINI APP CANNOT SIGN, AND SAYS SO
// ==========================================================================================

describe("the Telegram frame never claims it can sign", () => {
  it("declares canSign: false and carries no signing path of its own", () => {
    const app = codeOf(join(DCA_DIR, "TelegramMiniApp.tsx"));
    expect(app).toContain("canSign: false");
    for (const primitive of ["Keypair", "secretKey", "signTransaction", "sendTransaction"]) {
      expect(app, `the Mini App references ${primitive}`).not.toContain(primitive);
    }
  });

  it("every signing control in a shared panel is behind frame.canSign", () => {
    // sendTransaction is how a panel signs. Any file that calls it must also consult the frame,
    // or a frame that cannot sign would render a button that throws when tapped.
    for (const file of dcaFiles()) {
      const code = codeOf(file);
      if (!code.includes("sendTransaction")) continue;
      expect(code, `${file.split("/").pop()} signs without consulting the frame`).toContain("frame.canSign");
    }
  });
});

// ==========================================================================================
// THE HAND-OFF
// ==========================================================================================

describe("the hand-off carries the composed order intact", () => {
  const ORIGIN = "https://1grainofrice.com";
  const BASE = "/onegrainofrice";

  it("lands on the site's /dca page with the schedule in the URL", () => {
    const url = new URL(
      handOffUrl(ORIGIN, BASE, { kind: "dca-create", perCycle: 0.35, total: 3.5, intervalSeconds: 86_400 }),
    );
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/onegrainofrice/dca");
    expect(url.searchParams.get("per")).toBe("0.35");
    expect(url.searchParams.get("total")).toBe("3.5");
    expect(url.searchParams.get("every")).toBe("86400");
  });

  it("names the specific order when cancelling, not just the page", () => {
    const url = new URL(handOffUrl(ORIGIN, BASE, { kind: "dca-cancel", orderKey: "OrDeRkEy111" }));
    expect(url.searchParams.get("cancel")).toBe("OrDeRkEy111");
  });

  it("carries amounts as typed, never as base units", () => {
    // A pre-computed base-unit amount would be a stale number wearing the authority of an exact
    // one: the landing page re-quotes and re-validates against a live price, and it must start
    // from what the user actually typed.
    const url = new URL(
      handOffUrl(ORIGIN, BASE, { kind: "dca-create", perCycle: 0.35, total: 3.5, intervalSeconds: 60 }),
    );
    expect(url.searchParams.get("per")).not.toContain("350000000");
  });
});
