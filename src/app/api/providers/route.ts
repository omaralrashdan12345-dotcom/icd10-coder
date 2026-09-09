import { NextRequest, NextResponse } from "next/server";
import { LLM_PROVIDERS, isProviderConfigured } from "@/lib/llm";

export const runtime = "nodejs";

/**
 * GET /api/providers
 * Returns the list of LLM providers with their runtime configured status.
 * Used by the UI to gray out providers whose API keys are not set.
 *
 * Accepts an optional `x-provider-keys` header (JSON object of env-var names
 * to key values) so the UI can report which providers are available based on
 * keys the user pasted in the Settings dialog (stored in localStorage).
 */
export async function GET(req: NextRequest) {
  // Apply keys from header (set by Settings dialog)
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
    // ignore
  }

  const providers = LLM_PROVIDERS.map((p) => ({
    ...p,
    configured: isProviderConfigured(p.id),
  }));
  return NextResponse.json({ ok: true, providers });
}
