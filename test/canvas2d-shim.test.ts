import { describe, expect, it } from "vitest";
import { ShimCanvas, type ShimImage } from "./canvas2d-shim";

/**
 * CHECK THE CHECK.
 *
 * The board tests are only worth what this shim is worth, and a shim written by the same
 * hand as the code under test will happily agree with that code's bugs. So the compositing
 * is pinned here against values computed BY HAND from the Canvas 2D spec's Porter-Duff
 * table, before anything else is allowed to depend on it.
 *
 * If this suite fails, chomp-board.test.ts means nothing.
 */

function px(cv: ShimCanvas, x: number, y: number): number[] {
  const rgba = cv.toRGBA();
  const i = (y * cv.width + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}

function solid(w: number, h: number, rgba: number[]): ShimImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return { width: w, height: h, data };
}

describe("the shim composites the way canvas does", () => {
  it("starts transparent black", () => {
    const cv = new ShimCanvas(4, 4);
    expect(px(cv, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("source-over of an opaque fill replaces the destination", () => {
    const cv = new ShimCanvas(4, 4);
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(0, 0, 4, 4);
    expect(px(cv, 1, 1)).toEqual([0, 0, 255, 255]);
  });

  it("source-over of a 50% black veil halves an opaque destination", () => {
    // Cs=0, αs=0.5, Cd=1.0 (white), αd=1.
    //   Co = 0 + 1·(1−0.5) = 0.5  ->  128
    //   αo = 0.5 + 1·(1−0.5) = 1  ->  255
    const cv = new ShimCanvas(4, 4);
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, 4, 4);
    const [r, , , a] = px(cv, 1, 1);
    expect(a).toBe(255);
    expect(r).toBeGreaterThanOrEqual(127);
    expect(r).toBeLessThanOrEqual(128);
  });

  it("destination-in with an OPAQUE source keeps the destination exactly", () => {
    const cv = new ShimCanvas(4, 4);
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#3399cc";
    ctx.fillRect(0, 0, 4, 4);
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "#000000"; // colour is irrelevant; only alpha is read
    ctx.fillRect(0, 0, 2, 4);
    expect(px(cv, 0, 0)).toEqual([0x33, 0x99, 0xcc, 255]);
  });

  it("destination-in CLEARS the destination everywhere the source is absent", () => {
    // The property that makes it a mask at all, and the one a naive shim gets wrong by
    // only touching the drawn rect.
    const cv = new ShimCanvas(4, 4);
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#3399cc";
    ctx.fillRect(0, 0, 4, 4);
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 2, 4);
    expect(px(cv, 3, 0)).toEqual([0, 0, 0, 0]);
  });

  it("destination-in with a 52%-alpha source SCALES the destination alpha, it does not mask", () => {
    // THE BUG THIS SUITE EXISTS FOR. αd=1, αs=0.52  ->  αo = 0.52, and the colour is
    // unchanged. Composited onto anything afterwards, that is a half-strength layer, not
    // an absent one — which is why the symptom is "washed out", not "missing".
    const cv = new ShimCanvas(4, 4);
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#3399cc";
    ctx.fillRect(0, 0, 4, 4);
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = "rgba(0, 0, 0, 0.52)";
    ctx.fillRect(0, 0, 4, 4);
    const [r, g, b, a] = px(cv, 1, 1);
    expect(a).toBe(Math.round(0.52 * 255)); // 133
    expect([r, g, b]).toEqual([0x33, 0x99, 0xcc]); // colour survives; only alpha moved
  });

  it("drawImage scales a source into a destination rect", () => {
    const cv = new ShimCanvas(8, 8);
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(solid(2, 2, [10, 20, 30, 255]), 0, 0, 8, 8);
    expect(px(cv, 7, 7)).toEqual([10, 20, 30, 255]);
  });

  it("honours a scale transform on fills and images alike", () => {
    const cv = new ShimCanvas(8, 8);
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 2, 2); // 2 CSS px -> 4 device px
    expect(px(cv, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(px(cv, 4, 4)).toEqual([0, 0, 0, 0]);
  });

  it("clips a fill to a rectangular clip region", () => {
    const cv = new ShimCanvas(8, 8);
    const ctx = cv.getContext("2d")!;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 4, 8);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 8, 8);
    ctx.restore();
    expect(px(cv, 3, 0)).toEqual([255, 255, 255, 255]);
    expect(px(cv, 4, 0)).toEqual([0, 0, 0, 0]);
  });
});
