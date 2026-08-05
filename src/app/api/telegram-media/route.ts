// GET /api/telegram-media — proxy to the RiceDAO game server's gallery feed,
// with a blocklist so specific media never appear anywhere on this site (the
// carousel AND the /memes gallery both read this endpoint), even though they're
// still in the Telegram group. The file/thumb streaming sub-paths are proxied
// straight through by the next.config.ts rewrites; only this list endpoint is
// filtered here.
//
// Ordering is upstream's — newest first. This endpoint used to hoist every Pop
// Culture item to the front of the unfiltered feed, which meant the ~94 of them
// filled the first four pages and anything newly posted to Telegram landed on
// page 4: the meme sync looked broken when it was in fact ingesting within
// seconds of a post. Pop Culture is still one chip away on the filter bar.

import { type NextRequest, NextResponse } from "next/server";
import { readJson } from "@/lib/readJson";

export const dynamic = "force-dynamic";

const ORIGIN = process.env.MEMES_API_ORIGIN ?? "http://127.0.0.1:1112";

// Media ids to NEVER show (broken / unwanted). Add ids here to hide them.
const BLOCKED_IDS = new Set<string>(["cmr43vial00aao295899t1bf1"]);

interface Media {
  id?: string;
}

const EMPTY = { media: [], categories: [], total: 0, page: 1, totalPages: 1 };

const allowed = (m: Media) => !(m.id && BLOCKED_IDS.has(m.id));

export async function GET(req: NextRequest) {
  let res: Response;
  try {
    res = await fetch(`${ORIGIN}/api/telegram-media${req.nextUrl.search}`, {
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(EMPTY, { status: 502 });
  }
  if (!res.ok) return NextResponse.json(EMPTY, { status: res.status });

  const data = await readJson<{ media?: Media[] }>(res);
  if (Array.isArray(data.media)) data.media = data.media.filter(allowed);
  return NextResponse.json(data);
}
