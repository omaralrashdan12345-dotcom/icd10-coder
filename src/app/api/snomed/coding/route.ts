import { NextResponse } from 'next/server';

import { codeNoteOffline } from '@/lib/snomed/offline';
import { codeNote } from '@/lib/snomed/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/snomed/coding — SNOMED CT coding with an offline safety net.
 *
 * 1. Normal path: hybrid LLM pipeline (LLM extract -> lexical match -> LLM tie-break).
 * 2. If the pipeline throws OR no provider is configured, fall back to the
 *    zero-LLM offline coder (segment + lexical match + confidence gate).
 *    The response shape is identical, so the UI needs no changes — the meta.model
 *    field tells you which engine served the request.
 */
export async function POST(req: Request) {
  let text = '';
  try {
    const body = (await req.json()) as { text?: string };
    text = (body.text ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });
  if (text.length > 8000) return NextResponse.json({ error: 'text too long (max 8000 chars)' }, { status: 413 });

  try {
    const result = await codeNote(text);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[api/snomed/coding] LLM pipeline unavailable — offline fallback engaged:', e);
    const offline = await codeNoteOffline(text);
    offline.meta.model = 'offline-lexical (LLM unavailable — fallback)';
    return NextResponse.json(offline);
  }
}
