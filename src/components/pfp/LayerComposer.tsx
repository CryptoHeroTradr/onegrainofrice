"use client";

// MODE 1 — layer-based PFP composer.
// Features: draggable/resizable/rotatable/flippable layers, per-layer eraser +
// restore masks, resizable canvas (expand/shrink), draggable uploaded photo
// (treated as a normal layer), background colour/gradient, PNG + ZIP + AI export.
// Pointer events unify mouse + touch so everything works on mobile.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import JSZip from "jszip";
import { C, SERIF } from "@/components/landing/ui";
import { PFP_ASSET_CATEGORIES, findAsset } from "./assets";
import {
  CANVAS_CSS,
  DEFAULT_CANVAS_SIZE,
  MIN_CANVAS_SIZE,
  type BgType,
  type GradientStop,
  type GradientType,
  type Layer,
} from "./types";
import {
  canvasToBlob,
  downloadBlob,
  downloadUrl,
  emojiDataUrl,
  fileToDataUrl,
  imageForAsset,
  loadImage,
} from "./imaging";
import { AiEnhanceModal } from "./AiEnhanceModal";
import { GeneratePfpModal } from "./GeneratePfpModal";
import { useGameWallet } from "@/components/WalletProvider";

// Runtime layer: shared Layer + the size it was added at (for the Scale slider)
// and an optional off-screen mask canvas (white = visible, black = erased).
interface ComposerLayer extends Layer {
  baseWidth: number;
  baseHeight: number;
  maskCanvas?: HTMLCanvasElement;
  maskCtx?: CanvasRenderingContext2D;
}

