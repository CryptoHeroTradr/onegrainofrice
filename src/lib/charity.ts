import { GRAINS_PER_KG } from "@/config/site";

/** Stable shape the browser consumes, regardless of upstream availability. */
export type CharityDTO = {
  totalKg: number;
  fedToday: number;
  fedAllTime: number;
  nextMilestone: number;
  progressPercent: number;
  grainsDonated: number;
  /** true when this is the offline fallback, not live upstream data. */
  fallback: boolean;
};

export type PlayersDTO = {
  online: number;
  fallback: boolean;
};

export const grainsFromKg = (kg: number): number => Math.round(kg * GRAINS_PER_KG);

/** Used when the RiceDAO upstream is unreachable. Never a broken state. */
export const CHARITY_FALLBACK: CharityDTO = {
  totalKg: 377,
  fedToday: 233,
  fedAllTime: 1024,
  nextMilestone: 500,
  progressPercent: Math.round((377 / 500) * 100),
  grainsDonated: grainsFromKg(377),
  fallback: true,
};

export const PLAYERS_FALLBACK: PlayersDTO = { online: 0, fallback: true };
