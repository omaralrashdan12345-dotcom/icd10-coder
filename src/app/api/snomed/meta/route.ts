import { NextResponse } from 'next/server';

import { subset } from '@/lib/snomed/matcher';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ meta: subset.meta });
}
