/**
 * NLM Clinical Tables API client.
 * Docs: https://clinicaltables.nlm.nih.gov/apidoc.html
 *
 * Endpoint: https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search
 * Returns up to N matching ICD-10-CM codes for a free-text query.
 *
 * Used as the primary RAG source; the in-memory Vector DB is the fallback.
 */

const NLM_BASE = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search";

export interface NLMResult {
  code: string;
  description: string;
  score: number;
  source: "nlm";
}

export async function searchNLM(
  query: string,
  limit = 8,
  timeoutMs = 4000
): Promise<NLMResult[]> {
  const url = `${NLM_BASE}?terms=${encodeURIComponent(query)}&max=${limit}&cf=code,name`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as [number, string[], string[][]];
    // NLM returns [total_count, column_names, rows]
    if (!Array.isArray(data) || data.length < 3) return [];
    const rows = data[2] ?? [];
    const out: NLMResult[] = [];
    rows.forEach((row, idx) => {
      if (!Array.isArray(row) || row.length < 2) return;
      const [code, name] = row;
      if (typeof code === "string" && typeof name === "string") {
        // NLM returns ranked results; assign a descending score
        out.push({
          code,
          description: name,
          score: 1 - idx * 0.05,
          source: "nlm",
        });
      }
    });
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up a specific ICD-10 code by exact code value (validation).
 * Returns the official description if found, otherwise null.
 */
export async function lookupCodeByCode(
  code: string,
  timeoutMs = 3000
): Promise<NLMResult | null> {
  const url = `${NLM_BASE}?terms=${encodeURIComponent(code)}&max=1&cf=code,name`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as [number, string[], string[][]];
    const rows = data?.[2] ?? [];
    if (rows.length === 0) return null;
    const [c, name] = rows[0];
    if (typeof c === "string" && typeof name === "string") {
      return { code: c, description: name, score: 1, source: "nlm" };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
