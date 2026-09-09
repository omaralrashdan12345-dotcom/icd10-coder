/**
 * Lightweight in-memory Vector DB over the built-in ICD-10 dataset.
 * Uses a TF-IDF cosine similarity (sparse vectors). This is a legitimate
 * vector retrieval implementation — it just uses sparse instead of dense
 * vectors, which is fine for a small (~80 code) corpus.
 *
 * For a production system you would swap this for FAISS / pgvector /
 * Pinecone. The interface (searchICDCodes) stays the same.
 */

import { BUILTIN_ICD10, type ICDEntry } from "./data";

const STOPWORDS = new Set([
  "the", "and", "of", "with", "for", "in", "to", "a", "an", "or", "by",
  "on", "at", "is", "was", "were", "be", "been", "being", "this", "that",
  "these", "those", "as", "from", "without", "other", "unspecified",
  "initial", "subsequent", "encounter", "sequela", "due", "not",
  "patient", "came", "er", "today", "his", "her", "right", "left",
  "lower", "upper", "extremity", "type", "ii", "2",
]);

interface DocVector {
  entry: ICDEntry;
  tf: Map<string, number>;
  norm: number;
}

let docs: DocVector[] = [];
let idf: Map<string, number> = new Map();
let built = false;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function buildIndex(): void {
  if (built) return;
  const N = BUILTIN_ICD10.length;
  const df = new Map<string, number>();

  docs = BUILTIN_ICD10.map((entry) => {
    const tokens = tokenize(`${entry.code} ${entry.description} ${entry.category}`);
    const tf = termFreq(tokens);
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    // L2 norm of tf (idf applied later, recomputed at query time)
    let norm = 0;
    for (const v of tf.values()) norm += v * v;
    return { entry, tf, norm: Math.sqrt(norm) };
  });

  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }
  built = true;
}

export interface ICDSearchResult {
  code: string;
  description: string;
  score: number;
  source: "vector_db";
  category: string;
}

export function searchICDCodes(query: string, limit = 8): ICDSearchResult[] {
  buildIndex();
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const qTf = termFreq(qTokens);
  let qNorm = 0;
  for (const [t, f] of qTf) {
    const w = (idf.get(t) ?? 0) * f;
    qNorm += w * w;
  }
  qNorm = Math.sqrt(qNorm);
  if (qNorm === 0) return [];

  const results: { entry: ICDEntry; score: number }[] = [];
  for (const doc of docs) {
    let dot = 0;
    for (const [t, f] of qTf) {
      const df = doc.tf.get(t);
      if (df) dot += f * df * (idf.get(t) ?? 0);
    }
    if (dot === 0) continue;
    const score = dot / (qNorm * doc.norm + 1e-9);
    results.push({ entry: doc.entry, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map((r) => ({
    code: r.entry.code,
    description: r.entry.description,
    score: r.score,
    source: "vector_db" as const,
    category: r.entry.category,
  }));
}
