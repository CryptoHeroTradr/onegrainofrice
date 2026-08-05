import { NextResponse } from "next/server";
import { PLAYERS_FALLBACK, type PlayersDTO } from "@/lib/charity";
import { readJson } from "@/lib/readJson";

/** Same-origin proxy for RiceDAO online player count. Revalidated every 60s. */
export const revalidate = 60;

const API_BASE = process.env.RICEDAO_API_BASE ?? "http://127.0.0.1:1112";

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/api/town/players`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error("upstream not ok");
    const data = await readJson<unknown>(res);
    const online = Array.isArray(data) ? data.length : 0;
    const dto: PlayersDTO = { online, fallback: false };
    return NextResponse.json(dto);
  } catch {
    return NextResponse.json(PLAYERS_FALLBACK);
  }
}
