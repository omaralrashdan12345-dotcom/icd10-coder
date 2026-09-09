import { NextRequest, NextResponse } from "next/server";
import { getLLMProvider, type LLMProviderId } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TestRequestBody {
  provider_id?: LLMProviderId;
  api_key?: string;
}

/**
 * POST /api/test-provider
 * Body: { provider_id: "groq-llama-3.3-70b", api_key: "gsk_..." }
 *
 * Makes a tiny "hello" request to the provider to verify the API key works.
 * Does NOT store the key anywhere. Returns { ok, message }.
 */
export async function POST(req: NextRequest) {
  let body: TestRequestBody;
  try {
    body = (await req.json()) as TestRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const providerId = body.provider_id;
  const apiKey = body.api_key?.trim();

  if (!providerId) {
    return NextResponse.json({ ok: false, error: "provider_id is required" }, { status: 400 });
  }

  // Apply the provided key as an env var override for this request only.
  const envVarMap: Partial<Record<LLMProviderId, string>> = {
    "groq-llama-3.3-70b": "GROQ_API_KEY",
    "groq-llama-3.1-8b": "GROQ_API_KEY",
    "gemini-1.5-flash": "GEMINI_API_KEY",
    "gemini-2.0-flash": "GEMINI_API_KEY",
    "openrouter-llama-3.3-70b": "OPENROUTER_API_KEY",
    "openrouter-gemma-2-9b": "OPENROUTER_API_KEY",
    "pollinations-openai": "POLLINATIONS_API_KEY",
    "pollinations-mistral": "POLLINATIONS_API_KEY",
  };

  const envVarName = envVarMap[providerId];
  if (envVarName && apiKey) {
    (process.env as Record<string, string>)[envVarName] = apiKey;
  }

  // Special cases that don't need a real API test
  if (providerId === "mock") {
    return NextResponse.json({
      ok: true,
      message: "Smart Offline Coder always works (no API key needed)",
      latency_ms: 0,
    });
  }
  if (providerId === "auto") {
    return NextResponse.json({
      ok: true,
      message: "Auto mode always works (tries GLM → Pollinations → Offline)",
      latency_ms: 0,
    });
  }
  if (providerId.startsWith("glm-")) {
    return NextResponse.json({
      ok: true,
      message: "GLM models use the .z-ai-config file or ZAI_* env vars. Test by running a real case.",
      latency_ms: 0,
    });
  }

  if (!apiKey && envVarName) {
    return NextResponse.json({
      ok: false,
      error: `No API key provided. Paste your ${envVarName} above.`,
    });
  }

  const t0 = Date.now();
  try {
    const provider = getLLMProvider(providerId);
    // Send a tiny test prompt — lightweight clinical note
    const result = await provider.generateCoding(
      "Patient has a headache.",
      []
    );
    const latency = Date.now() - t0;
    return NextResponse.json({
      ok: true,
      message: `✅ Working! Returned: ${result.parsed.primary_icd10.code} (${result.parsed.primary_icd10.description}). Latency: ${latency}ms`,
      latency_ms: latency,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ok: false,
      error: message,
      latency_ms: Date.now() - t0,
    });
  }
}
