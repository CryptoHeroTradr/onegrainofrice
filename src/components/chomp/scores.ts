"use client";

/**
 * Local high scores, so the attract screen has something to show and a run has
 * something to beat.
 *
 * This is NOT the leaderboard. The leaderboard is Phase 7: a real table in
 * data/chomp.db behind /api/chomp/*, with server-side validation. This is five
 * rows in localStorage on one device, and it is deliberately the cheapest thing
 * that makes an attract screen worth looking at. When Phase 7 lands, this stays —
 * the arcade convention is a local board and a world board side by side, and the
 * local one is the only board a first-time player is ever on.
 *
 * Debug runs (`?level=N`) never reach here; see recordScore's caller.
 */

import { useSyncExternalStore } from "react";

const KEY = "chomp:scores";
const MAX_ROWS = 5;

export interface ScoreRow {
  score: number;
  level: number;
  /** Epoch ms. Display only — never fed to the simulation, which has no clock. */
  at: number;
}

function isRow(v: unknown): v is ScoreRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.score === "number" &&
    Number.isFinite(r.score) &&
    typeof r.level === "number" &&
    Number.isFinite(r.level)
  );
}

/**
 * The parsed board is CACHED, and the cache is what makes useScores() safe: a
 * useSyncExternalStore snapshot must be referentially stable between changes, and
 * a function that parses JSON on every call returns a new array every time and
 * spins React forever. The cache is dropped on write and nowhere else.
 */
let cached: ScoreRow[] | null = null;
const listeners = new Set<() => void>();
const EMPTY: ScoreRow[] = [];

/** Top rows, highest first. Always returns an array, whatever is in storage. */
export function readScores(): ScoreRow[] {
  if (typeof window === "undefined") return EMPTY;
  if (cached) return cached;
  cached = parseScores();
  return cached;
}

function parseScores(): ScoreRow[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRow)
      .map((r) => ({ score: Math.floor(r.score), level: Math.floor(r.level), at: r.at ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ROWS);
  } catch {
    // Corrupt or blocked storage must not take the attract screen down with it.
    return [];
  }
}

export function bestScore(): number {
  return readScores()[0]?.score ?? 0;
}

/**
 * File a finished run. Returns the position it took (1-based) or 0 if it did not
 * make the table — the game-over card uses that to decide whether to celebrate.
 */
export function recordScore(score: number, level: number, at: number): number {
  if (typeof window === "undefined" || score <= 0) return 0;
  // A COPY. readScores() hands back the cache itself, and sorting or pushing into
  // that would mutate the snapshot React is holding — which is exactly the bug
  // useSyncExternalStore cannot see and will happily render stale around.
  const rows = readScores().slice();
  rows.push({ score, level, at });
  rows.sort((a, b) => b.score - a.score);
  const kept = rows.slice(0, MAX_ROWS);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    /* storage blocked — the run still counted on screen, just not tomorrow */
  }
  cached = kept;
  listeners.forEach((l) => l());
  const place = kept.findIndex((r) => r.score === score && r.level === level && r.at === at);
  return place < 0 ? 0 : place + 1;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The board, for React. Renders empty on the server and fills in on hydration. */
export function useScores(): ScoreRow[] {
  return useSyncExternalStore(subscribe, readScores, () => EMPTY);
}
