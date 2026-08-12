/**
 * TETRICE — the palette's greyscale ceiling, enforced.
 *
 * *Added 2026-08-13, out of the Phase 1 gate.* The gate measured what the spec had only
 * assumed: the seven chromatic `@theme` tokens collapse, in Rec.709 luminance, to three
 * groups with near-identical values — I/J 0.8 apart, L/T 1.5, S/O 4.3 — while the renderer
 * varies each grain's value by ±14%. The jitter inside one shape is an order of magnitude
 * larger than the difference between two shapes, so **for a greyscale or colour-blind
 * player the grain axis is not the second identity channel, it is the only one.**
 *
 * The axis code does resolve every collision — but by coincidence. The axis was assigned
 * against HUE FAMILIES (`docs/tetrice-spec.md`, *The pieces*), and luminance proximity is a
 * different partition of the same seven shapes. A palette edit that is obviously safe on
 * hue can therefore break the greyscale case silently, which is exactly the failure a
 * paragraph in a spec does not prevent. Hence a test.
 *
 * WHAT IT ASSERTS: no two shapes whose value bands overlap may share a grain axis.
 *
 * TWO DELIBERATE CHOICES, both recorded in the spec:
 *
 *  1. **Pairwise, not tier-based.** Clustering into tiers by single linkage chains through
 *     intermediates — Z sits inside both I's band and O's band, so I, J, Z, O and S merge
 *     into one "tier" containing both I and O, which are both horizontal. That fails on a
 *     palette that is genuinely fine (I and O are 1.40 apart and never confusable), and a
 *     test that cries wolf is a test somebody deletes. The real question is "can THESE TWO
 *     be confused", so it is asked about pairs.
 *  2. **The threshold is derived, not chosen.** A shape's grains occupy [0.86·L, 1.14·L],
 *     so two bands overlap exactly when max/min < 1.14/0.86 ≈ 1.326. It is computed from
 *     `VALUE_SPREAD` so that widening the variation cannot silently loosen the test.
 *
 * PHASE 2 MOVES THE IMPORTS. `TOKEN`, `AXIS` and `VALUE_SPREAD` currently live in the
 * throwaway gate renderer, which is the only place they exist today. When the engine lands
 * they move to `engine/rules.ts` and this file re-points at it. **Phase 6 deletes the gate,
 * and if the constants have not moved by then this suite fails loudly — which is the
 * intended behaviour, not an accident to work around.**
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AXIS,
  SHAPES,
  TOKEN,
  VALUE_SPREAD,
  type Palette,
  type Shape,
} from "@/components/tetrice-gate/gateRender";

const GLOBALS_CSS = join(__dirname, "..", "src", "app", "globals.css");

/** Bands overlap when max/min < (1+spread)/(1-spread). Derived, never hard-coded. */
const BAND_RATIO = (1 + VALUE_SPREAD) / (1 - VALUE_SPREAD);

/** Rec.709, the same transform the renderer's greyscale pass applies. */
function luminance(hex: string): number {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The seven chromatic tokens, read from the file that actually defines them. */
function readPaletteFromCss(): Palette {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const out = {} as Palette;
  for (const shape of SHAPES) {
    const token = TOKEN[shape];
    const m = css.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
    if (!m) throw new Error(`${token} not found in globals.css — the parse, not the palette, is broken`);
    out[shape] = m[1];
  }
  return out;
}

export interface Collision {
  a: Shape;
  b: Shape;
  axis: string;
  ratio: number;
}

/**
 * Every pair that a greyscale player could confuse AND that the axis code does not
 * separate. Empty is the passing state.
 */
function findAxisCollisions(palette: Palette): Collision[] {
  const out: Collision[] = [];
  for (let i = 0; i < SHAPES.length; i++) {
    for (let j = i + 1; j < SHAPES.length; j++) {
      const a = SHAPES[i];
      const b = SHAPES[j];
      const la = luminance(palette[a]);
      const lb = luminance(palette[b]);
      const ratio = Math.max(la, lb) / Math.min(la, lb);
      if (ratio >= BAND_RATIO) continue; // distinguishable on value alone
      if (AXIS[a] !== AXIS[b]) continue; // the axis code separates them
      out.push({ a, b, axis: AXIS[a], ratio });
    }
  }
  return out;
}

describe("TETRICE palette — the greyscale ceiling", () => {
  it("parses all seven chromatic tokens out of globals.css", () => {
    // The control on the instrument itself. A regex that silently matched nothing would
    // make every assertion below pass by measuring an empty palette.
    const palette = readPaletteFromCss();
    expect(Object.keys(palette).sort()).toEqual([...SHAPES].sort());
    for (const shape of SHAPES) {
      expect(palette[shape], `${shape} (${TOKEN[shape]})`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      expect(Number.isFinite(luminance(palette[shape]))).toBe(true);
    }
  });

  it("the derived band threshold matches the ±14% spread the renderer applies", () => {
    expect(VALUE_SPREAD).toBeGreaterThan(0);
    expect(BAND_RATIO).toBeCloseTo(1.326, 2);
  });

  it("the palette really does collide in luminance — this test has something to catch", () => {
    // A positive control on the PREMISE. If a future palette separated all seven by value,
    // the assertion below would pass without the axis code doing anything, and nobody
    // would know the guarantee had stopped depending on it.
    const palette = readPaletteFromCss();
    const overlapping: string[] = [];
    for (let i = 0; i < SHAPES.length; i++) {
      for (let j = i + 1; j < SHAPES.length; j++) {
        const la = luminance(palette[SHAPES[i]]);
        const lb = luminance(palette[SHAPES[j]]);
        if (Math.max(la, lb) / Math.min(la, lb) < BAND_RATIO) {
          overlapping.push(`${SHAPES[i]}/${SHAPES[j]}`);
        }
      }
    }
    expect(overlapping.length, "no pair overlaps in value — re-read this suite's premise").toBeGreaterThan(0);
  });

  it("no two value-confusable shapes share a grain axis", () => {
    const collisions = findAxisCollisions(readPaletteFromCss());
    expect(
      collisions,
      collisions.length
        ? `these pairs are indistinguishable in greyscale: ${collisions
            .map((c) => `${c.a}/${c.b} (both ${c.axis}, ratio ${c.ratio.toFixed(3)})`)
            .join(", ")}`
        : "",
    ).toEqual([]);
  });

  it("POSITIVE CONTROL: a deliberately colliding palette is rejected", () => {
    // O is horizontal and so is I. Give O a colour with I's luminance and the pair becomes
    // indistinguishable for a greyscale player, with no axis difference to fall back on.
    // A checker that has stopped checking passes the real palette and this one alike.
    const broken: Palette = { ...readPaletteFromCss(), O: "#2a4d8f" };
    const collisions = findAxisCollisions(broken);
    expect(collisions.length, "the checker did not notice an exact luminance collision").toBeGreaterThan(0);
    expect(collisions.some((c) => c.axis === "horizontal")).toBe(true);
  });
});
