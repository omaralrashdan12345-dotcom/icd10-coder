import { NextRequest, NextResponse } from "next/server";
import { ragSearch } from "@/lib/icd/rag";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/icd-search?q=diabetes+foot
 * Returns RAG retrieval results for a free-text query.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ ok: false, error: "q parameter is required" }, { status: 400 });
  }
  const outcome = await ragSearch(q, 5);
  return NextResponse.json({
    ok: true,
    query: q,
    nlm_online: outcome.nlm_ok,
    results: outcome.results,
  });
}
