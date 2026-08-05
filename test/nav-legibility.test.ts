/**
 * THE NAV IS LEGIBLE ON EVERY PAGE THAT RENDERS IT — by default, not by luck.
 *
 * The bug: `JourneyNav` painted its text in `bone` (#f4efe2) and turned solid
 * only after `scrollY > innerHeight * 0.6`. That is correct over a dark hero and
 * wrong over anything else, and nothing in the component asked which it was on.
 * /games is `bg-steamed` (#fbf7ee) from its first pixel, so its logo, wordmark
 * and Charity label rendered at a measured **1.03:1** — present, focusable, read
 * aloud by a screen reader, and invisible.
 *
 * Scrolling did not rescue it, and the reason is the part worth pinning. /games
 * IS scrollable — 1321px of content in a 900px viewport — but the solid state
 * needs 540px of scroll and the page only has 421px of range. The near-miss
 * version of this bug looks exactly like the obvious version and is far easier to
 * ship, so "is the page tall enough" is not the question and this file does not
 * ask it.
 *
 * The question is whether anything DARK is behind the bar, and only the page
 * knows. So `overHero` is opt-in and the default is solid: a page that says
 * nothing gets a bar that works on any background. This suite asserts that
 * default in the component, and asserts the opt-in per page — including the
 * pages that must NOT opt in, because this failure runs in both directions and a
 * test that only checked /games would let the next light page ship broken.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Source with comments stripped — the prose below quotes the classes involved. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const NAV = code("src/components/journey/JourneyNav.tsx");

/**
 * Every page that mounts the nav, and whether it paints something dark behind it.
 *
 * These were measured in a headless browser on 2026-08-05 (computed background of
 * the element under the bar): / #0a0805 hero, /pfp #0a0805, /charity #0a0805,
 * /memes #14110d, /games #fbf7ee. Add a route here when it starts rendering the
 * nav — an unlisted page is a page nobody checked.
 */
const PAGES: { file: string; darkBehindTheBar: boolean }[] = [
  { file: "src/app/page.tsx", darkBehindTheBar: true },
  { file: "src/app/pfp/page.tsx", darkBehindTheBar: true },
  { file: "src/app/charity/page.tsx", darkBehindTheBar: true },
  { file: "src/app/memes/page.tsx", darkBehindTheBar: true },
  { file: "src/app/games/page.tsx", darkBehindTheBar: false },
];

describe("JourneyNav's default", () => {
  it("is solid — `overHero` defaults to false", () => {
    expect(NAV).toMatch(/overHero\s*=\s*false/);
  });

  it("derives the transparent state from overHero, not from scroll alone", () => {
    // `solid` must not be reachable purely by scrolling: a page that never opted
    // in has no transparent state to leave.
    expect(NAV).toMatch(/const\s+solid\s*=\s*!canBeTransparent\s*\|\|\s*scrolled/);
    expect(NAV).toMatch(/const\s+canBeTransparent\s*=\s*overHero\s*&&\s*!onPlaySurface/);
  });

  it("paints bone text ONLY in the transparent branch", () => {
    // The failure mode is text-bone reachable on a solid/pale bar. Both classes
    // live in one ternary; if bone ever escapes it, this is the tripwire.
    const ternary = /solid\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"/.exec(NAV);
    expect(ternary, "the solid/transparent class ternary moved").not.toBeNull();
    const [, solidClasses, transparentClasses] = ternary!;
    expect(solidClasses).toContain("text-ink");
    expect(solidClasses).not.toContain("text-bone");
    expect(transparentClasses).toContain("text-bone");
  });
});

describe("every page that renders the nav", () => {
  for (const { file, darkBehindTheBar } of PAGES) {
    const src = code(file);

    it(`${file} mounts it`, () => {
      expect(src).toMatch(/<JourneyNav\b/);
    });

    if (darkBehindTheBar) {
      it(`${file} opts in to the transparent bar (it has a dark hero)`, () => {
        expect(src).toMatch(/<JourneyNav\s+overHero\b/);
      });
    } else {
      it(`${file} does NOT opt in — bone text on a pale page is the whole bug`, () => {
        expect(src).not.toMatch(/<JourneyNav\s+overHero\b/);
      });
    }
  }
});

describe("the chopstick cursor", () => {
  const CURSOR = code("src/components/rice/ChopstickCursor.tsx");
  const CSS = read("src/app/globals.css");

  it("is pinned to the viewport origin by CSS", () => {
    // The premise of the next assertion: with no transform, the wrapper's box IS
    // the top-left corner.
    expect(CSS).toMatch(/\.chopstick-cursor\s*\{[^}]*position:\s*fixed[^}]*\}/);
  });

  it("parks off-screen before the first pointer move, not at (0,0)", () => {
    // A pair of sticks was seen sitting in the top-left corner of /games — the
    // only page whose corner is pale enough to notice them on. opacity:0 is not
    // enough on its own: it leaves the corner a place they can be drawn.
    expect(CURSOR).toMatch(/const\s+PARKED\s*=\s*"translate3d\(-\d+px,\s*-\d+px,\s*0\)"/);
    expect(CURSOR).toMatch(/style=\{\{\s*transform:\s*PARKED\s*\}\}/);
  });
});
