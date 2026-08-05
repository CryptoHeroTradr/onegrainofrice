import { NextResponse } from "next/server";
import { CHARITY_FALLBACK, grainsFromKg, type CharityDTO } from "@/lib/charity";
import { readJson } from "@/lib/readJson";

/**
 * Same-origin server proxy for RiceDAO charity data. The browser only ever
 * calls /onegrainofrice/api/charity — this handler reaches the internal Express
 * server (RICEDAO_API_BASE, server-side only) so there are no cross-origin or
 * runtime third-party calls from the client. Cached + revalidated every 60s.
 */
export const revalidate = 60;

const API_BASE = process.env.RICEDAO_API_BASE ?? "http://127.0.0.1:1112";
const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export async function GET() {
  try {
    const [pantryRes, charityRes] = await Promise.all([
      fetch(`${API_BASE}/api/town/pantry`, { next: { revalidate: 60 } }),
      fetch(`${API_BASE}/api/charity/status`, { next: { revalidate: 60 } }),
    ]);
    if (!pantryRes.ok || !charityRes.ok) throw new Error("upstream not ok");

    const pantry = await readJson<Record<string, unknown>>(pantryRes);
    const charity = await readJson<Record<string, unknown>>(charityRes);

    const totalKg = num(pantry.currentRiceKg);
    const nextMilestone = num(charity.nextMilestone, CHARITY_FALLBACK.nextMilestone);
    const dto: CharityDTO = {
      totalKg,
      fedToday: num(pantry.totalFedToday),
      fedAllTime: num(pantry.totalFedAllTime),
      nextMilestone,
      progressPercent: Math.max(0, Math.min(100, Math.round(num(charity.progressPercent)))),
      grainsDonated: grainsFromKg(totalKg),
      fallback: false,
    };
    return NextResponse.json(dto);
  } catch {
    // Never surface a broken state to the user.
    return NextResponse.json(CHARITY_FALLBACK);
  }
}
