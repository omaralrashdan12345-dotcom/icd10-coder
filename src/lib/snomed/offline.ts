/**
 * Offline SNOMED coder — zero-LLM fallback for /api/snomed/coding.
 *
 * When every LLM provider is unreachable (or the pipeline throws), this module
 * still returns a valid {results, meta} payload:
 *   1. Segment the note into candidate clinical terms (punctuation/clause
 *      splitting + leading-filler stripping + negation-cue skipping).
 *   2. Match each segment with the embedded hybrid lexical matcher
 *      (BM25 + lexicon expansion incl. abbreviations like MI -> myocardial
 *      infarction + fuzzy) — same engine as /api/snomed/search.
 *   3. Gate auto-assignment on confidence (CONF_MIN = 0.5); below that the
 *      candidates are returned with chosenBy:'none' so the UI shows them for
 *      human review instead of guessing.
 *
 * Response shape is identical to the LLM pipeline (CodedTerm[] / CodingResult),
 * so the client needs no changes.
 */

import { search, subset } from './matcher';

import type { Candidate, CodingResult, CodedTerm } from './types';

const CONF_MIN = 0.5;
const MAX_TERMS = 24;

/** Tiers trusted for AUTO-assignment. 'partial' means not all query words matched —
 *  those candidates stay visible for human review but are never auto-chosen. */
const AUTO_TIERS = new Set(['exact-phrase', 'strong', 'expanded', 'fuzzy']);

/** Grammatical segments that should never reach the matcher. */
const STOPWORD_SEGMENTS = new Set([
  'and', 'or', 'the', 'with', 'for', 'from', 'but', 'was', 'were', 'has', 'had', 'have',
  'are', 'is', 'of', 'on', 'in', 'to', 'at', 'by', 'as', 'it', 'its', 'this', 'that',
  'his', 'her', 'their', 'my', 'our', 'your', 'also', 'any', 'all', 'per', 'via', 'due',
]);

/** Negation/assertion cues — segments starting with these are not auto-coded offline. */
const NEGATION_CUES = ['no ', 'not ', 'denies ', 'deny ', 'without ', 'negative for ', 'ruled out ', 'free of '];

/** Leading filler stripped before matching (does not change the verbatim `original`). */
const LEADING_FILLER = [
  'history of', 'hx of', 'h/o', 's/p', 'status post', 'complains of', 'c/o', 'complaining of',
  'reports', 'reported', 'presents with', 'present with', 'presenting with', 'known', 'suspected',
  'possible', 'probable', 'alleged', 'the', 'a', 'an', 'his', 'her', 'their', 'my',
];

function stripLeadingFiller(s: string): string {
  let out = s.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const low = out.toLowerCase();
    for (const f of LEADING_FILLER) {
      if (low.startsWith(`${f} `)) {
        out = out.slice(f.length + 1).trim();
        changed = true;
        break;
      }
    }
  }
  return out;
}

function isNegated(s: string): boolean {
  const low = `${s.toLowerCase()} `;
  return NEGATION_CUES.some((c) => low.startsWith(c));
}

/** Split a note into raw candidate segments without any model. */
export function segmentNote(text: string): string[] {
  const clauses = text
    .split(/[\n;.!?\r]+|,\s+(?:and\s+)?|\band\b\s+|\b(?:presented? with|presenting with|complains? of|complaining of|c\/o|reports|denies|suspect(?:ed)?)\b\s+/gi)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawClause of clauses) {
    if (out.length >= MAX_TERMS) break;
    let seg = stripLeadingFiller(rawClause);
    // strip demographic prefixes so symptoms surface as their own segment
    // ("7 yo old female presented with epigastric colicky pain" -> "epigastric colicky pain")
    seg = seg.replace(/^\d{1,3}\s*(?:yo|y\/o|years?[- ]old|yrs?[- ]old|years? of age)\b\s*/i, "").trim();
    seg = seg.replace(/^old\s+/i, "").trim();
    seg = seg.replace(/^(?:male|female|man|woman|boy|girl|patient|infant|child|baby)\b\s*/i, "").trim();
    seg = seg.replace(/^(?:with|and|the|of|for|in|on|at|to)\s+/i, "").trim();
    if (!seg) continue;
    // 2-char segments are allowed only when they look like abbreviations (MI, DM, CHF...)
    const isAbbrev = /^[A-Z]{2,5}$/.test(seg);
    if (seg.length < (isAbbrev ? 2 : 3) || seg.length > 60) continue;
    if (/^\d+(\.\d+)*$/.test(seg)) continue; // bare numbers/percentages
    if (!isAbbrev && STOPWORD_SEGMENTS.has(seg.toLowerCase())) continue;
    const key = seg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seg);
  }
  return out;
}

