import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getLLMProvider, type LLMProviderId } from "@/lib/llm";
import { ragSearch } from "@/lib/icd/rag";
import { validateResponse } from "@/lib/icd/validation";
import { ensureExternalCause } from "@/lib/icd/external-cause";
import { ClinicalCodingResponseSchema, type CodingApiResponse } from "@/lib/schemas/icd";

export const runtime = "nodejs";
export const maxDuration = 60;

interface CodeRequestBody {
  clinical_note?: string;
  model?: LLMProviderId;
}

/**
 * Check if an error is a network/connectivity error that should trigger
 * the universal offline fallback.
 */
function isNetworkError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("epipe") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("could not reach") ||
    msg.includes("api timed out")
  );
}

type AnyRec = Record<string, unknown>;

/** If the payload is wrapped one level deep ({"response": {...}} or [ {...} ]), unwrap it. */
function unwrapPayload(p: unknown): AnyRec {
  let cur = (Array.isArray(p) ? p[0] : p) as AnyRec;
  for (let i = 0; i < 3 && cur && typeof cur === "object"; i++) {
    const keys = Object.keys(cur);
    const only = keys.length === 1 ? (cur as AnyRec)[keys[0]] : undefined;
    if (only !== undefined && typeof only === "object" && only !== null && !Array.isArray(only)) {
      cur = only as AnyRec;
      continue;
    }
    break;
  }
  return cur ?? {};
}

/** Case-insensitive, punctuation-tolerant key lookup. */
function pickKey(obj: AnyRec, aliases: string[]): unknown {
  const map = new Map(Object.keys(obj).map((k) => [k.toLowerCase().replace(/[\s-]/g, "_"), k]));
  for (const a of aliases) {
    const k = map.get(a);
    if (k !== undefined) return obj[k];
  }
  return undefined;
}

