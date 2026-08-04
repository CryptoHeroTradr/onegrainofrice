/**
 * A MINIMAL, DETERMINISTIC Canvas2D — enough to run the board bakes under node.
 *
 * vitest here is node-env and DOM-free on purpose (see the spec's Testability section), so
 * `render.ts`'s baked layers have never been testable. That is exactly why a wall texture
 * could be wired up, look correct in review, pass 167 tests, and produce a flat board.
 * This closes it for the ONE thing worth asserting about a bake: what pixels came out.
 *
 * ── WHY IT IS WRITTEN FROM THE SPEC, NOT FROM render.ts ─────────────────────────
 * A shim written by the same person who wrote the code under test, from the same mental
 * model, agrees with that code's bugs. The compositing here is implemented from the
 * Porter-Duff formulae in the Canvas 2D specification, and `canvas2d-shim.test.ts` checks
 * the SHIM against hand-computed values before anything else is allowed to trust it. If
 * that suite fails, nothing that depends on this file means anything.
 *
 * Colour is held PREMULTIPLIED, in floats 0..1, because that is the form both composite
 * operators are defined in and converting per-operation is how rounding error creeps in.
 *
 * Deliberately NOT implemented: rotation and skew (the bakes only ever scale and
 * translate, and an unsupported transform throws rather than silently mis-drawing), and
 * text, which is a no-op. Text is measured and drawn through the platform's font stack;
 * pretending to rasterise it here would be inventing a second renderer to test the first.
 */

export interface ShimImage {
  width: number;
  height: number;
  /** Straight (non-premultiplied) RGBA, 8-bit, row-major. */
  data: Uint8ClampedArray;
}

type Op = "source-over" | "destination-in";

interface RectClip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function parseColor(css: string): [number, number, number, number] {
  const s = css.trim();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
      full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    ];
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    return [
      (parts[0] || 0) / 255,
      (parts[1] || 0) / 255,
      (parts[2] || 0) / 255,
      parts.length > 3 ? parts[3] : 1,
    ];
  }
  throw new Error(`[shim] unsupported colour ${JSON.stringify(css)}`);
}

export class ShimCanvas {
  /** Premultiplied RGBA, floats 0..1. */
  buf: Float64Array;
  private w = 0;
  private h = 0;

  constructor(w: number, h: number) {
    this.buf = new Float64Array(0);
    this.width = w;
    this.height = h;
  }

  /**
   * width/height are ACCESSORS that reallocate, because that is what a real canvas does
   * and because it is how the code under test uses them: `makeCanvas` constructs the
   * element first and assigns the dimensions afterwards. A plain field here silently
   * leaves the backing store at 0×0, every draw lands nowhere, and the bake comes out
   * blank — which reads exactly like "the texture never arrived".
   */
  get width(): number {
    return this.w;
  }
  set width(v: number) {
    this.w = Math.max(0, Math.round(v));
    this.buf = new Float64Array(this.w * this.h * 4);
  }
  get height(): number {
    return this.h;
  }
  set height(v: number) {
    this.h = Math.max(0, Math.round(v));
    this.buf = new Float64Array(this.w * this.h * 4);
  }

  getContext(kind: string): ShimContext | null {
    return kind === "2d" ? new ShimContext(this) : null;
  }

  /** Straight-alpha RGBA bytes, for comparison and for writing an image out. */
  toRGBA(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.width * this.height; i++) {
      const a = this.buf[i * 4 + 3];
      const inv = a > 0 ? 1 / a : 0;
      out[i * 4] = Math.round(this.buf[i * 4] * inv * 255);
      out[i * 4 + 1] = Math.round(this.buf[i * 4 + 1] * inv * 255);
      out[i * 4 + 2] = Math.round(this.buf[i * 4 + 2] * inv * 255);
      out[i * 4 + 3] = Math.round(a * 255);
    }
    return out;
  }
}

export class ShimContext {
  canvas: ShimCanvas;
  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  lineJoin = "miter";
  miterLimit = 10;
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  globalCompositeOperation: Op = "source-over";

  private sx = 1;
  private sy = 1;
  private tx = 0;
  private ty = 0;
  private clipRect: RectClip | null = null;
  private stack: {
    sx: number;
    sy: number;
    tx: number;
    ty: number;
    clipRect: RectClip | null;
    fillStyle: string;
    op: Op;
  }[] = [];
  private path: RectClip[] = [];

  constructor(canvas: ShimCanvas) {
    this.canvas = canvas;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (b !== 0 || c !== 0) throw new Error("[shim] rotation/skew is not supported");
    this.sx = a;
    this.sy = d;
    this.tx = e;
    this.ty = f;
  }

