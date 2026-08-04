import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { installShimDocument, ShimCanvas, type ShimImage } from "./canvas2d-shim";

const restore = installShimDocument();

/** Decode the REAL shipped texture to raw RGBA via ffmpeg, so this probes the real asset. */
function realTexture(): ShimImage {
  const raw = "/tmp/paddy.rgba";
  execSync(
    `ffmpeg -v error -y -i /home/deploy/onegrainofrice/public/chomp/paddy-wall.webp -f rawvideo -pix_fmt rgba ${raw}`,
  );
  const buf = require("node:fs").readFileSync(raw);
  return { width: 1192, height: 1320, data: new Uint8ClampedArray(buf) };
}

function writePNG(cv: ShimCanvas, path: string) {
  const rgba = cv.toRGBA();
  // composite onto black so the PNG shows what the player sees over the black board
  const flat = Buffer.alloc(cv.width * cv.height * 3);
  for (let i = 0; i < cv.width * cv.height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    flat[i * 3] = Math.round(rgba[i * 4] * a);
    flat[i * 3 + 1] = Math.round(rgba[i * 4 + 1] * a);
    flat[i * 3 + 2] = Math.round(rgba[i * 4 + 2] * a);
  }
  writeFileSync("/tmp/layer.rgb", flat);
  execSync(
    `ffmpeg -v error -y -f rawvideo -pix_fmt rgb24 -s ${cv.width}x${cv.height} -i /tmp/layer.rgb ${path}`,
  );
}

describe("probe", () => {
  it("bakes", { timeout: 120000 }, async () => {
    const { parseMaze } = await import("@/components/chomp/engine/maze");
    const render = await import("@/components/chomp/engine/render");
    const tex = realTexture();
    const { grid } = parseMaze();
    const TILE = 27;
    const DPR = 2;

    console.log(`\n== INPUT ==`);
    console.log(`texture natural dims   ${tex.width} x ${tex.height}`);
    console.log(`tilePx ${TILE}  dpr ${DPR}  board ${28 * TILE} x ${31 * TILE} CSS px`);

    const flat = render.bakeWalls(grid, TILE, DPR, {}) as unknown as ShimCanvas;
    const textured = render.bakeWalls(grid, TILE, DPR, {
      texture: tex as never,
    }) as unknown as ShimCanvas;

    console.log(`\n== OUTPUT CANVAS ==`);
    console.log(`flat     ${flat.width} x ${flat.height}`);
    console.log(`textured ${textured.width} x ${textured.height}`);

    const a = flat.toRGBA();
    const b = textured.toRGBA();
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
        diff++;
    }
    console.log(`\n== COMPARISON ==`);
    console.log(`pixels differing between flat and textured: ${diff} of ${a.length / 4}`);

    // sample the middle of a known wall block (cols 10-17, rows 9-10)
    const sx = Math.round(13.5 * TILE * DPR);
    const sy = Math.round(9.5 * TILE * DPR);
    const idx = (sy * flat.width + sx) * 4;
    console.log(`wall-centre pixel (col 13.5, row 9.5):`);
    console.log(`  flat     rgba(${a[idx]}, ${a[idx + 1]}, ${a[idx + 2]}, ${a[idx + 3]})`);
    console.log(`  textured rgba(${b[idx]}, ${b[idx + 1]}, ${b[idx + 2]}, ${b[idx + 3]})`);

    writePNG(textured, "/tmp/claude-1000/-home-deploy/b14b3720-2ebf-4e8c-8a25-3e992b047a61/scratchpad/wall-textured.png");
    writePNG(flat, "/tmp/claude-1000/-home-deploy/b14b3720-2ebf-4e8c-8a25-3e992b047a61/scratchpad/wall-flat.png");
    console.log(`\nwrote wall-textured.png and wall-flat.png`);
    restore();
  });
});
