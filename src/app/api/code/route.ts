import { NextRequest, NextResponse } from "next/server";
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

    // 3. Schema-validate the LLM output (coerce defaults)
    const validated = ClinicalCodingResponseSchema.parse({
      ...parsed,
      secondary_icd10: parsed.secondary_icd10 ?? [],
      tertiary_icd10: parsed.tertiary_icd10 ?? [],
      entities_extracted: parsed.entities_extracted ?? [],
    });

    // 3b. External-cause guarantee: any injury (S/T) encounter MUST carry an
    // external cause code (V/W/X/Y) — supplemental, never primary, 7th char matched.
    ensureExternalCause(validated, note);

    // 4. Validation engine
    const issues = validateResponse(validated);

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
    // If the selected provider failed with a network error, automatically
    // fall back to the Smart Offline Coder so the user ALWAYS gets a result.
    // We add a note to the summary so the user knows what happened.
    if (isNetworkError(err) && providerId !== "mock") {
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
        const issues = validateResponse(offlineValidated);

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
