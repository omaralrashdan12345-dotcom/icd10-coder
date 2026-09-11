/**
 * Lightweight in-memory Vector DB over the built-in ICD-10 dataset.
 *
 * v0.3 — smarter offline retrieval:
 *  - BM25 ranking (replaces raw TF-IDF cosine) with field boosting
 *    (exact code prefix matches score highest, then description, then category)
 *  - Medical synonym expansion ("htn" -> hypertension, "t2dm" -> diabetes …)
 *  - Light English stemming (plurals / -ing / -ed) so "fractures" matches
 *    "fracture"
 *  - Trigram fuzzy matching as a fallback for typos and partial words
 *
 * For a production system you would swap this for FAISS / pgvector /
 * Pinecone. The interface (searchICDCodes) stays the same.
 */

import { BUILTIN_ICD10, type ICDEntry } from "./data";

const STOPWORDS = new Set([
  "the", "and", "of", "with", "for", "in", "to", "a", "an", "or", "by",
  "on", "at", "is", "was", "were", "be", "been", "being", "this", "that",
  "these", "those", "as", "from", "due", "not", "no", "other", "his", "her",
  "their", "she", "he", "it", "its", "also", "any", "all", "are", "has",
  "have", "had", "do", "does", "did", "will", "would", "can", "could",
  "patient", "came", "presents", "presented", "today", "yesterday", "morning",
  "admits", "admitted", "history", "known", "case", "visit", "encounter",
  "complaining", "c/o", "denies", "denied", "negative", "except", "sustained",
]);

/**
 * Medical synonym / abbreviation expansion map.
 * Query terms are expanded so "htn with ckd" also matches documents
 * containing "hypertension" / "chronic kidney disease".
 */
const SYNONYMS: Record<string, string[]> = {
  htn: ["hypertension", "blood", "pressure"],
  hypertension: ["blood", "pressure"],
  dm: ["diabetes", "mellitus"],
  dm2: ["diabetes", "mellitus", "type"],
  dm1: ["diabetes", "mellitus", "type"],
  t2dm: ["diabetes", "mellitus", "type"],
  t1dm: ["diabetes", "mellitus", "type"],
  diabetes: ["mellitus"],
  diabetic: ["diabetes"],
  ckd: ["chronic", "kidney", "disease"],
  esrd: ["end", "stage", "renal", "disease"],
  chf: ["heart", "failure"],
  hf: ["heart", "failure"],
  af: ["atrial", "fibrillation"],
  afib: ["atrial", "fibrillation"],
  cad: ["atherosclerotic", "coronary", "artery", "disease"],
  mi: ["myocardial", "infarction"],
  nstemi: ["myocardial", "infarction"],
  stemi: ["myocardial", "infarction"],
  copd: ["chronic", "obstructive", "pulmonary", "disease"],
  uti: ["urinary", "tract", "infection"],
  gerd: ["gastro", "esophageal", "reflux"],
  tia: ["transient", "ischemic", "attack"],
  cva: ["cerebral", "infarction", "stroke"],
  mva: ["motor", "vehicle", "accident"],
  sob: ["shortness", "breath", "dyspnea"],
  doe: ["dyspnea", "exertion"],
  gi: ["gastrointestinal"],
  uti_: ["urinary"],
  bph: ["benign", "prostatic", "hyperplasia"],
  oa: ["osteoarthritis"],
  ra: ["rheumatoid", "arthritis"],
  ptsd: ["post", "traumatic", "stress"],
  mdd: ["depressive", "disorder"],
  gad: ["anxiety", "generalized"],
  osa: ["sleep", "apnea", "obstructive"],
  bmi: ["body", "mass", "index"],
  nka: ["allergy"],
  nkda: ["allergy"],
  cx: ["contusion"],
  lac: ["laceration"],
  fx: ["fracture"],
  er: ["emergency"],
  ed: ["emergency"],
  pt: ["patient"],
  "s/p": ["status", "post"],
  abd: ["abdominal"],
  "n/v": ["nausea", "vomiting"],
  uri: ["upper", "respiratory", "infection"],
  aaa: ["aortic"],
  pe: ["pulmonary", "embolism"],
  dvt: ["thrombosis", "deep", "vein"],
  iud: [] as string[],
  tender: ["pain"],
  tenderness: ["pain"],
  erythema: ["cellulitis", "skin"],
  "high": ["elevated"],
  "elevated": ["high"],
};

