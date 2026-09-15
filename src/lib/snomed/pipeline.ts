/**
 * Hybrid SNOMED coding pipeline (server-side only — uses z-ai-web-dev-sdk).
 *
 * Stage 1 — LLM extraction: clinical note (any language, incl. Arabic) ->
 *           normalized English clinical terms + roles.
 * Stage 2 — Local matching: each term is scored against the embedded SNOMED
 *           subset with the lexical matcher (offline, deterministic).
 * Stage 3 — LLM disambiguation: only for ambiguous/low-confidence matches the
 *           LLM re-picks among the top candidates (the expensive step stays rare).
 *
 * This mirrors how you would wire it into your ICD-10 agent: one LLM pass,
 * deterministic terminology matching, targeted LLM tie-breaks.
 */

import ZAI from 'z-ai-web-dev-sdk';

import type { Candidate, CodedTerm, CodingResult, SubsetFile } from './types';

import { search, subset } from './matcher';

import { installZaiConfigFromEnv } from '@/lib/zai';

// Z.ai credentials are materialized from env vars at cold boot (see @/lib/zai)
// so the Stage 1 / Stage 3 LLM calls work on serverless runtimes (Vercel /
// Netlify) where no `.z-ai-config` file can be shipped.
installZaiConfigFromEnv();

const MODEL = 'glm-4.6';

interface ExtractedTerm {
  term: string;
  original: string;
  category: CodedTerm['category'];
  role: CodedTerm['role'];
}

const EXTRACT_SYSTEM = `You are a clinical coding assistant. Extract codable clinical concepts from the note.
The note may be in English or Arabic (or mixed). Respond with STRICT JSON only, no markdown fences.

Schema:
{"terms":[{"term":"<normalized ENGLISH medical term, SNOMED-style, e.g. 'type 2 diabetes mellitus'>","original":"<short verbatim snippet from the note, in its original language>","category":"diagnosis|symptom|procedure|medication|organism|other","role":"primary|secondary|supplemental"}]}

Rules:
- "primary" = the main condition causing this encounter; "secondary" = co-morbidities and significant findings; "supplemental" = history, context, medications, organisms, procedures supporting the coding.
- Normalize synonyms to standard English medical terminology (e.g. "sugar disease" -> "diabetes mellitus").
- Extract at most 12 terms; skip non-clinical filler.
- Keep each "original" snippet <= 60 characters.`;

const DISAMBIG_SYSTEM = `You are a SNOMED CT coding expert. You will be given a numbered list of clinical terms, each with candidate SNOMED CT concepts. For EACH term, pick the candidate whose concept best matches the intended clinical meaning.
Respond with STRICT JSON only, no markdown fences:
{"picks":[{"index":1,"bestId":"<conceptId or null>","confidence":<0..1>}]}`
;

function safeJsonParse<T>(text: string): T | null {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** score gap / absolute level below which we ask the LLM to arbitrate */
const CONF_MIN = 0.5;
const GAP_MIN = 0.12;

function needsDisambiguation(cands: Candidate[]): boolean {
  if (cands.length === 0) return false;
  const top = cands[0];
  if (top.confidence < CONF_MIN) return true;
  if (cands.length > 1 && top.confidence - cands[1].confidence < GAP_MIN) return true;
  return false;
}

export async function codeNote(text: string): Promise<CodingResult> {
  const zai = await ZAI.create();

  const subsetInfo: CodingResult['meta']['subset'] = {
    conceptCount: subset.meta.conceptCount,
    withIcdMap: subset.meta.withIcdMap,
    builtAt: subset.meta.builtAt,
  };

  /* ---------------- Stage 1: extraction ---------------- */
  const t0 = Date.now();
  const extract = await zai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: text.slice(0, 4000) },
    ],
    temperature: 0.1,
  });
  const rawExtract = extract.choices[0]?.message?.content ?? '';
  const parsed = safeJsonParse<{ terms: ExtractedTerm[] }>(rawExtract);
  const llmExtractMs = Date.now() - t0;

  const terms: ExtractedTerm[] = (parsed?.terms ?? [])
    .filter((t) => t && typeof t.term === 'string' && t.term.trim())
    .slice(0, 12);

  /* ---------------- Stage 2: local matching ---------------- */
  const t1 = Date.now();
  const coded: CodedTerm[] = terms.map((t) => {
    const candidates = search(t.term, 6);
    const auto = candidates.length > 0 && !needsDisambiguation(candidates);
    return {
      term: t.term,
      original: String(t.original ?? '').slice(0, 80),
      category: (['diagnosis', 'symptom', 'procedure', 'medication', 'organism', 'other'].includes(t.category)
        ? t.category
        : 'other') as CodedTerm['category'],
      role: (['primary', 'secondary', 'supplemental'].includes(t.role) ? t.role : 'secondary') as CodedTerm['role'],
      candidates,
      chosen: auto ? candidates[0].conceptId : null,
      chosenBy: auto ? 'lexical' : 'none',
    };
  });
  const matchMs = Date.now() - t1;

  /* ---------------- Stage 3: LLM disambiguation (rare) ---------------- */
  const t2 = Date.now();
  let disambiguated = 0;
  const ambiguous = coded.filter((c) => c.chosenBy === 'none' && c.candidates.length > 0);
  if (ambiguous.length) {
    const prompt = ambiguous
      .map(
        (c, i) =>
          `${i + 1}. term: "${c.term}"\n   candidates:\n${c.candidates
            .map(
              (cd) =>
                `   - id:${cd.conceptId} | PT:"${cd.pt}" | tag:${cd.tag} | synonyms:[${cd.synonyms.slice(0, 4).join('; ')}]`
            )
            .join('\n')}`
      )
      .join('\n');

    const dis = await zai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: DISAMBIG_SYSTEM },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    });
    const raw = dis.choices[0]?.message?.content ?? '';
    const parsedPicks = safeJsonParse<{ picks?: Array<{ index: number; bestId: string | null; confidence?: number }> }>(raw);
    const list: Array<{ index: number; bestId: string | null }> = parsedPicks?.picks ?? [];

    for (const p of list) {
      const c = ambiguous[p.index - 1];
      if (!c) continue;
      if (p.bestId && c.candidates.some((cd) => cd.conceptId === p.bestId)) {
        c.chosen = p.bestId;
        c.chosenBy = 'llm';
        disambiguated++;
      }
    }
  }
  const disambiguateMs = Date.now() - t2;

  return {
    results: coded,
    meta: {
      model: MODEL,
      llmExtractMs,
      matchMs,
      disambiguateMs,
      disambiguated,
      subset: subsetInfo,
    },
  };
}

/** convenience re-export for the meta route */
export const subsetMeta: SubsetFile['meta'] = subset.meta;
