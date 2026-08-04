import { describe, it } from "vitest";
import { installShimDocument, ShimCanvas, testTexture } from "./canvas2d-shim";
installShimDocument();

describe("pass 2, step by step", () => {
  it("masks", () => {
    const TILE = 4, DPR = 1, COLS = 28, ROWS = 31;
    const cv = new ShimCanvas(COLS * TILE, ROWS * TILE);
    const sctx = cv.getContext("2d")!;
    const tex = testTexture();
    const alphaAt = (c: number, r: number) => {
      const rgba = cv.toRGBA();
      const x = Math.round((c + 0.5) * TILE), y = Math.round((r + 0.5) * TILE);
      return rgba[(y * cv.width + x) * 4 + 3];
    };
    // three wall tiles from row 9 (cols 10-17 are all wall)
    const probes: [number, number][] = [[10, 9], [13, 9], [17, 9]];

    sctx.drawImage(tex as never, 0, 0, COLS * TILE, ROWS * TILE);
    sctx.fillStyle = "rgba(0, 0, 0, 0.52)";
    sctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);
    console.log("\nafter texture + darken veil:");
    for (const [c, r] of probes) console.log(`  alpha at wall (${c},${r}) = ${alphaAt(c, r)}`);

    sctx.globalCompositeOperation = "destination-in";
    console.log(`\ngCO at mask time = "${sctx.globalCompositeOperation}"  fillStyle = "${sctx.fillStyle}"`);

    let n = 0;
    for (const [c, r] of probes) {
      sctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      n++;
      console.log(`  after mask fillRect #${n} (tile ${c},${r}):`);
      for (const [pc, pr] of probes) console.log(`      alpha at (${pc},${pr}) = ${alphaAt(pc, pr)}`);
    }
  });
});
