/**
 * Unified RAG search: tries NLM API first, falls back to the in-memory
 * Vector DB. Returns merged, deduplicated results.
 *
 * v0.3: smarter term extraction — chronic-condition vocabulary, external
 * cause mechanisms, negation awareness, and ICD-code detection.
 */

import { searchNLM, type NLMResult } from "./nlm";
import { searchICDCodes, type ICDSearchResult } from "./vector";
import { CHRONIC_CONDITION_MATCHERS } from "./chronic-conditions";
import { keywordPresentNotNegated } from "./validation";

export interface RAGResult {
  code: string;
  description: string;
  score: number;
  source: "nlm" | "vector_db" | "builtin";
  category?: string;
}

/** Words too generic to be useful as a single-token search term. */
const TERM_STOPWORDS = new Set([
  "the", "and", "for", "with", "without", "patient", "history", "male", "female",
  "year", "years", "old", "presents", "presented", "denies", "complains", "note",
  "today", "diagnosis", "acute", "chronic", "left", "right", "bilateral",
]);

export interface RAGSearchOutcome {
  results: RAGResult[];
  nlm_ok: boolean;
  nlm_used: boolean;
}

/**
 * Run a RAG search for a clinical note. We extract candidate search terms
 * (short noun phrases + condition keywords), query both NLM and the vector
 * DB, and return merged unique results sorted by score.
 */
export async function ragSearch(clinicalNote: string, maxTerms = 4): Promise<RAGSearchOutcome> {
  const terms = extractSearchTerms(clinicalNote).slice(0, maxTerms);

  const nlmPromises = terms.map((t) => searchNLM(t, 5).catch(() => [] as NLMResult[]));
  const nlmResults: NLMResult[][] = await Promise.all(nlmPromises);
  const flatNlm: NLMResult[] = nlmResults.flat();

  const vectorResults: ICDSearchResult[] = terms.flatMap((t) => searchICDCodes(t, 5));

  // Merge & dedupe by code, keep best score
  const byCode = new Map<string, RAGResult>();
  for (const r of flatNlm) {
    const existing = byCode.get(r.code);
    if (!existing || r.score > existing.score) {
      byCode.set(r.code, { ...r, source: "nlm" });
    }
  }
  for (const r of vectorResults) {
    const existing = byCode.get(r.code);
    if (!existing || r.score > existing.score) {
      byCode.set(r.code, {
        code: r.code,
        description: r.description,
        score: r.score,
        source: "vector_db",
        category: r.category,
      });
    }
  }

  const merged = Array.from(byCode.values()).sort((a, b) => b.score - a.score).slice(0, 12);
  return {
    results: merged,
    nlm_ok: flatNlm.length > 0,
    nlm_used: flatNlm.length > 0,
  };
}

/** External-cause mechanism keywords for retrieval hints. */
const MECHANISM_PATTERNS = [
  "cat scratch", "cat bite", "dog bite", "animal bite", "insect bite", "snake bite",
  "fall", "fell", "stair", "ladder", "motor vehicle", "car accident", "bicycle",
  "burn", "scald", "hot water", "fire", "electric", "poisoning", "overdose",
  "gunshot", "stab", "struck by", "crushed", "drowning", "choking",
];

/**
 * Extract candidate search terms from a clinical note.
 * Strategy (negation-aware):
 *  1. explicit ICD-10-style code references (e.g. "E11.9")
 *  2. documented chronic-condition keywords (from the shared matcher library)
 *  3. documented external-cause mechanism keywords
 *  4. symptom patterns
 *  5. longest noun-ish phrases
 */
export function extractSearchTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const codes = text.match(/\b[A-EG-NPS-Z]\d{2}(\.\w{1,4})?\b/g) ?? [];

  // Chronic conditions that are actually mentioned (not negated)
  const conditionTerms: string[] = [];
  for (const cc of CHRONIC_CONDITION_MATCHERS) {
    const hit = cc.keywords.find((k) => keywordPresentNotNegated(lower, k));
    if (hit) conditionTerms.push(hit);
  }

  // Mechanism keywords (not negated)
  const mechanismTerms = MECHANISM_PATTERNS.filter((p) => keywordPresentNotNegated(lower, p));

  // Symptom vocabulary
  const symptomPatterns = [
    "chest pain", "abdominal pain", "headache", "fever", "cough", "shortness of breath",
    "dyspnea", "dizziness", "syncope", "diarrhea", "vomiting", "nausea", "fatigue",
    "wound", "laceration", "contusion", "fracture", "pain", "ulcer", "swelling",
  ];
  const symptomTerms = symptomPatterns.filter((p) => keywordPresentNotNegated(lower, p));

  const phrases = text
    .replace(/\s+/g, " ")
    .split(/[,.;:()\n]/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 3 || s.length > 60) return false;
      const words = s.split(/\s+/).filter(Boolean);
      // Multi-word phrases are always eligible. A single word is eligible only
      // when it is not a stopword — otherwise medication/condition lookups like
      // "metformin" or "atorvastatin" were silently dropped and returned zero
      // results from /api/icd-search.
      if (words.length >= 2) return true;
      return words.length === 1 && !TERM_STOPWORDS.has(words[0].toLowerCase());
    });

  const extracted = [
    ...new Set([
      ...codes,
      ...conditionTerms,
      ...mechanismTerms,
      ...symptomTerms,
      ...phrases,
    ]),
  ];
  // Never return nothing for a non-empty query — fall back to the raw trimmed
  // text so a single unfamiliar token still reaches the matcher.
  if (extracted.length === 0) {
    const q = text.trim();
    if (q) extracted.push(q);
  }
  return extracted;
}
