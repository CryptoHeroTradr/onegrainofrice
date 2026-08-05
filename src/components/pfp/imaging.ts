// Browser-only canvas helpers for the PFP composer: image loading, emoji-based
// placeholders (so every asset renders even if its PNG is missing), file → data
// URL, and download helpers. All functions touch the DOM (client-side only).

import type { PresetAvatar } from "./types";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

/** Render an emoji to a PNG data URL — used as a placeholder when art is absent. */
export function emojiDataUrl(
  emoji: string,
  opts: { size?: number; bg?: string } = {},
): string {
  const size = opts.size ?? 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  if (opts.bg && opts.bg !== "transparent") {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.font = `${Math.floor(size * 0.58)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, size / 2, size * 0.54);
  return c.toDataURL("image/png");
}

/** Resolve an asset src to a guaranteed-loadable URL (real art, or emoji fallback). */
export async function imageForAsset(src: string, emoji: string): Promise<string> {
  try {
    await loadImage(src);
    return src;
  } catch {
    return emojiDataUrl(emoji);
  }
}

/** Emoji avatar on a coloured background — preset base layers. */
export function presetAvatarDataUrl(preset: PresetAvatar): string {
  return emojiDataUrl(preset.emoji, { size: 512, bg: preset.bg });
}

/** Read an uploaded file as a data URL (kept in layer state for persistence). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * The upload ceiling, in bytes of encoded data URL.
 *
 * WHY A CEILING AT ALL. nginx's `client_max_body_size` defaults to 1 MB, and a
 * request over it is rejected by the proxy with an HTML error page — the app
 * never sees it, so no amount of server-side handling can help. This site's own
 * vhost carried that default, which made every real photo posted to
 * /api/pfp/generate fail with a 413 from 2026-08-02 until it was found on
 * 2026-08-05. Raising the limit fixes this host; capping the payload fixes the
 * generator on ANY host, including whatever it is deployed behind next.
 *
 * 900 kB leaves ~10% for the JSON envelope (`{"imageBase64":"…","prompt":…}`),
 * the headers, and the base64 padding, under a 1 MB floor.
 */
export const MAX_UPLOAD_BYTES = 900_000;

/**
 * Encode a canvas as a data URL guaranteed to fit `maxBytes`, giving up as
 * little as possible on the way down.
 *
 * The ladder, in order of what it costs:
 *  1. **PNG.** Lossless, keeps alpha. Almost always over the cap for a photo
 *     (a 1024px photographic PNG is 1.5–2.5 MB) and almost always under it for
 *     the studio's flat, few-colour compositions — so the cheap case stays cheap.
 *  2. **JPEG at falling quality.** A 1024px photo lands around 150–250 kB at
 *     q0.85 with no loss of RESOLUTION, which matters more here than a little
 *     chroma: the model is being handed a reference, not a master.
 *  3. **Halve the long edge and start again.** Only reached by something
 *     genuinely enormous, and better than failing to send anything.
 *
 * Alpha is composited onto white before any lossy pass, because JPEG has no
 * alpha channel and the browser's default is to fill it with black — a
 * transparent studio canvas would otherwise come back as a black rectangle.
 */
export function boundedUploadDataUrl(
  canvas: HTMLCanvasElement,
  maxBytes = MAX_UPLOAD_BYTES,
): string {
  const png = canvas.toDataURL("image/png");
  if (png.length <= maxBytes) return png;

  let source = canvas;
  // Three halvings is 1024 → 128px; nothing survives being sent smaller than
  // that usefully, so the last attempt is returned whatever its size and the
  // upload is allowed to fail loudly rather than silently sending a thumbnail.
  for (let pass = 0; pass < 4; pass++) {
    const flat = onWhite(source);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const jpeg = flat.toDataURL("image/jpeg", quality);
      if (jpeg.length <= maxBytes) return jpeg;
    }
    const half = scaleCanvas(source, 0.5);
    if (!half) break;
    source = half;
  }
  return onWhite(source).toDataURL("image/jpeg", 0.4);
}

/** Composite onto white — JPEG has no alpha and the browser's fill is black. */
function onWhite(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

function scaleCanvas(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement | null {
  const w = Math.max(1, Math.round(canvas.width * factor));
  const h = Math.max(1, Math.round(canvas.height * factor));
  if (w === canvas.width && h === canvas.height) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, w, h);
  return c;
}

/**
 * Read a file and re-encode it for upload, capped to `maxSize` on its long edge
 * and to `MAX_UPLOAD_BYTES` on the wire.
 *
 * Re-drawing through a canvas is required before anything is sent to the image
 * API: the far side needs a format it accepts and a truthful content type, and
 * an arbitrary camera file is neither. PNG is preferred and JPEG is the fallback
 * when PNG will not fit — the server reads the actual type out of the data URL
 * (`lib/pfp/openai.ts`) rather than assuming, so both arrive correctly labelled.
 */
export async function fileToPngDataUrl(file: File, maxSize = 1024): Promise<string> {
  const src = await fileToDataUrl(file);
  const img = await loadImage(src);
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, w, h);
  return boundedUploadDataUrl(c);
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