  translate(x: number, y: number): void {
    this.tx += x * this.sx;
    this.ty += y * this.sy;
  }

  save(): void {
    this.stack.push({
      sx: this.sx,
      sy: this.sy,
      tx: this.tx,
      ty: this.ty,
      clipRect: this.clipRect,
      fillStyle: this.fillStyle,
      op: this.globalCompositeOperation,
    });
  }

  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.sx = s.sx;
    this.sy = s.sy;
    this.tx = s.tx;
    this.ty = s.ty;
    this.clipRect = s.clipRect;
    this.fillStyle = s.fillStyle;
    this.globalCompositeOperation = s.op;
  }

  beginPath(): void {
    this.path = [];
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path.push(this.deviceRect(x, y, w, h));
  }

  /** Only rectangular clips are supported, which is all the bakes use. */
  clip(): void {
    for (const r of this.path) {
      this.clipRect = this.clipRect ? intersect(this.clipRect, r) : r;
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b, a] = parseColor(this.fillStyle);
    this.composite(this.deviceRect(x, y, w, h), () => [r, g, b, a]);
  }

  /**
   * Fill the current path, treated as the UNION of its rectangles, as ONE drawing
   * operation.
   *
   * That "one operation" is the entire point and is why this is implemented rather than
   * stubbed. Under `destination-in` every drawing operation composites against the whole
   * canvas, so N separate fillRects do not build up an N-tile mask — each one erases what
   * the last preserved. A single path fill is the only way to mask to a disjoint shape,
   * and this is the shim behaviour that makes the difference visible in a test.
   */
  fill(): void {
    if (this.path.length === 0) return;
    const [r, g, b, a] = parseColor(this.fillStyle);
    const bounds = this.path.reduce((acc, p) => ({
      x0: Math.min(acc.x0, p.x0),
      y0: Math.min(acc.y0, p.y0),
      x1: Math.max(acc.x1, p.x1),
      y1: Math.max(acc.y1, p.y1),
    }));
    const rects = this.path;
    this.composite(
      bounds,
      () => [r, g, b, a],
      (px, py) => rects.some((q) => px >= q.x0 && px < q.x1 && py >= q.y0 && py < q.y1),
    );
  }

  /**
   * drawImage, in both the 3-argument and the 9-argument form. Nearest-neighbour: the
   * bakes only ever downscale a photograph, and interpolation would make the assertions
   * depend on a filter choice rather than on the composite being tested.
   */
  drawImage(img: ShimImage | ShimCanvas, ...args: number[]): void {
    const src = toShimImage(img);
    let sx0 = 0;
    let sy0 = 0;
    let sw = src.width;
    let sh = src.height;
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (args.length === 2) {
      [dx, dy] = args;
      dw = src.width;
      dh = src.height;
    } else if (args.length === 4) {
      [dx, dy, dw, dh] = args;
    } else if (args.length === 8) {
      [sx0, sy0, sw, sh, dx, dy, dw, dh] = args;
    } else {
      throw new Error(`[shim] drawImage with ${args.length} coords is not supported`);
    }

    const dest = this.deviceRect(dx, dy, dw, dh);
    const spanX = dest.x1 - dest.x0;
    const spanY = dest.y1 - dest.y0;
    if (spanX <= 0 || spanY <= 0) return;

    this.composite(dest, (px, py) => {
      const u = (px - dest.x0 + 0.5) / spanX;
      const v = (py - dest.y0 + 0.5) / spanY;
      const ix = Math.min(src.width - 1, Math.max(0, Math.floor(sx0 + u * sw)));
      const iy = Math.min(src.height - 1, Math.max(0, Math.floor(sy0 + v * sh)));
      const i = (iy * src.width + ix) * 4;
      return [
        src.data[i] / 255,
        src.data[i + 1] / 255,
        src.data[i + 2] / 255,
        src.data[i + 3] / 255,
      ];
    });
  }

  // Text is not rasterised. See the file header.
  measureText(text: string): {
    width: number;
    actualBoundingBoxAscent: number;
    actualBoundingBoxDescent: number;
  } {
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? "10");
    return {
      width: text.length * size * 0.5,
      actualBoundingBoxAscent: size * 0.7,
      actualBoundingBoxDescent: size * 0.05,
    };
  }
  fillText(): void {}
  strokeText(): void {}
  stroke(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  arc(): void {}
  ellipse(): void {}
  quadraticCurveTo(): void {}
  clearRect(x: number, y: number, w: number, h: number): void {
    const d = this.deviceRect(x, y, w, h);
    for (let py = d.y0; py < d.y1; py++) {
      for (let px = d.x0; px < d.x1; px++) {
        const i = (py * this.canvas.width + px) * 4;
        this.canvas.buf[i] = 0;
        this.canvas.buf[i + 1] = 0;
        this.canvas.buf[i + 2] = 0;
        this.canvas.buf[i + 3] = 0;
      }
    }
  }

  private deviceRect(x: number, y: number, w: number, h: number): RectClip {
    return {
      x0: Math.round(x * this.sx + this.tx),
      y0: Math.round(y * this.sy + this.ty),
      x1: Math.round((x + w) * this.sx + this.tx),
      y1: Math.round((y + h) * this.sy + this.ty),
    };
  }

  /**
   * The compositing core, straight out of the Canvas 2D spec's Porter-Duff table, on
   * PREMULTIPLIED colour:
   *
   *   source-over      Co = Cs + Cd·(1 − αs)        αo = αs + αd·(1 − αs)
   *   destination-in   Co = Cd·αs                   αo = αd·αs
   *
   * Note what destination-in does with a PARTIALLY TRANSPARENT source: it does not mask,
   * it SCALES the destination's alpha by the source's. A mask drawn at 52% alpha leaves
   * the destination at 52% alpha, which is a perfectly plausible-looking bug.
   */
  private composite(
    rect: RectClip,
    sample: (px: number, py: number) => [number, number, number, number],
    covers?: (px: number, py: number) => boolean,
  ): void {
    const cv = this.canvas;
    const region = this.clipRect ? intersect(rect, this.clipRect) : rect;

    // destination-in affects the WHOLE canvas, not just the drawn rect: everywhere the
    // source is absent, the source alpha is 0, so the destination is cleared. Getting
    // this wrong is what makes a hand-rolled shim agree with a broken implementation.
    const x0 = this.globalCompositeOperation === "destination-in" ? 0 : Math.max(0, region.x0);
    const y0 = this.globalCompositeOperation === "destination-in" ? 0 : Math.max(0, region.y0);
    const x1 =
      this.globalCompositeOperation === "destination-in" ? cv.width : Math.min(cv.width, region.x1);
    const y1 =
      this.globalCompositeOperation === "destination-in"
        ? cv.height
        : Math.min(cv.height, region.y1);

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const inside =
          px >= Math.max(0, region.x0) &&
          px < Math.min(cv.width, region.x1) &&
          py >= Math.max(0, region.y0) &&
          py < Math.min(cv.height, region.y1) &&
          (!covers || covers(px, py));

        let sr = 0;
        let sg = 0;
        let sb = 0;
        let sa = 0;
        if (inside) {
          const [r, g, b, a] = sample(px, py);
          sa = a;
          sr = r * a;
          sg = g * a;
          sb = b * a;
        }

        const i = (py * cv.width + px) * 4;
        const dr = cv.buf[i];
        const dg = cv.buf[i + 1];
        const db = cv.buf[i + 2];
        const da = cv.buf[i + 3];

        if (this.globalCompositeOperation === "source-over") {
          cv.buf[i] = sr + dr * (1 - sa);
          cv.buf[i + 1] = sg + dg * (1 - sa);
          cv.buf[i + 2] = sb + db * (1 - sa);
          cv.buf[i + 3] = sa + da * (1 - sa);
        } else {
          cv.buf[i] = dr * sa;
          cv.buf[i + 1] = dg * sa;
          cv.buf[i + 2] = db * sa;
          cv.buf[i + 3] = da * sa;
        }
      }
    }
  }
}

