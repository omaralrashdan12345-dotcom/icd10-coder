import { NextResponse } from 'next/server';

import { reverseLookup } from '@/lib/snomed/matcher';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = (searchParams.get('code') ?? '').trim();
  if (!code) return NextResponse.json({ hits: [] });
  return NextResponse.json({ hits: reverseLookup(code, 20) });
}
