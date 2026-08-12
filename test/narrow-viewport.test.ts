/**
 * NOTHING IS WIDER THAN THE PHONE IT IS ON.
 *
 * The bug, reported 2026-08-06 against /games/chomp on a real handset: the
 * wordmark clipped off the left edge, "Back to the rice paddy" off the right, the
 * HUD cut. The board itself was fine, which is the tell — the game was being made
 * too wide by the page around it.
 *
 * Two independent causes, and the first is the one worth remembering:
 *
 *  1. **A grid item cannot be narrower than its own min-content.** `min-width`
 *     defaults to `auto` for grid and flex items, so the nav row — six fixed-size
 *     controls that could neither wrap nor shrink, min-content 417px — did not
 *     merely overflow itself. Its sibling `main` is in the same grid, so BOTH
 *     stretched to 417 and the game laid its header, back link and HUD out 417px
 *     wide inside a 320px screen.
 *  2. **A percentage max-width inside a shrink-to-fit ancestor does nothing.** The
 *     footer's contract chip is `max-w-full` inside a `flex-col items-center`
 *     column, which is a cyclic dependency CSS resolves by ignoring the
 *     percentage. It laid out 389px wide, widened the document, and the FIXED nav
 *     — which lays out against the document — came with it. A nav that looked
 *     broken at the top of the page was being widened by the address at the bottom.
 *
 * Neither was visible to a probe that asked `documentElement.scrollWidth`: the
 * chomp shell's `overflow-hidden` clipped the first, so the page measured exactly
 * 320px wide while its contents were 417. **The honest measurement is the width of
 * the children.** These are source assertions rather than layout ones — vitest here
 * is DOM-free by design — so what they pin is the RULE in each file, and the
 * numbers above come from a headless browser at 320/360/390/414.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const code = (rel: string) =>
  readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const NAV = code("src/components/journey/JourneyNav.tsx");
const CHOMP = code("src/components/chomp/ChompScreen.tsx");
const COPY = code("src/components/primitives/CopyAddress.tsx");
const PREFS = code("src/components/chomp/prefs.ts");
const SNAKE_PREFS = code("src/components/grainsnake/prefs.ts");
const SNAKE_CANVAS = code("src/components/grainsnake/GrainsnakeCanvas.tsx");
const SNAKE_SCREEN = code("src/components/grainsnake/GrainsnakeScreen.tsx");

describe("the nav row can shrink", () => {
  it("has exactly one elastic element — the wordmark — and it can reach zero", () => {
    // Every other control is a fixed-size affordance. If the wordmark loses
    // `min-w-0` or `truncate`, the row gets a hard floor again and the bar stops
    // fitting at the widths nobody tests.
    expect(NAV).toMatch(/href="\/"[\s\S]{0,200}?className="min-w-0 truncate/);
  });

  it("does not re-introduce a nowrap floor on the wordmark", () => {
    const link = /<Link\s+href="\/"[\s\S]{0,300}?\/Link>/.exec(NAV)?.[0] ?? "";
    expect(link).not.toMatch(/whitespace-nowrap/);
  });

  it("keeps the menu button rigid, so the wordmark is what absorbs the shrink", () => {
    expect(NAV).toMatch(/className="shrink-0"/);
  });
});

describe("the wide-viewport-only bar affordances", () => {
  it("share ONE breakpoint constant", () => {
    expect(NAV).toMatch(/const BAR_ONLY = "hidden sm:[a-z-]+"/);
  });

  it("is used by both 🎮 Games and ❤️ Charity, and by nothing else", () => {
    const uses = NAV.match(/BAR_ONLY/g) ?? [];
    // One declaration + exactly two uses.
    expect(uses).toHaveLength(3);
    expect(NAV).toMatch(/id="games-menu"[\s\S]{0,200}?className=\{BAR_ONLY\}/);
    expect(NAV).toMatch(/href="\/charity"[\s\S]{0,200}?\$\{BAR_ONLY\}/);
  });

  it("leaves no second breakpoint inside the Charity link to disagree with it", () => {
    const link = /<Link\s+href="\/charity"[\s\S]{0,900}?<\/Link>/.exec(NAV)?.[0] ?? "";
    expect(link).not.toMatch(/hidden sm:inline"/);
  });
});

describe("the chomp shell", () => {
  it("caps its column, so the nav can never stretch the game again", () => {
    // The horizontal half of the `min-h-0` that was already here. Without it a
    // wide nav makes `main` wide, and the board's own row list is laid out
    // against a width the screen does not have.
    expect(CHOMP).toMatch(/grid-cols-\[minmax\(0,1fr\)\]/);
  });

  it("still has the vertical half, which was never the problem", () => {
    expect(CHOMP).toMatch(/grid-rows-\[auto_1fr\]/);
    expect(CHOMP).toMatch(/row-start-2 grid min-h-0/);
  });
});

describe("the Board / Pause / Restart row", () => {
  it("wraps by breakpoint, not by content width", () => {
    // `ml-auto` alone in a flex-wrap row means the wrap depends on the measured
    // width of everything to its left — the Phase 6 pause-resize bug's shape,
    // where a row wrapping takes 44px out of the play row and resizes the maze.
    expect(CHOMP).toMatch(/className="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto/);
    expect(CHOMP).not.toMatch(/className="ml-auto flex items-center gap-2"/);
  });

  it("keeps the width floor on Pause, whose caption still toggles", () => {
    expect(CHOMP).toMatch(/min-w-\[5\.75rem\]/);
  });
});

describe("the contract chip", () => {
  it("can actually truncate — min-w-0 on the nowrap span", () => {
    expect(COPY).toMatch(/className="min-w-0 truncate/);
  });

  it("is capped against the VIEWPORT, which no ancestor can undo", () => {
    // `max-w-full` is a percentage against a shrink-to-fit parent: a cycle, so
    // it is ignored while the intrinsic width is computed. `vw` has no such cycle.
    expect(COPY).toMatch(/max-w-\[calc\(100vw-3rem\)\]/);
    expect(COPY).not.toMatch(/inline-flex max-w-full/);
  });
});

describe("the d-pad", () => {
  it("defaults OFF, on every pointer type", () => {
    expect(PREFS).toMatch(/const DPAD_DEFAULT = false/);
    expect(PREFS).toMatch(/read\(DPAD_KEY, DPAD_DEFAULT\)/);
  });

  it("no longer asks about the pointer at all", () => {
    // It defaulted on for `(pointer: coarse)` — i.e. on for every phone, the
    // viewport with the least room to spare.
    expect(PREFS).not.toMatch(/pointer:\s*coarse/);
    expect(PREFS).not.toMatch(/dpadDefault/);
  });

  it("still persists an explicit choice in both directions", () => {
    expect(PREFS).toMatch(/export function setDpadOn/);
    expect(PREFS).toMatch(/write\(DPAD_KEY, on\)/);
  });
});

/**
 * GRAINSNAKE had the same bug one game later, reported 2026-08-12 — and it had a
 * second half chomp does not, because grainsnake's board has a hard floor.
 *
 * The pad defaulted ON for `(pointer: coarse)`, which is every phone. On a 667px
 * handset that leaves the board's slot around 315px, the floor board is 345px, and
 * the slot centres its child — so the top and bottom rows were clipped with no scroll
 * position that could reach them. Turning the pad OFF by default hides the symptom on
 * the common path; scaling the board to fit is what makes it impossible.
 */
