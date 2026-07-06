import { NextResponse } from "next/server";
import { site } from "@/config/site";
import type { DaoOption, DaoProposalDTO } from "@/lib/dao";

/**
 * Same-origin DAO proxy. RiceDAO's proposals feed is wallet-gated (no public
 * read), so unless a PUBLIC feed URL is configured via RICEDAO_DAO_FEED this
 * returns the config's illustrative example (clearly flagged). If a public feed
 * is wired later, it's mapped to the same DTO with illustrative:false.
 * Revalidated every 60s.
 */
export const revalidate = 60;

const FEED = process.env.RICEDAO_DAO_FEED; // optional public DAO feed URL

function exampleDTO(): DaoProposalDTO {
  const ex = site.dao.example;
  const options = ex.options.map((o) => ({ ...o }));
  return {
    id: ex.id,
    question: ex.question,
    options,
    totalVotes: options.reduce((s, o) => s + o.votes, 0),
    illustrative: true,
  };
}

export async function GET() {
  if (!FEED) return NextResponse.json(exampleDTO());
  try {
    const res = await fetch(FEED, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error("upstream not ok");
    const raw = (await res.json()) as {
      id?: string;
      question?: string;
      title?: string;
      options?: { label: string; votes?: number; plate?: DaoOption["plate"] }[];
    };
    if (!raw.options?.length) throw new Error("no proposal");
    const palette: DaoOption["plate"][] = ["blue", "green", "red"];
    const options: DaoOption[] = raw.options.map((o, i) => ({
      label: o.label,
      votes: Number(o.votes) || 0,
      plate: o.plate ?? palette[i % palette.length],
    }));
    const dto: DaoProposalDTO = {
      id: raw.id ?? "live",
      question: raw.question ?? raw.title ?? "Active proposal",
      options,
      totalVotes: options.reduce((s, o) => s + o.votes, 0),
      illustrative: false,
    };
    return NextResponse.json(dto);
  } catch {
    return NextResponse.json(exampleDTO());
  }
}
