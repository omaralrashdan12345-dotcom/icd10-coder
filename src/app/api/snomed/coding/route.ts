import { NextResponse } from 'next/server';

import { codeNote } from '@/lib/snomed/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: string };
    const text = (body.text ?? '').trim();
    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (text.length > 8000) {
      return NextResponse.json({ error: 'text too long (max 8000 chars)' }, { status: 413 });
    }
    const result = await codeNote(text);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[api/snomed/coding]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'coding failed' }, { status: 500 });
  }
}
