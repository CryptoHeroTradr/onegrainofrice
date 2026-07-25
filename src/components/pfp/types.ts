// Shared types + constants for the $RICE PFP generator.

/** Default internal canvas resolution (px); also the on-screen CSS size. */
export const DEFAULT_CANVAS_SIZE = 512;
/** Smallest the canvas can shrink to. */
export const MIN_CANVAS_SIZE = 256;
/** Fixed on-screen display width of the canvas (CSS px), capped responsively. */
export const CANVAS_CSS = 512;

export type LayerKind = "photo" | "hat" | "bowl";

export interface Layer {
  id: string;
  kind: LayerKind;
  name: string;
  /** Image source — a /public URL or a data: URL (uploads, crops, AI results). */
  src: string;
  x: number; // top-left X in canvas coord space
  y: number; // top-left Y
  width: number;
  height: number;
  rotation: number; // degrees, about the layer centre
  flipX: boolean;
  flipY: boolean;
  zIndex: number;
  visible: boolean;
}

export interface PresetAvatar {
  id: string;
  name: string;
  emoji: string;
  /** Optional real sprite; falls back to an emoji-rendered avatar. */
  src?: string;
  bg: string;
}

// ── Background ────────────────────────────────────────────────────────────────
export type BgType = "transparent" | "color" | "gradient";
export type GradientType = "linear" | "radial";

export interface GradientStop {
  color: string;
  stop: number; // 0–100
}