/** Serializable snapshot of the layer layout — saved alongside each generation. */
export function buildManifest(layers: ComposerLayer[]) {
  return [...layers]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((l) => ({
      name: l.name,
      kind: l.kind,
      src: l.src.startsWith("data:") ? "(inline image)" : l.src,
      x: Math.round(l.x),
      y: Math.round(l.y),
      width: Math.round(l.width),
      height: Math.round(l.height),
      rotation: l.rotation,
      flipX: l.flipX,
      flipY: l.flipY,
      zIndex: l.zIndex,
    }));
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

type Tool = "select" | "eraser";
type DragMode = "move" | "resize" | "rotate" | "crop";
interface DragState {
  mode: DragMode;
  id: string;
  startX: number;
  startY: number;
  orig: ComposerLayer;
}

const HANDLE = 11; // hit radius for handles (canvas px)

function deg2rad(d: number) {
  return (d * Math.PI) / 180;
}

// Pointer in a box's local space (un-rotated, relative to centre).
function toLocal(b: Box, px: number, py: number) {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const r = deg2rad(-b.rotation);
  const dx = px - cx;
  const dy = py - cy;
  return { lx: dx * Math.cos(r) - dy * Math.sin(r), ly: dx * Math.sin(r) + dy * Math.cos(r) };
}

function worldPoint(b: Box, lx: number, ly: number) {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const r = deg2rad(b.rotation);
  return { x: cx + lx * Math.cos(r) - ly * Math.sin(r), y: cy + lx * Math.sin(r) + ly * Math.cos(r) };
}

function corners(b: Box) {
  const w = b.width / 2;
  const h = b.height / 2;
  return [worldPoint(b, -w, -h), worldPoint(b, w, -h), worldPoint(b, w, h), worldPoint(b, -w, h)];
}

const GRADIENT_PRESETS: { name: string; stops: GradientStop[] }[] = [
  { name: "Golden Sunset", stops: [{ color: "#0A0805", stop: 0 }, { color: "#C9A84C", stop: 55 }, { color: "#FFD700", stop: 100 }] },
  { name: "Midnight", stops: [{ color: "#0A0805", stop: 0 }, { color: "#1A2A4A", stop: 100 }] },
  { name: "Fire", stops: [{ color: "#1A0000", stop: 0 }, { color: "#C9A84C", stop: 55 }, { color: "#FF4400", stop: 100 }] },
  { name: "Sacred", stops: [{ color: "#050305", stop: 0 }, { color: "#2D1B4E", stop: 55 }, { color: "#C9A84C", stop: 100 }] },
];

const COLOR_SWATCHES = ["#0A0805", "#C9A84C", "#FFFFFF", "#1A0F0A"];

export interface LayerComposerHandle {
  /** Add an external image (e.g. generated rice art) as an editable photo layer. */
  addImage: (src: string, name?: string) => void;
  /** Snapshot of the current layer layout (for saving alongside a generation). */
  getLayers: () => ReturnType<typeof buildManifest>;
  /** Flattened composition as a PNG data URL (used as an AI reference image). */
  getFlattened: () => string;
}

export const LayerComposer = forwardRef<LayerComposerHandle>(function LayerComposer(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const imgCache = useRef<Map<string, { img: HTMLImageElement; ready: boolean }>>(new Map());
  const idCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [canvasSize, setCanvasSize] = useState(DEFAULT_CANVAS_SIZE);
  const [sizeInput, setSizeInput] = useState("");
  const [layers, setLayers] = useState<ComposerLayer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lockAspect, setLockAspect] = useState(true);
  const [, forceTick] = useState(0);
  const redraw = useCallback(() => forceTick((t) => t + 1), []);

  // Tools
  const [tool, setTool] = useState<Tool>("select");
  const [eraserSize, setEraserSize] = useState(28);
  const [eraserRestore, setEraserRestore] = useState(false);
  const painting = useRef(false);

  // Background
  const [bgType, setBgType] = useState<BgType>("transparent");
  const [bgColor, setBgColor] = useState("#0A0805");
  const [gradientType, setGradientType] = useState<GradientType>("linear");
  const [gradientAngle, setGradientAngle] = useState(135);
  const [gradientStops, setGradientStops] = useState<GradientStop[]>([
    { color: "#0A0805", stop: 0 },
    { color: "#C9A84C", stop: 100 },
  ]);

  const drag = useRef<DragState | null>(null);

  // Crop tool
  const [cropMode, setCropMode] = useState(false);
  const cropRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // AI enhance modal
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSource, setAiSource] = useState("");

  // Generate New PFP modal
  const [genOpen, setGenOpen] = useState(false);
  const [genSource, setGenSource] = useState("");
  const [genLayers, setGenLayers] = useState<unknown[]>([]);
  const { walletAddress } = useGameWallet();

  const selected = layers.find((l) => l.id === selectedId) ?? null;

  // ── Image cache ────────────────────────────────────────────────────────────
  const ensureImage = useCallback(
    (src: string) => {
      let e = imgCache.current.get(src);
      if (!e) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        const entry = { img, ready: false };
        e = entry;
        imgCache.current.set(src, entry);
        img.onload = () => {
          entry.ready = true;
          redraw();
        };
        img.onerror = () => redraw();
        img.src = src;
      }
      return e;
    },
    [redraw],
  );

  const getScratch = useCallback((size: number) => {
    let c = scratchRef.current;
    if (!c) {
      c = document.createElement("canvas");
      scratchRef.current = c;
    }
    if (c.width !== size || c.height !== size) {
      c.width = size;
      c.height = size;
    }
    return c;
  }, []);

  // ── Background painting ──────────────────────────────────────────────────────
  const paintBackground = useCallback(
    (ctx: CanvasRenderingContext2D, size: number, forExport: boolean) => {
      if (bgType === "transparent") {
        if (!forExport) {
          // checkerboard so transparency is visible on screen only
          const s = 16;
          for (let y = 0; y < size; y += s) {
            for (let x = 0; x < size; x += s) {
              ctx.fillStyle = ((x / s + y / s) & 1) === 0 ? "#2a2622" : "#1b1814";
              ctx.fillRect(x, y, s, s);
            }
          }
        }
        return;
      }
      if (bgType === "color") {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, size, size);
        return;
      }
      // gradient
      let grad: CanvasGradient;
      if (gradientType === "linear") {
        const a = deg2rad(gradientAngle);
        const x1 = size / 2 - (Math.cos(a) * size) / 2;
        const y1 = size / 2 - (Math.sin(a) * size) / 2;
        const x2 = size / 2 + (Math.cos(a) * size) / 2;
        const y2 = size / 2 + (Math.sin(a) * size) / 2;
        grad = ctx.createLinearGradient(x1, y1, x2, y2);
      } else {
        grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      }
      [...gradientStops]
        .sort((s1, s2) => s1.stop - s2.stop)
        .forEach(({ color, stop }) => grad.addColorStop(Math.min(1, Math.max(0, stop / 100)), color));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    },
    [bgType, bgColor, gradientType, gradientAngle, gradientStops],
  );

  // ── Layer drawing (with flip + mask) ─────────────────────────────────────────
  const drawOneLayer = useCallback(
    (ctx: CanvasRenderingContext2D, l: ComposerLayer, img: HTMLImageElement | null, size: number) => {
      const paint = (c: CanvasRenderingContext2D) => {
        c.save();
        c.translate(l.x + l.width / 2, l.y + l.height / 2);
        c.rotate(deg2rad(l.rotation));
        c.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
        if (img) {
          c.drawImage(img, -l.width / 2, -l.height / 2, l.width, l.height);
        } else {
          c.fillStyle = "rgba(201,168,76,0.12)";
          c.fillRect(-l.width / 2, -l.height / 2, l.width, l.height);
        }
        c.restore();
      };

      if (l.maskCanvas && img) {
        const off = getScratch(size);
        const octx = off.getContext("2d");
        if (!octx) return;
        octx.clearRect(0, 0, size, size);
        paint(octx);
        octx.globalCompositeOperation = "destination-in";
        octx.drawImage(l.maskCanvas, 0, 0, size, size);
        octx.globalCompositeOperation = "source-over";
        ctx.drawImage(off, 0, 0);
      } else {
        paint(ctx);
      }
    },
    [getScratch],
  );

  // ── Full scene draw (used for both screen and export) ────────────────────────
  const drawScene = useCallback(
    (ctx: CanvasRenderingContext2D, size: number, opts: { only?: string; forExport?: boolean } = {}) => {
      ctx.clearRect(0, 0, size, size);
      if (!opts.only) paintBackground(ctx, size, !!opts.forExport);
      const ordered = layers
        .filter((l) => l.visible && (!opts.only || l.id === opts.only))
        .sort((a, b) => a.zIndex - b.zIndex);
      for (const l of ordered) {
        const e = ensureImage(l.src);
        drawOneLayer(ctx, l, e.ready ? e.img : null, size);
      }
    },
    [layers, paintBackground, drawOneLayer, ensureImage],
  );

  // On-screen render: scene + selection overlay + crop rect.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, canvasSize);

    if (selected && !cropMode && tool === "select") {
      const cs = corners(selected);
      ctx.save();
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(cs[0].x, cs[0].y);
      for (let i = 1; i < cs.length; i++) ctx.lineTo(cs[i].x, cs[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.gold;
      for (const p of cs) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, HANDLE - 3, 0, Math.PI * 2);
        ctx.fill();
      }
      const top = worldPoint(selected, 0, -selected.height / 2);
      const rot = worldPoint(selected, 0, -selected.height / 2 - 30);
      ctx.strokeStyle = C.gold;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(rot.x, rot.y);
      ctx.stroke();
      ctx.fillStyle = "#FFF6CE";
      ctx.beginPath();
      ctx.arc(rot.x, rot.y, HANDLE - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (cropMode && cropRect.current) {
      const r = cropRect.current;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, canvasSize, canvasSize);
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  });

  // ── Layer creation ───────────────────────────────────────────────────────────
  const nextId = () => `layer-${idCounter.current++}`;

  const addAsset = useCallback(
    async (assetId: string) => {
      const found = findAsset(assetId);
      if (!found) return;
      const src = await imageForAsset(found.asset.src, found.asset.emoji);
      ensureImage(src);

      const target = canvasSize * 0.4;
      let natW = target;
      let natH = target;
      try {
        const img = await loadImage(src);
        natW = img.naturalWidth || img.width || target;
        natH = img.naturalHeight || img.height || target;
      } catch {
        /* keep square footprint */
      }
      const scale = Math.min(target / natW, target / natH);
      const w = Math.max(1, Math.round(natW * scale));
      const h = Math.max(1, Math.round(natH * scale));
      const x = (canvasSize - w) / 2;
      const y =
        found.categoryId === "hats" ? 40 : found.categoryId === "bowls" ? canvasSize - h - 30 : (canvasSize - h) / 2;

      const id = nextId();
      setLayers((prev) => {
        const zIndex = (prev.length ? Math.max(...prev.map((l) => l.zIndex)) : 0) + 1;
        return [
          ...prev,
          {
            id,
            kind: found.categoryId === "hats" ? "hat" : "bowl",
            name: found.asset.name,
            src,
            x,
            y,
            width: w,
            height: h,
            baseWidth: w,
            baseHeight: h,
            rotation: 0,
            flipX: false,
            flipY: false,
            visible: true,
            zIndex,
          },
        ];
      });
      setSelectedId(id);
    },
    [canvasSize, ensureImage],
  );

  // Photo layer (upload / preset) — a normal, fully-transformable layer added at
  // the back. Fitted to cover the canvas, centred.
  const addPhoto = useCallback(
    async (src: string, name = "Photo") => {
      ensureImage(src);
      let w = canvasSize;
      let h = canvasSize;
      try {
        const img = await loadImage(src);
        const nw = img.naturalWidth || canvasSize;
        const nh = img.naturalHeight || canvasSize;
        const scale = Math.max(canvasSize / nw, canvasSize / nh); // cover
        w = Math.round(nw * scale);
        h = Math.round(nh * scale);
      } catch {
        /* default square */
      }
      const id = nextId();
      setLayers((prev) => {
        const zIndex = (prev.length ? Math.min(...prev.map((l) => l.zIndex)) : 0) - 1;
        return [
          ...prev,
          {
            id,
            kind: "photo",
            name,
            src,
            x: (canvasSize - w) / 2,
            y: (canvasSize - h) / 2,
            width: w,
            height: h,
            baseWidth: w,
            baseHeight: h,
            rotation: 0,
            flipX: false,
            flipY: false,
            visible: true,
            zIndex,
          },
        ];
      });
      setSelectedId(id);
    },
    [canvasSize, ensureImage],
  );

  const onUpload = useCallback(
    async (file?: File | null) => {
      if (!file) return;
      const src = await fileToDataUrl(file);
      await addPhoto(src, file.name.replace(/\.[^.]+$/, "") || "Photo");
    },
    [addPhoto],
  );

  // ── Pointer coords ───────────────────────────────────────────────────────────
  const pointerPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = canvasSize / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  };

  // ── Eraser / restore mask ────────────────────────────────────────────────────
  const ensureMask = useCallback(
    (l: ComposerLayer) => {
      if (l.maskCanvas && l.maskCtx) return l.maskCtx;
      const mc = document.createElement("canvas");
      mc.width = mc.height = canvasSize;
      const mctx = mc.getContext("2d")!;
      mctx.fillStyle = "white";
      mctx.fillRect(0, 0, canvasSize, canvasSize);
      // Attach to the live state object (preserved across {...l} spreads).
      l.maskCanvas = mc;
      l.maskCtx = mctx;
      return mctx;
    },
    [canvasSize],
  );

  const paintMask = useCallback(
    (x: number, y: number) => {
      if (!selected) return;
      const mctx = ensureMask(selected);
      // The layer is composited with the mask via destination-in, which keeps
      // layer pixels where the mask has ALPHA (not where it's white). So erasing
      // must remove alpha (destination-out); restoring adds opaque pixels back.
      if (eraserRestore) {
        mctx.globalCompositeOperation = "source-over";
        mctx.fillStyle = "rgba(255,255,255,1)";
      } else {
        mctx.globalCompositeOperation = "destination-out";
        mctx.fillStyle = "rgba(0,0,0,1)";
      }
      mctx.beginPath();
      mctx.arc(x, y, eraserSize / 2, 0, Math.PI * 2);
      mctx.fill();
      mctx.globalCompositeOperation = "source-over";
      redraw();
    },
    [selected, ensureMask, eraserRestore, eraserSize, redraw],
  );

  const hitHandle = (l: ComposerLayer, x: number, y: number): DragMode | null => {
    const rot = worldPoint(l, 0, -l.height / 2 - 30);
    if (Math.hypot(x - rot.x, y - rot.y) <= HANDLE + 3) return "rotate";
    for (const p of corners(l)) if (Math.hypot(x - p.x, y - p.y) <= HANDLE + 3) return "resize";
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = pointerPos(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

    if (tool === "eraser") {
      if (selected) {
        painting.current = true;
        paintMask(x, y);
      }
      return;
    }

    if (cropMode) {
      cropRect.current = { x, y, w: 0, h: 0 };
      drag.current = { mode: "crop", id: selectedId ?? "", startX: x, startY: y, orig: selected as ComposerLayer };
      redraw();
      return;
    }

    if (selected) {
      const h = hitHandle(selected, x, y);
      if (h) {
        drag.current = { mode: h, id: selected.id, startX: x, startY: y, orig: { ...selected } };
        return;
      }
    }
    const ordered = [...layers].filter((l) => l.visible).sort((a, b) => b.zIndex - a.zIndex);
    for (const l of ordered) {
      const { lx, ly } = toLocal(l, x, y);
      if (Math.abs(lx) <= l.width / 2 && Math.abs(ly) <= l.height / 2) {
        setSelectedId(l.id);
        drag.current = { mode: "move", id: l.id, startX: x, startY: y, orig: { ...l } };
        return;
      }
    }
    setSelectedId(null);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === "eraser") {
      if (painting.current) {
        const { x, y } = pointerPos(e);
        paintMask(x, y);
      }
      return;
    }
    const d = drag.current;
    if (!d) return;
    const { x, y } = pointerPos(e);

    if (d.mode === "crop") {
      const cx = Math.max(0, Math.min(d.startX, x));
      const cy = Math.max(0, Math.min(d.startY, y));
      const cw = Math.min(canvasSize, Math.max(d.startX, x)) - cx;
      const ch = Math.min(canvasSize, Math.max(d.startY, y)) - cy;
      cropRect.current = { x: cx, y: cy, w: cw, h: ch };
      redraw();
      return;
    }

    setLayers((prev) =>
      prev.map((l) => {
        if (l.id !== d.id) return l;
        const o = d.orig;
        if (d.mode === "move") return { ...l, x: o.x + (x - d.startX), y: o.y + (y - d.startY) };
        if (d.mode === "rotate") {
          const cx = o.x + o.width / 2;
          const cy = o.y + o.height / 2;
          const ang = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
          return { ...l, rotation: Math.round(ang) };
        }
        if (d.mode === "resize") {
          const { lx, ly } = toLocal(o, x, y);
          const cx = o.x + o.width / 2;
          const cy = o.y + o.height / 2;
          let nw: number;
          let nh: number;
          if (lockAspect) {
            const ratio = Math.max(Math.abs(lx) / (o.width / 2 || 1), Math.abs(ly) / (o.height / 2 || 1));
            nw = Math.max(24, o.width * ratio);
            nh = Math.max(24, o.height * ratio);
          } else {
            nw = Math.max(24, Math.abs(lx) * 2);
            nh = Math.max(24, Math.abs(ly) * 2);
          }
          return { ...l, width: nw, height: nh, x: cx - nw / 2, y: cy - nh / 2 };
        }
        return l;
      }),
    );
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    try {
      (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
    painting.current = false;
  };

  // ── Layer operations ─────────────────────────────────────────────────────────
  const patchSelected = useCallback(
    (patch: Partial<ComposerLayer>) => {
      if (!selectedId) return;
      setLayers((prev) => prev.map((l) => (l.id === selectedId ? { ...l, ...patch } : l)));
    },
    [selectedId],
  );

  const moveZ = useCallback(
    (dir: 1 | -1) => {
      if (!selected) return;
      const ordered = [...layers].sort((a, b) => a.zIndex - b.zIndex);
      const idx = ordered.findIndex((l) => l.id === selected.id);
      const swapWith = idx + dir;
      if (swapWith < 0 || swapWith >= ordered.length) return;
      const a = ordered[idx];
      const b = ordered[swapWith];
      setLayers((prev) =>
        prev.map((l) => (l.id === a.id ? { ...l, zIndex: b.zIndex } : l.id === b.id ? { ...l, zIndex: a.zIndex } : l)),
      );
    },
    [layers, selected],
  );

  const reorderTo = useCallback((dragId: string, targetId: string) => {
    if (dragId === targetId) return;
    setLayers((prev) => {
      const ordered = [...prev].sort((a, b) => a.zIndex - b.zIndex);
      const from = ordered.findIndex((l) => l.id === dragId);
      const to = ordered.findIndex((l) => l.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      return prev.map((l) => ({ ...l, zIndex: ordered.findIndex((o) => o.id === l.id) }));
    });
  }, []);

  const deleteLayer = useCallback(
    (id: string) => {
      setLayers((prev) => prev.filter((l) => l.id !== id));
      if (selectedId === id) setSelectedId(null);
      setCropMode(false);
    },
    [selectedId],
  );

  const toggleVisible = useCallback((id: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));
  }, []);

  const setScalePct = useCallback(
    (pct: number) => {
      if (!selected) return;
      const cx = selected.x + selected.width / 2;
      const cy = selected.y + selected.height / 2;
      const nw = (selected.baseWidth * pct) / 100;
      const nh = (selected.baseHeight * pct) / 100;
      patchSelected({ width: nw, height: nh, x: cx - nw / 2, y: cy - nh / 2 });
    },
    [selected, patchSelected],
  );

  const setWidthHeight = useCallback(
    (w: number, h: number) => {
      if (!selected) return;
      patchSelected({ width: Math.max(8, w), height: Math.max(8, h) });
    },
    [selected, patchSelected],
  );

  // ── Canvas resize (expand / shrink) ──────────────────────────────────────────
  const resizeCanvas = useCallback(
    (newSize: number) => {
      const clamped = Math.max(MIN_CANVAS_SIZE, Math.min(2048, Math.round(newSize)));
      const offset = (clamped - canvasSize) / 2;
      if (offset === 0) return;
      setLayers((prev) =>
        prev.map((l) => {
          const nl: ComposerLayer = { ...l, x: l.x + offset, y: l.y + offset };
          if (l.maskCanvas) {
            const nm = document.createElement("canvas");
            nm.width = nm.height = clamped;
            const nctx = nm.getContext("2d")!;
            nctx.fillStyle = "white";
            nctx.fillRect(0, 0, clamped, clamped);
            nctx.drawImage(l.maskCanvas, offset, offset);
            nl.maskCanvas = nm;
            nl.maskCtx = nctx;
          }
          return nl;
        }),
      );
      setCanvasSize(clamped);
    },
    [canvasSize],
  );

  // ── Crop (photo layers) ──────────────────────────────────────────────────────
  const enterCrop = useCallback(() => {
    if (!selected || selected.kind !== "photo") return;
    patchSelected({ rotation: 0, flipX: false, flipY: false });
    cropRect.current = null;
    setTool("select");
    setCropMode(true);
  }, [selected, patchSelected]);

  const applyCrop = useCallback(async () => {
    const r = cropRect.current;
    const base = layers.find((l) => l.id === selectedId && l.kind === "photo");
    if (!r || !base || r.w < 8 || r.h < 8) {
      setCropMode(false);
      return;
    }
    try {
      const img = await loadImage(base.src);
      const left = Math.max(r.x, base.x);
      const top = Math.max(r.y, base.y);
      const right = Math.min(r.x + r.w, base.x + base.width);
      const bottom = Math.min(r.y + r.h, base.y + base.height);
      const dw = Math.max(1, right - left);
      const dh = Math.max(1, bottom - top);
      const sx = ((left - base.x) / base.width) * img.naturalWidth;
      const sy = ((top - base.y) / base.height) * img.naturalHeight;
      const sw = (dw / base.width) * img.naturalWidth;
      const sh = (dh / base.height) * img.naturalHeight;
      const out = Math.round(Math.max(dw, dh));
      const c = document.createElement("canvas");
      c.width = c.height = out;
      const ctx = c.getContext("2d");
      if (ctx) {
        const scale = out / Math.max(dw, dh);
        const ox = (out - dw * scale) / 2;
        const oy = (out - dh * scale) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, ox, oy, dw * scale, dh * scale);
      }
      const newSrc = c.toDataURL("image/png");
      ensureImage(newSrc);
      patchSelected({ src: newSrc });
    } catch {
      /* ignore */
    }
    cropRect.current = null;
    setCropMode(false);
  }, [layers, selectedId, ensureImage, patchSelected]);

  // ── Export ───────────────────────────────────────────────────────────────────
  const flatten = useCallback(
    (only?: string) => {
      const c = document.createElement("canvas");
      c.width = c.height = canvasSize;
      const ctx = c.getContext("2d");
      if (ctx) drawScene(ctx, canvasSize, { only, forExport: true });
      return c;
    },
    [drawScene, canvasSize],
  );

  const exportPng = useCallback(() => {
    downloadUrl(flatten().toDataURL("image/png"), "pfp-ricedao.png");
  }, [flatten]);

  const exportAllLayers = useCallback(async () => {
    if (layers.length === 0) return;
    const zip = new JSZip();
    const ordered = [...layers].sort((a, b) => a.zIndex - b.zIndex);
    const manifest = { canvasSize, layers: [] as Record<string, unknown>[] };
    for (let i = 0; i < ordered.length; i++) {
      const l = ordered[i];
      const filename = `layer-${i}-${l.kind}.png`;
      const c = flatten(l.id);
      // eslint-disable-next-line no-await-in-loop
      const blob = await canvasToBlob(c);
      zip.file(filename, blob);
      manifest.layers.push({
        name: l.name,
        filename,
        x: l.x,
        y: l.y,
        width: l.width,
        height: l.height,
        rotation: l.rotation,
        flipX: l.flipX,
        flipY: l.flipY,
        zIndex: l.zIndex,
      });
    }
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, "pfp-layers.zip");
  }, [layers, canvasSize, flatten]);

  const openAi = useCallback(() => {
    setAiSource(flatten().toDataURL("image/png"));
    setAiOpen(true);
  }, [flatten]);

  const openGenerate = useCallback(() => {
    setGenSource(flatten().toDataURL("image/png"));
    setGenLayers(buildManifest(layers));
    setGenOpen(true);
  }, [flatten, layers]);

  const onAiResult = useCallback(
    (dataUrl: string) => {
      setAiOpen(false);
      ensureImage(dataUrl);
      const id = nextId();
      setLayers([
        {
          id,
          kind: "photo",
          name: "AI Enhanced",
          src: dataUrl,
          x: 0,
          y: 0,
          width: canvasSize,
          height: canvasSize,
          baseWidth: canvasSize,
          baseHeight: canvasSize,
          rotation: 0,
          flipX: false,
          flipY: false,
          zIndex: 0,
          visible: true,
        },
      ]);
      setSelectedId(id);
    },
    [canvasSize, ensureImage],
  );

  const layerList = useMemo(() => [...layers].sort((a, b) => b.zIndex - a.zIndex), [layers]);
  const scalePct = selected ? Math.round((selected.width / (selected.baseWidth || 1)) * 100) : 100;

  // Imperative API for embedders (the Rice Art Generator): drop a generated
  // image onto the canvas, read the layout, or grab the flattened composition
  // to use as an AI reference image.
  useImperativeHandle(
    ref,
    () => ({
      addImage: (src: string, name?: string) => {
        void addPhoto(src, name ?? "Image");
      },
      getLayers: () => buildManifest(layers),
      getFlattened: () => flatten().toDataURL("image/png"),
    }),
    [addPhoto, layers, flatten],
  );

  // Eraser cursor (scaled to the on-screen size of the brush).
  const cursorStyle: CSSProperties = useMemo(() => {
    if (tool !== "eraser") return {};
    const px = Math.max(6, Math.round((eraserSize * CANVAS_CSS) / canvasSize));
    const stroke = eraserRestore ? "%23C9A84C" : "white";
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${px}' height='${px}'><circle cx='${px / 2}' cy='${px / 2}' r='${px / 2 - 1}' fill='none' stroke='${stroke}' stroke-width='1.5'/></svg>`;
    return { cursor: `url("data:image/svg+xml,${svg}") ${px / 2} ${px / 2}, crosshair` };
  }, [tool, eraserSize, eraserRestore, canvasSize]);

  return (
    <div style={{ width: "100%" }}>
      <ComposerStyles />

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="pfp-toolbar">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(e) => onUpload(e.target.files?.[0])}
        />
        <button type="button" className="pfp-btn pfp-btn-gold" onClick={() => fileInputRef.current?.click()}>
          ⬆ Upload Photo
        </button>

        <span className="pfp-divider" />
        <button
          type="button"
          className="pfp-btn"
          onClick={() => setTool("select")}
          style={tool === "select" ? activeToggle : undefined}
        >
          ↖ Select
        </button>
        <button
          type="button"
          className="pfp-btn"
          onClick={() => {
            setTool("eraser");
            setCropMode(false);
          }}
          style={tool === "eraser" ? activeToggle : undefined}
        >
          ⌫ Erase
        </button>

        <div style={{ flex: 1 }} />
        <button type="button" className="pfp-btn pfp-btn-gold" onClick={exportPng}>
          ⬇ Export PFP
        </button>
        <button type="button" className="pfp-btn" onClick={exportAllLayers}>
          📦 Export All Layers
        </button>
        <button type="button" className="pfp-btn pfp-btn-glow" onClick={openAi}>
          ✨ AI Enhance
        </button>
        <button type="button" className="pfp-btn pfp-btn-gold" onClick={openGenerate}>
          🌟 Generate New PFP
        </button>
      </div>

      {/* ── Eraser toolbar ──────────────────────────────────────────────────── */}
      {tool === "eraser" && (
        <div className="pfp-subbar">
          <span style={{ color: C.gold }}>{eraserRestore ? "↩ Restore" : "⌫ Eraser"}</span>
          {!selected && <span style={{ color: "#e08c8c" }}>Select a layer first.</span>}
          <label className="pfp-inline">
            Size
            <input type="range" min={5} max={100} step={1} value={eraserSize} onChange={(e) => setEraserSize(Number(e.target.value))} />
            <span style={{ color: C.gold, width: 32 }}>{eraserSize}</span>
          </label>
          <button
            type="button"
            className="pfp-btn pfp-btn-sm"
            onClick={() => setEraserRestore((v) => !v)}
            style={eraserRestore ? activeToggle : undefined}
          >
            ↩ Restore Brush
          </button>
          <button type="button" className="pfp-btn pfp-btn-sm" onClick={() => setTool("select")}>
            Done Erasing
          </button>
        </div>
      )}

      {/* ── Canvas size controls ────────────────────────────────────────────── */}
      <div className="pfp-subbar">
        <span style={{ color: C.muted }}>
          Canvas Size: <b style={{ color: C.gold }}>{canvasSize}×{canvasSize}</b>
        </span>
        <button type="button" className="pfp-btn pfp-btn-sm" onClick={() => resizeCanvas(canvasSize + 64)}>+ 64px</button>
        <button type="button" className="pfp-btn pfp-btn-sm" onClick={() => resizeCanvas(canvasSize + 128)}>+ 128px</button>
        <button type="button" className="pfp-btn pfp-btn-sm" onClick={() => resizeCanvas(canvasSize + 256)}>+ 256px</button>
        <button type="button" className="pfp-btn pfp-btn-sm" onClick={() => resizeCanvas(canvasSize - 64)}>− 64px</button>
        <button type="button" className="pfp-btn pfp-btn-sm" onClick={() => resizeCanvas(DEFAULT_CANVAS_SIZE)}>Reset 512</button>
        <span style={{ color: C.muted, marginLeft: "0.25rem" }}>Custom:</span>
        <input
          type="number"
          className="pfp-num"
          min={MIN_CANVAS_SIZE}
          max={2048}
          step={1}
          placeholder={`${canvasSize}`}
          value={sizeInput}
          onChange={(e) => setSizeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && sizeInput) {
              resizeCanvas(Number(sizeInput));
              setSizeInput("");
            }
          }}
        />
        <button
          type="button"
          className="pfp-btn pfp-btn-sm"
          onClick={() => {
            if (sizeInput) {
              resizeCanvas(Number(sizeInput));
              setSizeInput("");
            }
          }}
        >
          Set
        </button>
      </div>

      {/* ── Main grid ───────────────────────────────────────────────────────── */}
      <div className="pfp-main">
        {/* Left: background + asset picker */}
        <div className="pfp-sidebar">
          <BackgroundControls
            bgType={bgType}
            setBgType={setBgType}
            bgColor={bgColor}
            setBgColor={setBgColor}
            gradientType={gradientType}
            setGradientType={setGradientType}
            gradientAngle={gradientAngle}
            setGradientAngle={setGradientAngle}
            gradientStops={gradientStops}
            setGradientStops={setGradientStops}
          />
          <AssetPicker onAdd={addAsset} />
        </div>

        {/* Center: canvas */}
        <div className="pfp-center">
          <div
            className="pfp-canvas-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onUpload(e.dataTransfer.files?.[0]);
            }}
          >
            <canvas
              ref={canvasRef}
              width={canvasSize}
              height={canvasSize}
              className="pfp-canvas"
              style={cursorStyle}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {layers.length === 0 && (
              <div className="pfp-canvas-hint">
                Upload a photo or pick a preset, then add hats & bowls. Set a background on the left.
              </div>
            )}
            {cropMode && (
              <div className="pfp-crop-bar">
                <span>Drag on the canvas to set the crop region.</span>
                <button type="button" className="pfp-btn pfp-btn-gold" onClick={applyCrop}>✓ Apply Crop</button>
                <button type="button" className="pfp-btn" onClick={() => setCropMode(false)}>Cancel</button>
              </div>
            )}
          </div>
        </div>

        {/* Right: layers + operations */}
        <div className="pfp-right">
          <LayerPanel
            layers={layerList}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggle={toggleVisible}
            onDelete={deleteLayer}
            onReorder={reorderTo}
          />
          <OperationsPanel
            selected={selected}
            scalePct={scalePct}
            onMoveUp={() => moveZ(1)}
            onMoveDown={() => moveZ(-1)}
            onRotate={(deg) => patchSelected({ rotation: deg })}
            onScale={setScalePct}
            onFlipH={() => selected && patchSelected({ flipX: !selected.flipX })}
            onFlipV={() => selected && patchSelected({ flipY: !selected.flipY })}
            onToggle={() => selected && toggleVisible(selected.id)}
            onDelete={() => selected && deleteLayer(selected.id)}
            onCrop={enterCrop}
          />
        </div>
      </div>

      {selected && (
        <TransformBar
          layer={selected}
          lockAspect={lockAspect}
          onLockAspect={setLockAspect}
          onChange={(patch) => patchSelected(patch)}
          onSetWH={setWidthHeight}
        />
      )}

      {aiOpen && (
        <AiEnhanceModal
          source={aiSource}
          layers={buildManifest(layers)}
          walletAddress={walletAddress}
          onClose={() => setAiOpen(false)}
          onUse={onAiResult}
        />
      )}

      {genOpen && (
        <GeneratePfpModal
          source={genSource}
          layers={genLayers}
          walletAddress={walletAddress}
          onClose={() => setGenOpen(false)}
        />
      )}
    </div>
  );
});

