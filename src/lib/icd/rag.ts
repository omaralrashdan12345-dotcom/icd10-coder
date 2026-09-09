/**
 * Unified RAG search: tries NLM API first, falls back to the in-memory
 * Vector DB. Returns merged, deduplicated results.
 */

import { searchNLM, type NLMResult } from "./nlm";
import { searchICDCodes, type ICDSearchResult } from "./vector";

export interface RAGResult {
  code: string;
  description: string;
  score: number;
  source: "nlm" | "vector_db" | "builtin";
  category?: string;
}

export interface RAGSearchOutcome {
  results: RAGResult[];
  nlm_ok: boolean;
  nlm_used: boolean;
}

/**
 * Run a RAG search for a clinical note. We extract candidate search terms
 * (short noun phrases) from the note, query both NLM and the vector DB,
 * and return merged unique results sorted by score.
 */
export async function ragSearch(clinicalNote: string, maxTerms = 3): Promise<RAGSearchOutcome> {
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

  const merged = Array.from(byCode.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  return {
    results: merged,
    nlm_ok: flatNlm.length > 0,
    nlm_used: flatNlm.length > 0,
  };
}

/**
 * Extract candidate search terms from a clinical note.
 * Strategy: split on common delimiters, take the longest noun-ish phrases
 * (3+ words), and also include any ICD-10-style code references (e.g. "E11.9").
 *
 * This is a lightweight NER stand-in. For production, replace with a
 * clinical NER model (scispaCy, Med7, etc.).
 */
export function extractSearchTerms(text: string): string[] {
  const codes = text.match(/\b[A-EG-NPS-Z]\d{2}(\.\w{1,4})?\b/g) ?? [];
  const phrases = text
    .replace(/\s+/g, " ")
    .split(/[,.;:()\n]/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 2 && s.length >= 4 && s.length <= 60);
  const lower = text.toLowerCase();
  // Pull out condition keywords we care about
  const keywordHits: string[] = [];
  const patterns = [
    "diabetes", "hypertension", "asthma", "copd", "ckd", "wound", "laceration",
    "contusion", "fracture", "pain", "fever", "cough", "headache", "abdominal",
    "cat scratch", "dog bite", "insect bite", "burn", "fall", "ulcer",
  ];
  for (const p of patterns) {
    if (lower.includes(p)) keywordHits.push(p);
  }
  return [...new Set([...codes, ...keywordHits, ...phrases])];
}
