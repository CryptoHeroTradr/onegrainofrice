import { NextResponse } from "next/server";
import { readJson } from "@/lib/readJson";

/**
 * Same-origin proxy for the (public, read-only) RiceDAO town leaderboard, shown
 * as a community board next to the grain-catch game. Normalized to
 * { name, score }[]. The mini-game's own high score is session-only (there is no
 * writable score store to persist to). Revalidated every 60s; [] on failure.
 */
export const revalidate = 60;

const API_BASE = process.env.RICEDAO_API_BASE ?? "http://127.0.0.1:1112";

type Entry = { name: string; score: number };

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/api/town/leaderboard`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error("upstream not ok");
    const raw = await readJson<unknown>(res);
    const list = Array.isArray(raw) ? raw : [];
    const entries: Entry[] = list
      .map((r) => {
        const o = r as Record<string, unknown>;
        const name = String(o.name ?? o.username ?? o.wallet ?? "anon");
        const score = Number(o.score ?? o.kg ?? o.totalKg ?? o.xp ?? 0) || 0;
        return { name, score };
      })
      .slice(0, 10);
    return NextResponse.json(entries);
  } catch {
    return NextResponse.json([] as Entry[]);
  }
}