describe("the grainsnake d-pad", () => {
  it("defaults OFF, on every pointer type", () => {
    expect(SNAKE_PREFS).toMatch(/const DPAD_DEFAULT = false/);
    expect(SNAKE_PREFS).toMatch(/read\(DPAD_KEY, DPAD_DEFAULT\)/);
    expect(SNAKE_PREFS).not.toMatch(/pointer:\s*coarse/);
  });

  it("still persists an explicit choice in both directions", () => {
    expect(SNAKE_PREFS).toMatch(/export function setDpad\(/);
    expect(SNAKE_PREFS).toMatch(/write\(DPAD_KEY, on\)/);
  });

  it("sizes the canvas to the box it was given, never past it", () => {
    // The CSS box is `w * fit`; the backing store stays on the 15px grid times DPR,
    // so a box under 345px costs display size and never drawing resolution.
    expect(SNAKE_CANVAS).toMatch(/const fit = boardFit\(box\.width, box\.height, px\)/);
    expect(SNAKE_CANVAS).toMatch(/canvas\.style\.width = `\$\{cssW\}px`/);
    expect(SNAKE_CANVAS).toMatch(/canvas\.style\.height = `\$\{cssH\}px`/);
    expect(SNAKE_CANVAS).toMatch(/canvas\.width = Math\.round\(w \* dpr\)/);
    // The old form handed the canvas the floor board whatever the box was.
    expect(SNAKE_CANVAS).not.toMatch(/canvas\.style\.width = `\$\{w\}px`/);
  });

  it("gives the board slot a definite height in the landscape branch", () => {
    // Without this the slot's height comes from the canvas, whose size is measured
    // from the slot. The floor used to pin that loop at 345px and merely overflow;
    // a canvas that scales to fit turns the same loop into a collapse, measured at a
    // 6.5px cell on an 844×390 handset before `self-stretch` was added.
    expect(SNAKE_SCREEN).toMatch(/max-lg:landscape:self-stretch/);
    // `items-center` on the row is what makes it necessary — if it ever goes, the
    // slot stretches by default and this class is merely redundant, not wrong.
    expect(SNAKE_SCREEN).toMatch(/max-lg:landscape:items-center/);
  });
});
