/**
 * Lexical matcher over the embedded SNOMED CT subset.
 *
 * Deliberately dependency-free so the same logic can run:
 *  - server-side (API routes in this demo), and
 *  - client-side inside a PWA (your icd10-coder app keeps "works offline").
 *
 * Scoring is a compact BM25-flavoured ranker over three fields
 * (PT > synonym > FSN) with an exact-phrase bonus and prefix tolerance.
 */

import type { Candidate, SnomedConcept, SubsetFile } from './types';

import raw from '@/data/snomed-subset.json';

export const subset = raw as SubsetFile;
export const concepts: SnomedConcept[] = subset.concepts;

/* ------------------------------ tokenization ----------------------------- */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'had', 'has', 'have',
  'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s+\-]/g, ' ')
    .split(/[\s+\-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** light stemming for plural/possessive tolerance */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

/* --------------------------------- index --------------------------------- */

interface IndexedConcept {
  c: SnomedConcept;
  /** field -> Map<stemmedToken, tf> */
  fields: { pt: Map<string, number>; synonym: Map<string, number>; fsn: Map<string, number> };
  surfaces: { pt: string; synonym: string[]; fsn: string };
}

function fieldTokens(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokenize(text)) {
    const s = stem(t);
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return m;
}

const index: IndexedConcept[] = concepts.map((c) => ({
  c,
  fields: {
    pt: fieldTokens(c.pt),
    synonym: fieldTokens(c.synonyms.join(' ')),
    fsn: fieldTokens(c.fsn ?? c.pt),
  },
  surfaces: { pt: c.pt.toLowerCase(), synonym: c.synonyms.map((s) => s.toLowerCase()), fsn: (c.fsn ?? '').toLowerCase() },
}));

/** document frequency per token across PT+synonym surfaces (for IDF) */
const df = new Map<string, number>();
for (const ic of index) {
  const seen = new Set<string>();
  for (const t of ic.fields.pt.keys()) seen.add(t);
  for (const t of ic.fields.synonym.keys()) seen.add(t);
  for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
}

const N = index.length;
function idf(token: string): number {
  const n = df.get(token) ?? 0;
  // smoothed idf, floor keeps rare-token blowups bounded
  return Math.log(1 + (N - n + 0.5) / (n + 0.5));
}

const FIELD_WEIGHT = { pt: 3, synonym: 2, fsn: 1 } as const;
type FieldName = keyof typeof FIELD_WEIGHT;

/* -------------------------------- scoring -------------------------------- */

function scoreField(qTokens: string[], field: Map<string, number>, phrase: string | null, weight: number): { score: number; hits: number } {
  let score = 0;
  let hits = 0;
  for (const qt of qTokens) {
    const tf = field.get(qt) ?? field.get(stem(qt)) ?? 0;
    if (tf > 0) {
      hits++;
      score += idf(qt) * ((tf * 2.2) / (tf + 1.2)) * weight;
    } else {
      // prefix tolerance for longer tokens
      let pf = 0;
      for (const [k, v] of field) {
        if (k.startsWith(qt.slice(0, Math.max(4, qt.length - 1)))) {
          pf += v;
          break;
        }
      }
      if (pf > 0) score += idf(qt) * 0.45 * weight;
    }
  }
  if (phrase && phrase.length > 3) {
    // exact phrase bonus (already lowercase)
    score += weight * 1.8;
  }
  return { score, hits };
}

/** does the query appear as a contiguous phrase in the surface text? */
function hasPhrase(qNorm: string, surface: string): boolean {
  return surface.includes(qNorm);
}

/**
 * Search the subset. Returns top-k candidates ranked by lexical score.
 */
export function search(query: string, k = 8): Candidate[] {
  const qNorm = ' ' + query.toLowerCase().replace(/[^a-z0-9\s+\-]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const qStems = qTokens.map(stem);

  const scored: Candidate[] = [];

  for (const ic of index) {
    const fields: Array<[FieldName, Map<string, number>, string | null]> = [
      ['pt', ic.fields.pt, hasPhrase(qNorm.trim(), ic.surfaces.pt) ? qNorm.trim() : null],
      ['synonym', ic.fields.synonym, ic.surfaces.synonym.some((s) => hasPhrase(qNorm.trim(), s)) ? qNorm.trim() : null],
      ['fsn', ic.fields.fsn, ic.surfaces.fsn.includes(qNorm.trim()) ? qNorm.trim() : null],
    ];

    let best = { score: 0, hits: 0, field: 'pt' as FieldName, matchedOn: ic.surfaces.pt };
    for (const [name, ft, phrase] of fields) {
      const { score, hits } = scoreField(qStems, ft, phrase, FIELD_WEIGHT[name]);
      if (score > best.score) {
        best = {
          score,
          hits,
          field: name,
          matchedOn:
            name === 'pt' ? ic.c.pt : name === 'fsn' ? ic.c.fsn ?? ic.c.pt : ic.surfaces.synonym.find((s) => hasPhrase(qNorm.trim(), s)) ?? ic.c.synonyms[0] ?? ic.c.pt,
        };
      }
    }
    if (best.score <= 0) continue;

    // coverage: fraction of query tokens matched (any field) — guards against
    // single-token flukes outranking full-phrase matches
    const anyHit = qStems.some((t) => ic.fields.pt.has(t) || ic.fields.synonym.has(t) || ic.fields.fsn.has(t));
    const coverage =
      qStems.filter((t) => ic.fields.pt.has(t) || ic.fields.synonym.has(t) || ic.fields.fsn.has(t)).length / qStems.length;
    if (!anyHit) continue;

    const finalScore = best.score * (0.55 + 0.45 * coverage);
    scored.push({
      conceptId: ic.c.id,
      pt: ic.c.pt,
      fsn: ic.c.fsn,
      tag: ic.c.tag,
      synonyms: ic.c.synonyms,
      icd10cm: ic.c.icd10cm,
      score: Math.round(finalScore * 100) / 100,
      confidence: 0, // filled after ranking below
      matchedOn: best.matchedOn,
      matchedField: best.field,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k);
  // squash to 0..1 confidence (calibrated-ish: lexical scores rarely exceed ~14)
  for (const c of top) c.confidence = Math.max(0.05, Math.min(0.99, c.score / 12));
  return top;
}

/* ------------------------------ reverse lookup --------------------------- */

export interface ReverseHit {
  concept: SnomedConcept;
  target: { code: string; name: string };
}

/** Find SNOMED concepts whose ICD-10-CM map target matches `code` (exact or prefix). */
export function reverseLookup(code: string, limit = 20): ReverseHit[] {
  const q = code.trim().toUpperCase();
  if (!q) return [];
  const hits: ReverseHit[] = [];
  for (const c of concepts) {
    for (const t of c.icd10cm) {
      const C = t.code.toUpperCase();
      if (C === q || C.startsWith(q)) {
        hits.push({ concept: c, target: t });
        break;
      }
    }
    if (hits.length >= limit) break;
  }
  // also allow matching by category letter range (e.g. "E11" matches "E11.9")
  if (hits.length === 0 && q.length >= 3) {
    for (const c of concepts) {
      for (const t of c.icd10cm) {
        if (t.code.toUpperCase().replace('.', '').startsWith(q.replace('.', ''))) {
          hits.push({ concept: c, target: t });
          break;
        }
      }
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** All ICD-10-CM targets present in the subset (for reverse-lookup suggestions). */
export function allIcdTargets(): Array<{ code: string; name: string; conceptId: string; pt: string }> {
  const out: Array<{ code: string; name: string; conceptId: string; pt: string }> = [];
  for (const c of concepts) {
    for (const t of c.icd10cm) out.push({ code: t.code, name: t.name, conceptId: c.id, pt: c.pt });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