/** Normalize common LLM key drift into the ClinicalCodingResponse shape (no-op if already clean). */
function repairCodingShape(p: unknown): AnyRec {
  const cur = unwrapPayload(p);
  const out: AnyRec = { ...cur };
  const primary = pickKey(cur, ["primary_icd10", "primary_dx", "primary_diagnosis", "principal_icd10"]);
  if (primary !== undefined) {
    out.primary_icd10 = typeof primary === "string" ? { code: primary } : primary;
  }
  const groups: Array<[string, string[]]> = [
    ["secondary_icd10", ["secondary_icd10", "secondary_diagnoses", "secondary_dx"]],
    ["tertiary_icd10", ["tertiary_icd10", "tertiary_diagnoses", "tertiary_dx", "external_cause_icd10"]],
    ["entities_extracted", ["entities_extracted", "extracted_entities", "entities"]],
    ["summary", ["summary", "clinical_summary"]],
  ];
  for (const [field, aliases] of groups) {
    const v = pickKey(cur, aliases);
    if (v !== undefined) out[field] = v;
  }
  return out;
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let body: CodeRequestBody;
  try {
    body = (await req.json()) as CodeRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const note = (body.clinical_note ?? "").trim();
  if (!note) {
    return NextResponse.json({ ok: false, error: "clinical_note is required" }, { status: 400 });
  }

  // === Apply API keys from x-provider-keys header (set by Settings dialog) ===
  // The header contains a JSON object like { "GROQ_API_KEY": "gsk_...", ... }
  // These override env vars for this request only.
  try {
    const keysHeader = req.headers.get("x-provider-keys");
    if (keysHeader) {
      const keys = JSON.parse(keysHeader) as Record<string, string>;
      for (const [k, v] of Object.entries(keys)) {
        if (typeof v === "string" && v.trim()) {
          (process.env as Record<string, string>)[k] = v.trim();
        }
      }
    }
  } catch {
    // ignore parse errors — fall back to env vars
  }

  // Default to "auto" (which already has its own offline fallback)
  const providerId: LLMProviderId = (body.model as LLMProviderId) ?? "auto";
  const provider = getLLMProvider(providerId);

  // 1. RAG retrieval (works offline — uses built-in vector DB)
  const ragOutcome = await ragSearch(note);
  const ragContext = ragOutcome.results.map((r) => ({
    code: r.code,
    description: r.description,
    score: r.score,
    source: r.source,
  }));

  try {
    // 2. LLM coding
    const { parsed, raw } = await provider.generateCoding(note, ragContext);

    // 2b. Shape repair: LLMs drift on key casing/naming or wrap the payload one
    // level deep. Unwrap and remap aliases BEFORE validation so a good clinical
    // answer is not wasted on a technicality; unrepairable output still falls
    // back to offline via the ZodError guard below.
    const repaired = repairCodingShape(parsed);

    // 3. Schema-validate the LLM output (coerce defaults)
    const validated = ClinicalCodingResponseSchema.parse({
      ...repaired,
      secondary_icd10: repaired.secondary_icd10 ?? [],
      tertiary_icd10: repaired.tertiary_icd10 ?? [],
      entities_extracted: repaired.entities_extracted ?? [],
    });

    // 3b. External-cause guarantee: any injury (S/T) encounter MUST carry an
    // external cause code (V/W/X/Y) — supplemental, never primary, 7th char matched.
    ensureExternalCause(validated, note);

    // 4. Validation engine
    const issues = validateResponse(validated, note);

    const apiResponse: CodingApiResponse = {
      ok: true,
      model: provider.modelLabel,
      raw_response: validated,
      validation_issues: issues,
      rag_context: ragContext,
      latency_ms: Date.now() - t0,
    };

    return NextResponse.json(apiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // === UNIVERSAL OFFLINE FALLBACK ===
    // If the selected provider failed with a network error OR its response
    // failed Zod shape validation (e.g. missing/invalid primary_icd10),
    // automatically fall back to the Smart Offline Coder so the user ALWAYS
    // gets a result. We add a note to the summary so the user knows what happened.
    if ((isNetworkError(err) || err instanceof ZodError) && providerId !== "mock") {
      try {
        const offlineProvider = getLLMProvider("mock");
        const offlineResult = await offlineProvider.generateCoding(note, ragContext);
        const offlineValidated = ClinicalCodingResponseSchema.parse({
          ...offlineResult.parsed,
          secondary_icd10: offlineResult.parsed.secondary_icd10 ?? [],
          tertiary_icd10: offlineResult.parsed.tertiary_icd10 ?? [],
          entities_extracted: offlineResult.parsed.entities_extracted ?? [],
        });
        ensureExternalCause(offlineValidated, note);
        const issues = validateResponse(offlineValidated, note);

        const apiResponse: CodingApiResponse = {
          ok: true,
          model: `${provider.modelLabel} → Offline (network fallback)`,
          raw_response: {
            ...offlineValidated,
            summary: `[⚠️ ${provider.modelLabel} was unreachable — automatically fell back to Smart Offline Coder. Original error: ${message.split(".")[0]}.] ${offlineValidated.summary ?? ""}`.trim(),
          },
          validation_issues: issues,
          rag_context: ragContext,
          latency_ms: Date.now() - t0,
        };
        return NextResponse.json(apiResponse);
      } catch (offlineErr) {
        // If even the offline coder fails, return the original error
        const offlineMsg = offlineErr instanceof Error ? offlineErr.message : String(offlineErr);
        return NextResponse.json(
          {
            ok: false,
            error: `Both ${provider.modelLabel} and offline fallback failed. Original: ${message}. Offline: ${offlineMsg}`,
            latency_ms: Date.now() - t0,
          },
          { status: 500 }
        );
      }
    }

    // Non-network errors (auth, parse, etc.) return normally
    return NextResponse.json(
      {
        ok: false,
        error: message,
        latency_ms: Date.now() - t0,
      },
      { status: 500 }
    );
  }
}
