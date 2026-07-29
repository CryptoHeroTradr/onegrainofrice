import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CHARACTERIZATION: the /home trading portal is exactly what it was.
 *
 * The bot dashboard is ADDITIVE. It is a new tab on the /dca workspace and a new set of components
 * beside the existing ones — and it touched two shared things on the way in (`DcaWorkspace`, which
 * grew a third tab, and the `@/lib` folder, which gained modules). /home does not use `DcaWorkspace`
 * at all: `TradingPortal` composes the panels itself, because it is embedded in a page section
 * rather than being a page. That is exactly the sort of detail that is true right up until someone
 * "tidies" the two compositions into one.
 *
 * So this pins /home's composition, in the plainest way available: the portal's own source is
 * unchanged since the commit before this work started, and it still renders the same two panels
 * with the same wallet provider and the same error boundary. The real proof is a browser — the
 * portal works, and the user runs that check — and what a test can add is the guarantee that the
 * thing they verified has not silently moved underneath them.
 */

const ROOT = join(import.meta.dirname, "..");

/** The commit the Phase C work started from — /home's last known-good state, verified in a browser. */
const BASELINE = "5424673";
const PORTAL = "src/components/token/TradingPortal.tsx";

const gitShow = (ref: string, path: string): string | null => {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
  } catch {
    return null; // shallow clone or a rewritten baseline — the shape assertions below still run
  }
};

describe("the /home trading portal is byte-identical to its last verified state", () => {
  it("everything in TradingPortal.tsx except the tab strip is byte-identical to the baseline", () => {
    // The portal was byte-pinned outright until the tab-legibility fix, which had to touch it:
    // /home and /dca now share one tab component, so the two frames cannot drift apart on which
    // state reads as selected. Rather than drop the pin — the thing that catches ACCIDENTAL drift —
    // it is narrowed to the two regions that were never in scope, and they are compared whole:
    //
    //   * the rendered panels and the market/activity card beside them,
    //   * every helper below them, to the end of the file.
    //
    // What is deliberately outside the pin is the strip itself, its `TABS` table and the import
    // that brings the shared component in. Those are the change; the assertions below cover their
    // behaviour (same ids, same order, same panels).
    const before = gitShow(BASELINE, PORTAL);
    if (before === null) return;
    const now = readFileSync(join(ROOT, PORTAL), "utf8");
    const from = (src: string, start: string, end?: string): string =>
      end ? src.slice(src.indexOf(start), src.indexOf(end)) : src.slice(src.indexOf(start));

    expect(
      from(now, '{tab === "swap" ?', "function Metric({"),
      "the /home portal changed where it renders its panels — only the tab strip was in scope",
    ).toBe(from(before, '{tab === "swap" ?', "function TabButton({"));

    expect(
      from(now, "function Metric({"),
      "the /home portal's helpers changed — only the tab strip was in scope",
    ).toBe(from(before, "function Metric({"));
  });

  it("keeps the panels' tab wiring exactly as it was — same ids, same order", () => {
    // The tab strip is allowed to look different. It is not allowed to point somewhere else: the
    // panels below identify themselves by these ids, and a rename would silently unlabel them.
    const now = readFileSync(join(ROOT, PORTAL), "utf8");
    for (const id of ["portal-tab-swap", "portal-panel-swap", "portal-tab-dca", "portal-panel-dca"]) {
      expect(now, `${id} disappeared from the /home portal`).toContain(id);
    }
    expect(now.indexOf('key: "swap"')).toBeLessThan(now.indexOf('key: "dca"')); // Swap first, as before
  });

  it("the panels it mounts have not been touched either", () => {
    // The portal is a composition; changing what it composes changes it just as surely.
    for (const path of [
      "src/components/dca/SwapPanel.tsx",
      "src/components/dca/RecurringPanel.tsx",
      "src/components/dca/ActiveDcaOrders.tsx",
      "src/components/dca/TradeErrorBoundary.tsx",
      "src/components/dca/frame.tsx",
      "src/lib/jupiter.ts",
    ]) {
      const before = gitShow(BASELINE, path);
      if (before === null) continue;
      expect(readFileSync(join(ROOT, path), "utf8"), `${path} changed under the /home portal`).toBe(before);
    }
  });
});

describe("the portal still composes what it composed", () => {
  const src = readFileSync(join(ROOT, PORTAL), "utf8");

  it("imports the shared panels from components/dca — not a fork of them", () => {
    expect(src).toContain('from "@/components/dca"');
    expect(src).toContain("SwapPanel");
    expect(src).toContain("RecurringPanel");
  });

  it("mounts its own wallet provider and its own error boundary", () => {
    // Both are load-bearing for the rest of /home: the provider keeps the root layout wallet-free,
    // and the boundary is why a throw in wallet-adapter cannot take the whole page down.
    expect(src).toContain("CharityWalletProvider");
    expect(src).toContain("TradeErrorBoundary");
  });

  it("does NOT mount the bot dashboard — /home is the trading portal, unchanged", () => {
    // The dashboard is a /dca tab. If it is ever wanted on /home that is a deliberate decision
    // with its own review, not something that arrives because two files look similar.
    expect(src).not.toContain("DcaDashboard");
    expect(src).not.toContain("DcaWorkspace");
  });
});

describe("the shared workspace gained a tab without changing the old ones", () => {
  const src = readFileSync(join(ROOT, "src/components/dca/DcaWorkspace.tsx"), "utf8");

  it("still renders RECURRING and SWAP, in that order", () => {
    const dca = src.indexOf('"RECURRING"');
    const swap = src.indexOf('"SWAP"');
    expect(dca).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(dca);
  });

  it("offers the bot tab only where a wallet can sign, so Telegram keeps its two", () => {
    expect(src).toContain("frame.canSign");
    // The `: [...]` fallback — the frame that cannot sign — must not list the bot tab. The marker
    // is asserted to EXIST first: a reformat that moved it would otherwise slice an empty string,
    // and "the empty string does not contain BOT" is a test that passes for no reason.
    const telegramBranch = src.slice(src.indexOf("frame.canSign"));
    const at = telegramBranch.search(/\]\s*as const\)\s*:\s*\(\[/);
    expect(at, "the canSign ternary was reformatted — re-point this check at its fallback").toBeGreaterThan(-1);
    expect(telegramBranch.slice(at)).not.toContain('"BOT"');
  });

  it("defaults to the RECURRING tab, as it always has", () => {
    expect(src).toContain('initialTab = "dca"');
  });
});
