import { NextResponse } from "next/server";
import { aiEnabled } from "@/lib/pfp/openai";

// Lets the PFP UI gate its AI features. Reflects whether OPENAI_API_KEY is set
// on the server — the key itself never leaves the server.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ aiEnabled });
}
