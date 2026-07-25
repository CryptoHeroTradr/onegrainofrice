// Catalog of layerable PFP assets — hats and bowls only, pointing at the real
// art in /public/pfp-assets. Placeholder/generated assets were removed.
//
// onegrainofrice adaptation: every public src is wrapped in asset() so it
// resolves under the app basePath (/onegrainofrice/pfp-assets/…). loadImage()
// receives these already-prefixed URLs and does NOT prefix again; data:/blob:
// URLs (uploads, AI results) pass through asset() untouched.

import { asset } from "@/lib/asset";
import type { PresetAvatar } from "./types";

export interface CatalogAsset {
  id: string;
  name: string;
  src: string;
  emoji: string;
}

export interface CatalogCategory {
  id: "hats" | "bowls";
  label: string;
  assets: CatalogAsset[];
}

export const PFP_ASSET_CATEGORIES: CatalogCategory[] = [
  {
    id: "hats",
    label: "🎩 Hats",
    assets: [
      { id: "hat-conical", name: "Conical Hat", src: asset("/pfp-assets/hats/hat-conical2.png"), emoji: "👒" },
      // NB: catalog spec said hat-connical.png (double-n) — that file doesn't
      // exist; using the real hat-conical.png that does.
      { id: "hat-farmer", name: "Farmer Hat", src: asset("/pfp-assets/hats/hat-conical.png"), emoji: "👒" },
      // New hats
      { id: "hat-bamboo-green", name: "Bamboo Rice Hat", src: asset("/pfp-assets/hats/hat-bamboo-green.png"), emoji: "🌿" },
      { id: "hat-conical-worn", name: "Worn Conical", src: asset("/pfp-assets/hats/hat-conical-worn.png"), emoji: "👒" },
      { id: "hat-conical-woven", name: "Woven Conical", src: asset("/pfp-assets/hats/hat-conical-woven.png"), emoji: "👒" },
      { id: "hat-straw-wide", name: "Wide Straw Hat", src: asset("/pfp-assets/hats/hat-straw-wide.png"), emoji: "🌾" },
      { id: "hat-conical-gold", name: "Golden Conical", src: asset("/pfp-assets/hats/hat-conical-gold.png"), emoji: "✨" },
      { id: "hat-cowboy-straw", name: "Straw Cowboy", src: asset("/pfp-assets/hats/hat-cowboy-straw.png"), emoji: "🤠" },
      { id: "hat-boater", name: "Boater Hat", src: asset("/pfp-assets/hats/hat-boater.png"), emoji: "🎩" },
      { id: "hat-conical-black", name: "Shadow Conical", src: asset("/pfp-assets/hats/hat-conical-black.png"), emoji: "🖤" },
      { id: "hat-conical-rattan", name: "Rattan Conical", src: asset("/pfp-assets/hats/hat-conical-rattan.png"), emoji: "🏮" },
      // Pinned to the bottom of the panel
      { id: "hat-cap", name: "Rice Cap", src: asset("/pfp-assets/hats/hat-cap.png"), emoji: "🧢" },
      { id: "hat-tophat", name: "Top Hat", src: asset("/pfp-assets/hats/hat-tophat.png"), emoji: "🎩" },
    ],
  },
  {
    id: "bowls",
    label: "🍚 Bowls",
    assets: [
      { id: "bowl-golden", name: "Golden Bowl", src: asset("/pfp-assets/bowls/bowl-golden.png"), emoji: "🌟" },
      { id: "bowl-diamond", name: "Diamond Bowl", src: asset("/pfp-assets/bowls/bowl-diamond.png"), emoji: "💎" },
    ],
  },
];

// Lookup: assetId → { asset, categoryId } for layer creation.
export function findAsset(assetId: string):
  | { asset: CatalogAsset; categoryId: CatalogCategory["id"] }
  | null {
  for (const cat of PFP_ASSET_CATEGORIES) {
    const found = cat.assets.find((a) => a.id === assetId);
    if (found) return { asset: found, categoryId: cat.id };
  }
  return null;
}

export const PRESET_AVATARS: PresetAvatar[] = [
  { id: "farmer", name: "Farmer", emoji: "🧑‍🌾", bg: "#3C5A2E" },
  { id: "elder", name: "Elder", emoji: "🧓", bg: "#5A4A2E" },
  { id: "warrior", name: "Warrior", emoji: "🥷", bg: "#3A3A4A" },
  { id: "villager", name: "Villager", emoji: "🧑", bg: "#4A3A2A" },
];
