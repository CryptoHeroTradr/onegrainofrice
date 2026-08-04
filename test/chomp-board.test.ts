import { afterAll, describe, expect, it } from "vitest";
import { installShimDocument, testTexture, type ShimCanvas } from "./canvas2d-shim";
import { COLS, ROWS, parseMaze, tileAt } from "@/components/chomp/engine/maze";
import { WALL } from "@/components/chomp/engine/types";

/**
 * THE BAKED BOARD — does the wall layer actually contain what it is supposed to?
 *
 * This suite exists because a wall texture shipped that was wired up correctly, referenced
 * correctly, decoded correctly, within budget, covered by 167 passing tests — and produced
 * a board pixel-identical to the untextured one. Nothing in the codebase could have
 * noticed, because nothing had ever looked at a baked pixel.
 *
 * The bug was one line: the mask was built with ~380 separate `fillRect` calls under
 * `destination-in`. That operator composites against the WHOLE canvas, so each call erased
 * what the previous ones preserved and only the last tile survived. The fix is a single
 * path fill. **The test that matters is therefore not "is any pixel textured" — the broken
 * version passed that, on one tile — it is "are MANY, WIDELY SEPARATED wall tiles
 * textured".** A test that samples one tile would have shipped the bug.
 *
 * Runs under the node-env vitest with a deterministic Canvas2D shim, whose own compositing
 * is pinned against hand-computed Porter-Duff values in canvas2d-shim.test.ts. If that
 * suite fails, none of this means anything.
 */

const restoreDocument = installShimDocument();
afterAll(restoreDocument);

// Imported after the shim is installed: render.ts calls document.createElement at bake
// time, not at module load, but the order is made explicit rather than relied upon.
const { bakeWalls, CONTRAST_WALL_FILL, CONTRAST_WALL_EDGE, CONTRAST_LIP_SCALE } = await import(
  "@/components/chomp/engine/render"
);

const { grid } = parseMaze();
const TILE = 16;
const DPR = 2;

function bake(opts: Parameters<typeof bakeWalls>[3]): Uint8ClampedArray {
  const cv = bakeWalls(grid, TILE, DPR, opts) as unknown as ShimCanvas;
  return cv.toRGBA();
}

const WIDTH = Math.round(COLS * TILE * DPR);

/** The pixel at the CENTRE of a tile — clear of the keyline on every side. */
function at(rgba: Uint8ClampedArray, col: number, row: number): number[] {
  const x = Math.round((col + 0.5) * TILE * DPR);
  const y = Math.round((row + 0.5) * TILE * DPR);
  const i = (y * WIDTH + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}

/** Wall tiles spread across the whole board, so a mask that only keeps one is caught. */
function wallTilesAcrossTheBoard(): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      // Interior of a wall block: every neighbour is wall too, so the centre pixel is
      // texture and never keyline.
      if (
        tileAt(grid, c, r) === WALL &&
        tileAt(grid, c - 1, r) === WALL &&
        tileAt(grid, c + 1, r) === WALL &&
        tileAt(grid, c, r - 1) === WALL &&
        tileAt(grid, c, r + 1) === WALL
      ) {
        out.push([c, r]);
      }
    }
  }
  return out;
}

describe("the wall bake", () => {
  const flat = bake({});
  const textured = bake({ texture: testTexture() as never });
  const tiles = wallTilesAcrossTheBoard();

  it("finds wall-block interiors spread over the whole maze to sample", () => {
    expect(tiles.length).toBeGreaterThan(20);
    const rows = new Set(tiles.map(([, r]) => r));
    const cols = new Set(tiles.map(([c]) => c));
    expect(rows.size).toBeGreaterThan(5);
    expect(cols.size).toBeGreaterThan(5);
  });

  it("produces a DIFFERENT layer with a texture than without one", () => {
    // The assertion in its plainest form: this is the one that was missing.
    expect(textured).not.toEqual(flat);
  });

  it("textures EVERY wall block, not just the last one drawn", () => {
    // THE REGRESSION. With the mask built from N separate destination-in fillRects, this
    // list came back with every tile but one on it.
    const untextured = tiles.filter(([c, r]) => {
      const a = at(flat, c, r);
      const b = at(textured, c, r);
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    });
    expect(untextured).toEqual([]);
  });

  it("leaves the wall layer fully opaque where it is drawn", () => {
    // The second half of the same bug: destination-in reads the SOURCE ALPHA, so masking
    // with a leftover 52%-alpha fill style scales the whole layer to 52% opacity instead
    // of masking it. That is a washed-out board, not a missing texture, and it would not
    // have been caught by the difference test above.
    for (const [c, r] of tiles) {
      expect(at(textured, c, r)[3], `alpha at wall (${c},${r})`).toBe(255);
    }
  });

  it("never lets the texture into a corridor", () => {
    // Corridors stay flat black so grains, player and pests pop off them. A mask that
    // leaks is worse than no mask: it puts paddy where the player walks.
    let checked = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (tileAt(grid, c, r) === WALL) continue;
        // Skip tiles adjacent to a wall, whose centres can catch an antialiased keyline.
        if (
          tileAt(grid, c - 1, r) === WALL ||
          tileAt(grid, c + 1, r) === WALL ||
          tileAt(grid, c, r - 1) === WALL ||
          tileAt(grid, c, r + 1) === WALL
        ) {
          continue;
        }
        expect(at(textured, c, r)[3], `corridor (${c},${r}) must be untouched`).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("keeps the flat porcelain fill when no texture is supplied", () => {
    // The path taken before the image decodes, and forever if it never does.
    for (const [c, r] of tiles) {
      expect(at(flat, c, r)).toEqual([0x2a, 0x4d, 0x8f, 255]);
    }
  });

  it("gives the high-contrast board a plain black wall and no texture at all", () => {
    // The spec's bargain for allowing a decorative background: it has an off switch, and
    // the off switch turns it OFF rather than dimming it.
    const hc = bake({
      fill: CONTRAST_WALL_FILL,
      edge: CONTRAST_WALL_EDGE,
      lipScale: CONTRAST_LIP_SCALE,
      texture: null,
    });
    for (const [c, r] of tiles) {
      expect(at(hc, c, r)).toEqual([0, 0, 0, 255]);
    }
  });

  it("draws the keyline ON TOP of the texture, not under it", () => {
    // Pass order. The keyline is the one feature holding a textured maze together; if the
    // photograph is composited over it the board turns to soup, which is a judgement call
    // nobody gets to make by accident.
    const edgeTile = (() => {
      for (let r = 1; r < ROWS - 1; r++) {
        for (let c = 1; c < COLS - 1; c++) {
          if (tileAt(grid, c, r) === WALL && tileAt(grid, c, r - 1) !== WALL) return [c, r];
        }
      }
      return null;
    })();
    expect(edgeTile).not.toBeNull();
    const [c, r] = edgeTile as number[];
    // One device pixel inside the top edge of that wall tile: the keyline lives there.
    const x = Math.round((c + 0.5) * TILE * DPR);
    const y = Math.round(r * TILE * DPR) + 1;
    const i = (y * WIDTH + x) * 4;
    expect([textured[i], textured[i + 1], textured[i + 2]]).toEqual([0x45, 0x71, 0xc4]);
  });
});
