// Minimal shim of RiceDAO's landing/ui — only the tokens the ported PFP
// components consume: the C color palette, the SERIF stack, and the API base.
//
// In RiceDAO, GAME_API pointed at the Express server. Here the PFP AI endpoints
// are Next route handlers mounted under the app basePath, so GAME_API IS the
// basePath and every `${GAME_API}/api/pfp/*` call resolves to those handlers
// (e.g. /api/pfp/status, the basePath being "" — see @/lib/basePath).

import { BASE_PATH } from "@/lib/basePath";

export const C = {
  bg: "#0A0805",
  gold: "#C9A84C",
  white: "#F5F0E8",
  muted: "#8B7355",
  green: "#4A7C3F",
  dark: "#1A0F0A",
} as const;

export const SERIF = "Georgia, 'Times New Roman', serif";

export const GAME_API = BASE_PATH;