const activeToggle: CSSProperties = {
  background: C.gold,
  color: C.dark,
  borderColor: C.gold,
  fontWeight: 600,
};

// ── Background controls ────────────────────────────────────────────────────────
function BackgroundControls({
  bgType,
  setBgType,
  bgColor,
  setBgColor,
  gradientType,
  setGradientType,
  gradientAngle,
  setGradientAngle,
  gradientStops,
  setGradientStops,
}: {
  bgType: BgType;
  setBgType: (v: BgType) => void;
  bgColor: string;
  setBgColor: (v: string) => void;
  gradientType: GradientType;
  setGradientType: (v: GradientType) => void;
  gradientAngle: number;
  setGradientAngle: (v: number) => void;
  gradientStops: GradientStop[];
  setGradientStops: (v: GradientStop[]) => void;
}) {
  const setStop = (i: number, patch: Partial<GradientStop>) =>
    setGradientStops(gradientStops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStop = () => {
    if (gradientStops.length >= 4) return;
    setGradientStops([...gradientStops, { color: "#FFD700", stop: 50 }]);
  };
  const removeStop = (i: number) => {
    if (gradientStops.length <= 2) return;
    setGradientStops(gradientStops.filter((_, j) => j !== i));
  };

  return (
    <div className="pfp-bg">
      <div className="pfp-panel-title">🎨 Background</div>
      <div className="pfp-bg-types">
        {(["transparent", "color", "gradient"] as BgType[]).map((t) => (
          <button
            key={t}
            type="button"
            className="pfp-btn pfp-btn-sm"
            onClick={() => setBgType(t)}
            style={bgType === t ? activeToggle : undefined}
          >
            {t === "transparent" ? "□ None" : t === "color" ? "■ Color" : "▣ Gradient"}
          </button>
        ))}
      </div>

      {bgType === "color" && (
        <div className="pfp-bg-section">
          <label className="pfp-inline">
            <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
            Background Color
          </label>
          <div className="pfp-swatches">
            {COLOR_SWATCHES.map((c) => (
              <button key={c} type="button" className="pfp-swatch" style={{ background: c }} onClick={() => setBgColor(c)} title={c} />
            ))}
          </div>
        </div>
      )}

      {bgType === "gradient" && (
        <div className="pfp-bg-section">
          {gradientStops.map((s, i) => (
            <div key={i} className="pfp-inline">
              <input type="color" value={s.color} onChange={(e) => setStop(i, { color: e.target.value })} />
              <input
                type="number"
                className="pfp-num"
                min={0}
                max={100}
                value={s.stop}
                onChange={(e) => setStop(i, { stop: Number(e.target.value) })}
              />
              <span style={{ color: C.muted }}>%</span>
              {gradientStops.length > 2 && (
                <button type="button" className="pfp-icon" onClick={() => removeStop(i)} title="Remove stop">✕</button>
              )}
            </div>
          ))}
          {gradientStops.length < 4 && (
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={addStop}>+ Add Color Stop</button>
          )}

          <div className="pfp-bg-types" style={{ marginTop: "0.5rem" }}>
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={() => setGradientType("linear")} style={gradientType === "linear" ? activeToggle : undefined}>↗ Linear</button>
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={() => setGradientType("radial")} style={gradientType === "radial" ? activeToggle : undefined}>◎ Radial</button>
          </div>

          {gradientType === "linear" && (
            <label className="pfp-inline">
              Angle
              <input type="range" min={0} max={360} value={gradientAngle} onChange={(e) => setGradientAngle(Number(e.target.value))} />
              <span style={{ color: C.gold, width: 40 }}>{gradientAngle}°</span>
            </label>
          )}

          <div className="pfp-presets">
            {GRADIENT_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="pfp-preset"
                onClick={() => setGradientStops(p.stops.map((s) => ({ ...s })))}
                style={{
                  background: `linear-gradient(135deg, ${p.stops.map((s) => `${s.color} ${s.stop}%`).join(", ")})`,
                }}
                title={p.name}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Asset picker ───────────────────────────────────────────────────────────────
function AssetPicker({ onAdd }: { onAdd: (id: string) => void }) {
  const [cat, setCat] = useState(PFP_ASSET_CATEGORIES[0].id);
  const active = PFP_ASSET_CATEGORIES.find((c) => c.id === cat) ?? PFP_ASSET_CATEGORIES[0];
  return (
    <div className="pfp-assets-wrap">
      <div className="pfp-panel-title">Assets</div>
      <div className="pfp-cat-tabs">
        {PFP_ASSET_CATEGORIES.map((cdef) => (
          <button
            key={cdef.id}
            type="button"
            className="pfp-btn pfp-btn-sm"
            onClick={() => setCat(cdef.id)}
            style={cat === cdef.id ? activeToggle : undefined}
          >
            {cdef.label}
          </button>
        ))}
      </div>
      <div className="pfp-asset-grid">
        {active.assets.map((a) => (
          <button key={a.id} type="button" className="pfp-asset" onClick={() => onAdd(a.id)} title={a.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.src}
              alt={a.name}
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = emojiDataUrl(a.emoji);
              }}
            />
            <span>{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Layer panel ────────────────────────────────────────────────────────────────
function LayerPanel({
  layers,
  selectedId,
  onSelect,
  onToggle,
  onDelete,
  onReorder,
}: {
  layers: ComposerLayer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (dragId: string, targetId: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  return (
    <div className="pfp-layers">
      <div className="pfp-panel-title">Layers</div>
      {layers.length === 0 && <div className="pfp-empty">No layers yet.</div>}
      {layers.map((l) => (
        <div
          key={l.id}
          className="pfp-layer-row"
          draggable
          onDragStart={() => setDragId(l.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId) onReorder(dragId, l.id);
            setDragId(null);
          }}
          onClick={() => onSelect(l.id)}
          style={{
            borderColor: selectedId === l.id ? C.gold : "rgba(201,168,76,0.18)",
            background: selectedId === l.id ? "rgba(201,168,76,0.12)" : "transparent",
          }}
        >
          <span style={{ cursor: "grab", color: C.muted }}>⋮⋮</span>
          <span style={{ flex: 1, color: l.visible ? C.white : C.muted, fontSize: "0.82rem" }}>{l.name}</span>
          <button type="button" className="pfp-icon" onClick={(e) => { e.stopPropagation(); onToggle(l.id); }} title="Toggle visibility">
            {l.visible ? "👁" : "🚫"}
          </button>
          <button type="button" className="pfp-icon" onClick={(e) => { e.stopPropagation(); onDelete(l.id); }} title="Delete layer">🗑</button>
        </div>
      ))}
    </div>
  );
}

// ── Operations panel ───────────────────────────────────────────────────────────
function OperationsPanel({
  selected,
  scalePct,
  onMoveUp,
  onMoveDown,
  onRotate,
  onScale,
  onFlipH,
  onFlipV,
  onToggle,
  onDelete,
  onCrop,
}: {
  selected: ComposerLayer | null;
  scalePct: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRotate: (deg: number) => void;
  onScale: (pct: number) => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onCrop: () => void;
}) {
  return (
    <div className="pfp-ops">
      <div className="pfp-panel-title">Layer Operations</div>
      {!selected ? (
        <div className="pfp-empty">Select a layer to edit it.</div>
      ) : (
        <>
          <div className="pfp-op-row">
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={onMoveUp}>↑ Move Up</button>
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={onMoveDown}>↓ Move Down</button>
          </div>
          <div className="pfp-op-row">
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={onFlipH} style={selected.flipX ? activeToggle : undefined}>↔ Flip H</button>
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={onFlipV} style={selected.flipY ? activeToggle : undefined}>↕ Flip V</button>
          </div>
          <label className="pfp-slider-label">🔄 Rotate <span>{selected.rotation}°</span></label>
          <input type="range" min={-180} max={180} value={selected.rotation} onChange={(e) => onRotate(Number(e.target.value))} />
          <label className="pfp-slider-label">↔ Scale <span>{scalePct}%</span></label>
          <input type="range" min={50} max={200} value={Math.max(50, Math.min(200, scalePct))} onChange={(e) => onScale(Number(e.target.value))} />
          <div className="pfp-op-row">
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={onToggle}>👁 Toggle</button>
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={onDelete}>🗑 Delete</button>
          </div>
          {selected.kind === "photo" && (
            <button type="button" className="pfp-btn pfp-btn-sm" onClick={onCrop} style={{ width: "100%" }}>✂ Crop Photo</button>
          )}
        </>
      )}
    </div>
  );
}

// ── Bottom transform bar ───────────────────────────────────────────────────────
function TransformBar({
  layer,
  lockAspect,
  onLockAspect,
  onChange,
  onSetWH,
}: {
  layer: ComposerLayer;
  lockAspect: boolean;
  onLockAspect: (v: boolean) => void;
  onChange: (patch: Partial<ComposerLayer>) => void;
  onSetWH: (w: number, h: number) => void;
}) {
  const num = (v: number) => Math.round(v);
  const onW = (w: number) => (lockAspect ? onSetWH(w, w * (layer.height / (layer.width || 1))) : onSetWH(w, layer.height));
  const onH = (h: number) => (lockAspect ? onSetWH(h * (layer.width / (layer.height || 1)), h) : onSetWH(layer.width, h));
  return (
    <div className="pfp-transform">
      <Field label="X" value={num(layer.x)} onChange={(v) => onChange({ x: v })} />
      <Field label="Y" value={num(layer.y)} onChange={(v) => onChange({ y: v })} />
      <Field label="W" value={num(layer.width)} onChange={onW} />
      <Field label="H" value={num(layer.height)} onChange={onH} />
      <div className="pfp-transform-rot">
        <span>Rotation</span>
        <input type="range" min={-180} max={180} value={layer.rotation} onChange={(e) => onChange({ rotation: Number(e.target.value) })} />
        <input type="number" className="pfp-num" value={layer.rotation} onChange={(e) => onChange({ rotation: Number(e.target.value) })} />
      </div>
      <label className="pfp-lock">
        <input type="checkbox" checked={lockAspect} onChange={(e) => onLockAspect(e.target.checked)} />
        Lock Aspect
      </label>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="pfp-field">
      <span>{label}</span>
      <input type="number" className="pfp-num" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

// ── Scoped styles ──────────────────────────────────────────────────────────────
function ComposerStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
        .pfp-toolbar { display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center; margin-bottom:0.75rem; }
        .pfp-divider { width:1px; height:24px; background:rgba(201,168,76,0.3); margin:0 0.25rem; }
        .pfp-subbar {
          display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center; margin-bottom:0.75rem;
          padding:0.5rem 0.75rem; border:1px solid rgba(201,168,76,0.2); border-radius:10px; background:rgba(10,8,5,0.5);
          font-size:0.8rem; color:${C.white};
        }
        .pfp-inline { display:flex; align-items:center; gap:0.4rem; color:${C.white}; font-size:0.8rem; }
        .pfp-inline input[type=range] { accent-color:${C.gold}; }
        .pfp-btn {
          background: rgba(26,15,10,0.8); color:${C.white};
          border:1px solid rgba(201,168,76,0.4); border-radius:8px;
          padding:0.5rem 0.9rem; font-size:0.85rem; cursor:pointer;
          font-family:system-ui,sans-serif; transition:all .15s ease; white-space:nowrap;
        }
        .pfp-btn:hover { border-color:${C.gold}; color:${C.gold}; }
        .pfp-btn-sm { padding:0.4rem 0.6rem; font-size:0.78rem; }
        .pfp-btn-gold { background:${C.gold}; color:${C.dark}; border-color:${C.gold}; font-weight:600; }
        .pfp-btn-gold:hover { color:${C.dark}; background:#dcc06a; }
        .pfp-btn-glow { border-color:${C.gold}; color:${C.gold}; box-shadow:0 0 12px rgba(201,168,76,0.35); }

        .pfp-main { display:grid; grid-template-columns: 220px 1fr 240px; gap:1rem; align-items:start; }
        .pfp-center { display:flex; flex-direction:column; align-items:center; }
        .pfp-canvas-drop { position:relative; width:100%; max-width:${CANVAS_CSS}px; }
        .pfp-canvas {
          width:100%; aspect-ratio:1/1; max-width:${CANVAS_CSS}px; height:auto;
          background:${C.bg}; border:1px solid rgba(201,168,76,0.4); border-radius:12px;
          touch-action:none; display:block;
        }
        .pfp-canvas-hint {
          position:absolute; inset:12px; display:flex; align-items:center; justify-content:center;
          text-align:center; color:${C.muted}; font-size:0.9rem; pointer-events:none; padding:1rem;
        }
        .pfp-crop-bar {
          position:absolute; left:0; right:0; bottom:8px; display:flex; gap:0.5rem; flex-wrap:wrap;
          align-items:center; justify-content:center; background:rgba(10,8,5,0.85);
          padding:0.5rem; border-radius:8px; color:${C.white}; font-size:0.8rem;
        }

        .pfp-sidebar { border:1px solid rgba(201,168,76,0.2); border-radius:12px; padding:0.6rem; background:rgba(10,8,5,0.5); display:flex; flex-direction:column; gap:0.75rem; }
        .pfp-bg-types { display:flex; flex-wrap:wrap; gap:0.35rem; }
        .pfp-bg-section { display:flex; flex-direction:column; gap:0.5rem; margin-top:0.5rem; }
        .pfp-swatches { display:flex; gap:0.4rem; }
        .pfp-swatch { width:24px; height:24px; border-radius:6px; border:1px solid rgba(201,168,76,0.4); cursor:pointer; }
        .pfp-presets { display:flex; flex-direction:column; gap:0.35rem; margin-top:0.5rem; }
        .pfp-preset { border:1px solid rgba(201,168,76,0.3); border-radius:8px; padding:0.4rem; color:#fff; font-size:0.72rem; cursor:pointer; text-shadow:0 1px 2px rgba(0,0,0,0.7); }

        .pfp-cat-tabs { display:flex; gap:0.35rem; margin-bottom:0.5rem; flex-wrap:wrap; }
        .pfp-asset-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; max-height:360px; overflow-y:auto; }
        .pfp-asset {
          display:flex; flex-direction:column; align-items:center; gap:0.25rem;
          background:rgba(26,15,10,0.6); border:1px solid rgba(201,168,76,0.2);
          border-radius:8px; padding:0.4rem; cursor:pointer; transition:all .15s ease;
        }
        .pfp-asset:hover { border-color:${C.gold}; box-shadow:0 0 12px rgba(201,168,76,0.3); }
        .pfp-asset img { width:100%; aspect-ratio:1/1; object-fit:contain; background:rgba(0,0,0,0.25); border-radius:6px; }
        .pfp-asset span { color:${C.white}; font-size:0.66rem; text-align:center; line-height:1.2; }

        .pfp-right { display:flex; flex-direction:column; gap:1rem; }
        .pfp-layers, .pfp-ops, .pfp-bg, .pfp-assets-wrap { display:flex; flex-direction:column; }
        .pfp-layers, .pfp-ops { border:1px solid rgba(201,168,76,0.2); border-radius:12px; padding:0.75rem; background:rgba(10,8,5,0.5); }
        .pfp-panel-title { color:${C.gold}; font-family:${SERIF}; font-size:0.95rem; margin-bottom:0.5rem; }
        .pfp-empty { color:${C.muted}; font-size:0.8rem; }
        .pfp-layer-row {
          display:flex; align-items:center; gap:0.4rem; padding:0.4rem 0.5rem;
          border:1px solid rgba(201,168,76,0.18); border-radius:8px; margin-bottom:0.35rem; cursor:pointer;
        }
        .pfp-icon { background:transparent; border:none; cursor:pointer; font-size:0.9rem; padding:2px; color:${C.muted}; }
        .pfp-op-row { display:flex; gap:0.4rem; margin-bottom:0.5rem; }
        .pfp-op-row .pfp-btn { flex:1; }
        .pfp-slider-label { display:flex; justify-content:space-between; color:${C.white}; font-size:0.78rem; margin:0.5rem 0 0.2rem; }
        .pfp-slider-label span { color:${C.gold}; }
        .pfp-ops input[type=range] { width:100%; accent-color:${C.gold}; }

        .pfp-transform {
          display:flex; flex-wrap:wrap; gap:0.75rem; align-items:center; margin-top:1rem;
          border:1px solid rgba(201,168,76,0.25); border-radius:12px; padding:0.75rem 1rem; background:rgba(10,8,5,0.6);
        }
        .pfp-field, .pfp-lock { display:flex; align-items:center; gap:0.35rem; color:${C.white}; font-size:0.8rem; }
        .pfp-num {
          width:60px; background:rgba(0,0,0,0.35); border:1px solid rgba(201,168,76,0.35);
          color:${C.white}; border-radius:6px; padding:0.3rem 0.4rem; font-size:0.8rem;
        }
        .pfp-transform-rot { display:flex; align-items:center; gap:0.5rem; color:${C.white}; font-size:0.8rem; flex:1; min-width:200px; }
        .pfp-transform-rot input[type=range] { flex:1; accent-color:${C.gold}; }

        @media (max-width: 900px) {
          .pfp-main { grid-template-columns:1fr; }
          .pfp-sidebar { order:2; }
          .pfp-center { order:1; }
          .pfp-right { order:3; }
          .pfp-asset-grid { grid-template-columns:repeat(4,1fr); max-height:none; }
        }
        @media (max-width: 420px) {
          .pfp-asset-grid { grid-template-columns:repeat(3,1fr); }
        }
      `,
      }}
    />
  );
}