/** Light suffix stemmer — good enough for retrieval, not linguistic. */
function stem(token: string): string {
  if (token.length <= 3) return token;
  let t = token;
  if (t.endsWith("ies") && t.length > 4) return t.slice(0, -3) + "y";
  if (t.endsWith("sses")) return t.slice(0, -2);
  if (t.endsWith("ses") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) return t.slice(0, -1);
  if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3);
  if (t.endsWith("ed") && t.length > 4) return t.slice(0, -2);
  return t;
}

function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9\s./-]/g, " ")
    .split(/[\s/]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  const out: string[] = [];
  for (const tok of raw) {
    const s = stem(tok);
    out.push(s);
    // synonym expansion
    const syn = SYNONYMS[tok] ?? SYNONYMS[s];
    if (syn) out.push(...syn.map((x) => (x.length > 2 ? stem(x) : x)));
  }
  return out;
}

interface DocVector {
  entry: ICDEntry;
  tf: Map<string, number>;
  norm: number;
  codeLower: string;
  codeStem: string;
}

let docs: DocVector[] = [];
let idf: Map<string, number> = new Map();
let avgLen = 1;
let built = false;

/** BM25 parameters */
const K1 = 1.4;
const B = 0.72;

function docTokens(entry: ICDEntry): string[] {
  // Field weighting: description tokens x3, category tokens x2, code x2
  return [
    ...tokenize(entry.code).flatMap((t) => [t, t]),
    ...tokenize(entry.description).flatMap((t) => [t, t, t]),
    ...tokenize(entry.category).flatMap((t) => [t, t]),
  ];
}

function buildIndex(): void {
  if (built) return;
  const N = BUILTIN_ICD10.length;
  const df = new Map<string, number>();
  let totalLen = 0;

  docs = BUILTIN_ICD10.map((entry) => {
    const tokens = docTokens(entry);
    totalLen += tokens.length;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    return {
      entry,
      tf,
      norm: Math.sqrt(tokens.length),
      codeLower: entry.code.toLowerCase(),
      codeStem: entry.code.replace(/[ADS]$/, "").toLowerCase(),
    };
  });

  for (const [term, count] of df) {
    idf.set(term, Math.log(1 + (N - count + 0.5) / (count + 0.5)));
  }
  avgLen = totalLen / Math.max(1, N);
  built = true;
}

/** Trigram fuzzy score between a query token and any document token ≥4 chars. */
function fuzzyBoost(docTokensSet: Set<string>, token: string): number {
  if (token.length < 4) return 0;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i <= s.length - 3; i++) set.add(s.slice(i, i + 3));
    return set;
  };
  const qg = grams(token);
  let best = 0;
  for (const dt of docTokensSet) {
    if (Math.abs(dt.length - token.length) > 3) continue;
    const dg = grams(dt);
    let inter = 0;
    for (const g of qg) if (dg.has(g)) inter++;
    const denom = qg.size + dg.size - inter || 1;
    const sim = inter / denom;
    if (sim > best) best = sim;
  }
  return best >= 0.55 ? best * 0.6 : 0; // only meaningful near-matches
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

  // Exact / prefix code detection (e.g. "E11.9", "s82", "W19")
  const codeQuery = query.trim().toLowerCase();
  const looksLikeCode = /^[a-z]\d/i.test(codeQuery.replace(/\s/g, ""));

  const qTf = new Map<string, number>();
  for (const t of qTokens) qTf.set(t, (qTf.get(t) ?? 0) + 1);

  const results: { entry: ICDEntry; score: number }[] = [];
  for (const doc of docs) {
    let score = 0;
    const docTokenSet = new Set(doc.tf.keys());
    let docLen = 0;
    for (const v of doc.tf.values()) docLen += v;

    for (const [t, f] of qTf) {
      const tf = doc.tf.get(t) ?? 0;
      if (tf > 0) {
        const idfW = idf.get(t) ?? 0;
        score +=
          idfW * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen / avgLen)))) * f;
      } else {
        score += fuzzyBoost(docTokenSet, t) * 0.4;
      }
    }

    // Exact code match gets a large boost; prefix matches get a medium boost.
    if (looksLikeCode) {
      const norm = codeQuery.replace(/\s/g, "");
      if (doc.codeLower === norm) score += 6;
      else if (doc.codeLower.startsWith(norm) || doc.codeStem.startsWith(norm)) score += 3;
    }

    if (score > 0.05) results.push({ entry: doc.entry, score });
  }

  // Normalize scores into a friendly 0..1 range
  const max = results.reduce((m, r) => Math.max(m, r.score), 0) || 1;
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map((r) => ({
    code: r.entry.code,
    description: r.entry.description,
    score: Math.min(1, r.score / max),
    source: "vector_db" as const,
    category: r.entry.category,
  }));
}