function intersect(a: RectClip, b: RectClip): RectClip {
  return {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  };
}

function toShimImage(src: ShimImage | ShimCanvas): ShimImage {
  if (src instanceof ShimCanvas) {
    return { width: src.width, height: src.height, data: src.toRGBA() };
  }
  return src;
}

/**
 * Install the shim as `globalThis.document.createElement("canvas")`.
 *
 * render.ts creates its offscreen canvases through `document.createElement`, which is the
 * one DOM call it is allowed (see the spec's Testability section). This gives it one.
 * Returns a restore function; call it in an `afterAll`.
 */
export function installShimDocument(): () => void {
  const g = globalThis as unknown as { document?: unknown };
  const had = "document" in g;
  const prev = g.document;
  g.document = {
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`[shim] only <canvas> is provided, got <${tag}>`);
      return new ShimCanvas(0, 0);
    },
    documentElement: {},
  };
  return () => {
    if (had) g.document = prev;
    else delete g.document;
  };
}

/** A synthetic, high-contrast stand-in for the paddy photograph. */
export function testTexture(w = 64, h = 64): ShimImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const check = ((x >> 3) + (y >> 3)) % 2 === 0;
      data[i] = check ? 240 : 20;
      data[i + 1] = check ? 200 : 60;
      data[i + 2] = check ? 90 : 30;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
