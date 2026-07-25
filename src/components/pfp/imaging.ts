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