function categoryForTag(tag: string | undefined): CodedTerm['category'] {
  switch (tag) {
    case 'disorder':
    case 'situation':
      return 'diagnosis';
    case 'finding':
      return 'symptom';
    case 'procedure':
    case 'regime/therapy':
      return 'procedure';
    case 'product':
      return 'medication';
    case 'organism':
      return 'organism';
    default:
      return 'other';
  }
}

function roleForCategory(cat: CodedTerm['category']): CodedTerm['role'] {
  if (cat === 'diagnosis') return 'primary';
  if (cat === 'symptom' || cat === 'procedure') return 'secondary';
  return 'supplemental';
}

/**
 * Reconstruct the trust tier from the fields the matcher provably writes
 * (matchedOn / pt / fsn / synonyms). Fail-closed: a candidate is auto-assigned
 * only when its matched surface provably covers the whole query — anything
 * else is 'partial' (shown for review, never auto-coded).
 */
function deriveTier(query: string, c: Candidate): 'exact-phrase' | 'strong' | 'partial' {
  const norm = (s: string) => ' ' + s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const q = norm(query).trim();
  if (!q) return 'partial';
  const surfaces = [c.matchedOn, c.pt, c.fsn ?? '', ...c.synonyms].map(norm);
  if (surfaces.some((s) => s.includes(q))) return 'exact-phrase';
  const fold = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
  const qWords = q.split(' ').filter((w) => w.length > 1);
  const surfaceWords = new Set(surfaces.flatMap((s) => s.split(' ')));
  const covered = qWords.length > 0 && qWords.every((w) => surfaceWords.has(w) || surfaceWords.has(fold(w)));
  return covered ? 'strong' : 'partial';
}

/** Top candidate that qualifies for AUTO-assignment (trusted tier + confidence). */
function autoPick(query: string, candidates: Candidate[]): Candidate | null {
  const top = candidates[0];
  if (!top) return null;
  if (top.confidence < CONF_MIN) return null;
  if (!AUTO_TIERS.has(deriveTier(query, top))) return null;
  return top;
}

/**
 * Match a segment; if the full clause only produces a low-trust (partial) match,
 * retry its leading trigram/bigram ("cat scratch on right lower leg" -> "cat scratch")
 * and keep the first attempt whose top candidate qualifies for auto-assignment.
 */
function matchSegment(seg: string): Candidate[] {
  let candidates: Candidate[] = [];
  try {
    candidates = search(seg, 6);
  } catch {
    return [];
  }
  if (autoPick(seg, candidates)) return candidates;

  const tokens = seg.split(/\s+/);
  const attempts: string[] = [];
  if (tokens.length > 2) attempts.push(tokens.slice(0, 3).join(' '));
  if (tokens.length > 1) attempts.push(tokens.slice(0, 2).join(' '));
  for (const sub of attempts) {
    try {
      const subResults = search(sub, 6);
      if (autoPick(sub, subResults)) return subResults;
    } catch {
      /* keep original candidates */
    }
  }
  return candidates;
}

/** Code a note with zero network/LLM dependency. Always resolves — never throws. */
export async function codeNoteOffline(text: string): Promise<CodingResult> {
  const t0 = Date.now();
  const segments = segmentNote(text);
  const results: CodedTerm[] = [];

  for (const seg of segments) {
    const candidates = matchSegment(seg);
    const top = candidates[0];
    const tag = top?.tag;
    const cat = categoryForTag(tag);
    const negated = isNegated(seg);
    const auto = negated ? null : autoPick(seg, candidates);

    results.push({
      term: seg,
      original: seg,
      category: cat,
      role: roleForCategory(cat),
      candidates,
      // partial/fuzzy-junk and negated segments stay unassigned for human review
      chosen: auto ? auto.conceptId : null,
      chosenBy: auto ? 'lexical' : 'none',
    });
  }

  return {
    results,
    meta: {
      model: 'offline-lexical (no LLM)',
      llmExtractMs: 0,
      matchMs: Date.now() - t0,
      disambiguateMs: 0,
      disambiguated: 0,
      subset: {
        conceptCount: subset.meta.conceptCount,
        withIcdMap: subset.meta.withIcdMap,
        builtAt: subset.meta.builtAt,
      },
    },
  };
}
