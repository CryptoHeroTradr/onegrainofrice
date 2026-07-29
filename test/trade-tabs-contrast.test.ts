import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE TABS ARE LEGIBLE — computed, not eyeballed.
 *
 * The bug this pins was not subtle once measured: the unselected label was dark ink with no surface
 * of its own, so on /home (a bone card behind it) it read at 6.6:1 and in the Telegram webview —
 * where the strip sits on the dark page body — it read at **1.02:1**. A ratio of 1.0 is "these two
 * colours are the same colour". The tabs looked disabled because they were, for practical purposes,
 * not drawn.
 *
 * "Check the contrast" is the kind of instruction that gets carried out once and then decays, so it
 * is done here instead: the palette is read from globals.css, the classes are read from the
 * component, and the ratios are computed by the WCAG formula on every run. Change a colour token
 * and this fails with the number it became.
 */

const ROOT = join(import.meta.dirname, "..");
const CSS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const TABS_SRC = readFileSync(join(ROOT, "src/components/dca/TradeTabs.tsx"), "utf8");
/** The component's CODE. Its comment quotes the broken class it replaced (`text-nori/70`) and the
 *  numbers that made it broken — a grep that tripped on that explanation would teach the next
 *  person to delete the explanation. */
const TABS = TABS_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** A colour token, straight from the stylesheet — so the test cannot drift from the theme. */
function token(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS);
  if (!m) throw new Error(`--color-${name} is not in globals.css`);
  return m[1] as string;
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1..21. */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const BONE = token("bone"); //     the unselected chip
const OLIVE = token("olive"); //   the selected fill
const OLIVE_DEEP = token("olive-deep"); // the unselected label
const INK = token("ink"); //       the page body — /dca and the Telegram webview
const STEAMED = token("steamed"); // the card behind the strip on /home

describe("an unselected tab is legible wherever the strip is dropped", () => {
  it("carries its own surface, so contrast does not depend on the page behind it", () => {
    // This is the whole fix. The label sits on the chip, and the chip is a solid colour.
    expect(TABS).toContain("bg-bone");
    expect(TABS).toContain("text-olive-deep");
    // What must never come back: a label with no surface, tinted by opacity over an unknown
    // backdrop. That is the exact shape of the bug.
    expect(TABS).not.toContain("bg-transparent");
    expect(TABS).not.toMatch(/text-nori\/\d/);
  });

  it("reads at AA or better against its own chip", () => {
    expect(contrast(OLIVE_DEEP, BONE)).toBeGreaterThanOrEqual(4.5);
  });

  it("is visible on the DARK page body — the case that was broken", () => {
    // /dca renders the strip on `bg-ink`. (The Telegram frame did too, until it was given /home's
    // bone surface — see tma-frame-contrast.test.ts. /dca still has no surface of its own, so this
    // remains the live case rather than a historical one.) The old unselected label measured 1.02
    // here; the chip now separates itself from the body by an order of magnitude.
    expect(contrast(BONE, INK)).toBeGreaterThanOrEqual(7);
    // And the label is still legible once you are looking at the chip, on that same page.
    expect(contrast(OLIVE_DEEP, BONE)).toBeGreaterThanOrEqual(4.5);
  });

  it("is visible on the LIGHT surface, which is where /home and the Telegram frame render it", () => {
    // The chip nearly matches the card there (bone on steamed), which is fine and deliberate: on a
    // light surface the label carries the contrast, and the border draws the control's edge.
    expect(contrast(OLIVE_DEEP, STEAMED)).toBeGreaterThanOrEqual(4.5);
    expect(TABS).toContain("border-2");
  });

  it("regresses loudly if the old ghost-grey ever comes back", () => {
    // The number that made this a bug, kept as a named fact rather than a memory. `text-nori/70`
    // over the page body composites to very nearly the body itself.
    const NORI = token("nori");
    const composite = rgb(NORI)
      .map((c, i) => Math.round(c * 0.7 + rgb(INK)[i] * 0.3))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("");
    expect(contrast(`#${composite}`, INK)).toBeLessThan(1.1); // ~1.02 — invisible
  });
});

describe("selected and unselected are both readable AND clearly different", () => {
  it("the selected label reads on its olive fill", () => {
    // Bold 14px uppercase is WCAG "large text" (>= 14pt bold), where 3:1 is the AA threshold.
    expect(contrast(BONE, OLIVE)).toBeGreaterThanOrEqual(3);
    expect(TABS).toContain("bg-olive");
    expect(TABS).toContain("text-bone");
  });

  it("the two states differ enough to tell apart at arm's length", () => {
    // Not just "both legible" — which one is current has to be obvious without comparing labels.
    expect(contrast(OLIVE, BONE)).toBeGreaterThanOrEqual(3);
  });

  it("distinguishes them by fill, not by dimming one of them", () => {
    // A disabled-looking tab is the failure being fixed; opacity on the unselected state is how it
    // comes back. The selected tab is filled, the unselected is a chip — neither is faded.
    expect(TABS).not.toMatch(/opacity-\d/);
    expect(TABS).not.toContain("disabled:");
  });
});

describe("one strip, every frame", () => {
  it("is the only tab implementation left", () => {
    // The bug existed because there were two, styled differently by accident. A second one would
    // put it back — one frame would be fixed and the other would rot quietly.
    for (const file of ["src/components/dca/DcaWorkspace.tsx", "src/components/token/TradingPortal.tsx"]) {
      const src = readFileSync(join(ROOT, file), "utf8");
      expect(src, `${file} still builds its own tabs`).toContain("TradeTabs");
      expect(src, `${file} hand-rolls a tab button`).not.toMatch(/role="tab"/);
    }
  });

  it("keeps the accessible names and the selected state on the buttons", () => {
    expect(TABS).toContain('role="tablist"');
    expect(TABS).toContain('role="tab"');
    expect(TABS).toContain("aria-selected");
    expect(TABS).toContain("aria-label={label}");
  });

  it("stays touch-sized at the width the Telegram webview opens at", () => {
    // ~380px across three tabs is ~120px each; the height is what actually gets missed.
    expect(TABS).toContain("min-h-11"); // 44px — the platform minimum
    expect(TABS).toContain("flex-1"); // equal widths, no tab squeezed out at narrow widths
  });
});
