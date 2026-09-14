import { NextResponse } from 'next/server';

import { search } from '@/lib/snomed/matcher';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();
  const k = Math.min(30, Math.max(1, parseInt(searchParams.get('k') ?? '20', 10) || 20));
  if (!q) return NextResponse.json({ results: [] });
  return NextResponse.json({ results: search(q, k) });
}
