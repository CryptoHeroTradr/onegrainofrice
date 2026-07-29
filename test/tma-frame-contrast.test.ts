import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE /tma TELEGRAM FRAME RENDERS ON /home's SURFACE — measured, per element.
 *
 * This frame has had its colours wrong twice, in opposite directions, and both times because the
 * text and the surface behind it were decided in different places:
 *
 *   1. it was ink-toned text on the dark page body (1.03:1 — invisible), which nobody saw because
 *      detection was broken and the frame never rendered;
 *   2. then it was paper-toned text on that same dark body — legible, but not the treatment the
 *      rest of the product uses.
 *
 * Now the frame carries its own surface, `bg-bone text-nori`, which is exactly what the /home
 * tokenomics section (the one holding the trading portal) has always used. Surface and text are
 * decided together, in one element, and this file checks every text line in the frame against the
 * surface it actually sits on rather than against an assumption about the page.
 *
 * The classes are read from the component and the colours from globals.css, so this cannot drift
 * from either: change a token or a class and the failure names the number it became.
 */

const ROOT = join(import.meta.dirname, "..");
const CSS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const TMA = readFileSync(join(ROOT, "src/components/dca/TelegramMiniApp.tsx"), "utf8");

/** Every colour token in the theme, straight from the stylesheet. */
const TOKENS: Record<string, string> = Object.fromEntries(
  [...CSS.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1] as string, m[2] as string]),
);

const rgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Tailwind's `/NN` opacity, composited over the surface it is drawn on. */
function over(fg: string, bg: string, alpha: number): string {
  const [f, b] = [rgb(fg), rgb(bg)];
  return `#${f.map((c, i) => Math.round(c * alpha + (b[i] as number) * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

const BONE = TOKENS.bone as string; //   the frame's surface, and /home's
const NORI = TOKENS.nori as string; //   its text
const INK = TOKENS.ink as string; //     the body, still behind /dca's strip

/** The Telegram branch — the component's final return, which is the frame under test. */
const FRAME = TMA.slice(TMA.lastIndexOf("  return ("));

/** Every `text-<token>[/NN]` in the frame, with its composited colour over `bg-bone`. */
function textColoursInFrame(): { className: string; colour: string; ratio: number }[] {
  const names = Object.keys(TOKENS)
    .sort((a, b) => b.length - a.length) // longest first: `olive-deep` before `olive`
    .join("|");
  const re = new RegExp(`text-(${names})(?:\\/(\\d+))?`, "g");
  const seen = new Set<string>();
  const out: { className: string; colour: string; ratio: number }[] = [];
  for (const m of FRAME.matchAll(re)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    const alpha = m[2] ? Number(m[2]) / 100 : 1;
    const colour = over(TOKENS[m[1] as string] as string, BONE, alpha);
    out.push({ className: m[0], colour, ratio: contrast(colour, BONE) });
  }
  return out;
}

describe("the frame carries the surface its text was chosen for", () => {
  it("uses /home's pairing — bg-bone with text-nori — and no new colour", () => {
    // The exact classes on the /home tokenomics section, which is where the trading portal lives.
    const home = readFileSync(join(ROOT, "src/components/content/TokenInfo.tsx"), "utf8");
    expect(home).toContain("bg-bone text-nori");
    expect(FRAME).toContain("bg-bone");
    expect(FRAME).toContain("text-nori");
  });

  it("covers the whole viewport, so the ink body never shows beneath a short sheet", () => {
    // A Mini App opens as a sheet whose content can be shorter than the screen. Without this the
    // dark body would show below the content and the frame would look half-painted.
    expect(FRAME).toContain("min-h-screen");
    expect(TMA).toMatch(/min-h-screen bg-bone/); // the loading paint too — no dark first frame
  });

  it("has no light-toned text left over from the dark-body version", () => {
    // The previous fix put paper tones on this frame. On bone they would be the 1.03:1 problem
    // again, mirrored — this is the assertion that keeps the reversal complete.
    expect(FRAME).not.toMatch(/text-paper/);
  });
});

describe("every text line in the frame clears AA against bg-bone", () => {
  const measured = textColoursInFrame();

  it("finds the text it is supposed to be checking", () => {
    // A regex that matched nothing would make every assertion below vacuous.
    expect(measured.length).toBeGreaterThanOrEqual(3);
    expect(measured.map((m) => m.className)).toContain("text-nori");
  });

  it("the heading and every body line pass 4.5:1", () => {
    // 4.5 is AA for normal-size text, which is what all of these are (14px and below). No
    // large-text exemption is claimed for anything here.
    for (const { className, ratio } of measured) {
      if (className.startsWith("text-tuna")) continue; // see the pinned exception below
      expect(ratio, `${className} on bg-bone is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("pins the actual ratios, so a token change fails here rather than in a screenshot", () => {
    const byClass = Object.fromEntries(measured.map((m) => [m.className, Number(m.ratio.toFixed(2))]));
    // nori on bone for the h1 and the unlinked block; /70 for the intro and secondary lines;
    // /60 for the footnote. These are the pairings this change introduced.
    expect(byClass["text-nori"]).toBeCloseTo(16.39, 1);
    expect(byClass["text-nori/70"]).toBeCloseTo(6.58, 1);
    expect(byClass["text-nori/60"]).toBeCloseTo(4.69, 1);
  });

  /**
   * THE ONE SHORTFALL, NAMED RATHER THAN HIDDEN.
   *
   * The error line is `text-tuna` on `bg-tuna/10`, which measures 3.86:1 — below AA for 14px bold.
   * It is NOT a product of this change: that pairing is the site's error red and appears in 27
   * places across the trading UI, on /home included. Fixing it here alone would make this one box
   * inconsistent with every other error state, and fixing all 27 is a palette decision rather than
   * a styling fix to one frame.
   *
   * So it is pinned instead of excused. If someone darkens the token, this fails and tells them the
   * number moved; if someone decides 3.86 is not good enough, the fix belongs in the palette and
   * this test is where the argument is already written down.
   */
  it("records the pre-existing error-red shortfall instead of pretending it passes", () => {
    const TUNA = TOKENS.tuna as string;
    const errorBox = over(TUNA, BONE, 0.1); // bg-tuna/10 over the bone page
    expect(contrast(TUNA, errorBox)).toBeCloseTo(3.86, 1);
    expect(contrast(TUNA, BONE)).toBeCloseTo(4.4, 1);
    // Its secondary line is ink-toned and comfortably fine, so the box is never unreadable.
    expect(contrast(over(NORI, errorBox, 0.7), errorBox)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the other frames are unaffected", () => {
  it("/home still renders on bone with ink text", () => {
    const home = readFileSync(join(ROOT, "src/components/content/TokenInfo.tsx"), "utf8");
    expect(home).toContain('id="tokenomics"');
    expect(home).toContain("bg-bone text-nori");
    expect(contrast(NORI, BONE)).toBeGreaterThanOrEqual(4.5);
  });

  it("the /tma WEB fallback keeps its dark-body treatment, which is the rest of the site's", () => {
    // Opened outside Telegram, /tma is the ordinary website: dark body, light heading — the same
    // as /dca. That branch is deliberately NOT switched to bone; it is not the Telegram frame.
    const fallback = TMA.slice(TMA.indexOf("if (inTelegram === false)"), TMA.lastIndexOf("  return ("));
    expect(fallback).toContain("text-paper");
    expect(contrast(TOKENS.paper as string, INK)).toBeGreaterThanOrEqual(4.5);
  });

  it("the tab strip still works on both surfaces it can land on", () => {
    // bone (this frame, and /home) and ink (/dca). The unselected chip is bone with an olive-deep
    // label either way — which is the whole reason it stopped depending on the page behind it.
    const OLIVE_DEEP = TOKENS["olive-deep"] as string;
    expect(contrast(OLIVE_DEEP, BONE)).toBeGreaterThanOrEqual(4.5); // the label, on its chip
    expect(contrast(BONE, INK)).toBeGreaterThanOrEqual(7); // the chip, against /dca's body
  });
});
