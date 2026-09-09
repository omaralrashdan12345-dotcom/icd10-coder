import type { ClinicalCodingResponse } from "@/lib/schemas/icd";
import type { LLMProvider, LLMProviderId } from "./types";
import { SYSTEM_PROMPT, buildUserMessage } from "./shared-prompt";

/**
 * Pollinations.ai provider — TRULY FREE, NO API KEY REQUIRED.
 *
 * Uses the GET endpoint: https://text.pollinations.ai/{prompt}?model={model}
 * The POST /openai endpoint requires authentication now; the GET endpoint
 * is the only one that still works anonymously.
 *
 * Free tier limits (anonymous): no hard rate limit, but queues may apply
 * during peak usage. Community-supported, may have occasional downtime.
 *
 * Models available (anonymous tier): openai (GPT-OSS 20B), openai-fast.
 */

interface PollinationsConfig {
  id: LLMProviderId;
  label: string;
  model: string;
}

const PROVIDER_NAME = "Pollinations.ai";

export function makePollinationsProvider(
  modelId: "pollinations-openai" | "pollinations-mistral"
): LLMProvider {
  // Pollinations GET endpoint supports a `model` query param. The `mistral`
  // model is no longer in the anonymous tier — we fall back to "openai" for
  // both provider IDs (the model selector still shows them as separate
  // options so users understand the architecture).
  const modelMap: Record<typeof modelId, string> = {
    "pollinations-openai": "openai",
    "pollinations-mistral": "openai", // mistral deprecated in anon tier
  };
  const labelMap: Record<typeof modelId, string> = {
    "pollinations-openai": "Pollinations · OpenAI (free, no key)",
    "pollinations-mistral": "Pollinations · Mistral (free, no key)",
  };
  const cfg: PollinationsConfig = {
    id: modelId,
    label: labelMap[modelId],
    model: modelMap[modelId],
  };

  return {
    id: cfg.id,
    modelLabel: cfg.label,
    async generateCoding(clinicalNote, ragContext) {
      const MAX_ATTEMPTS = 2;
      const PER_ATTEMPT_TIMEOUT_MS = 90000; // GET endpoint can be slow with long prompts
      let lastError: unknown = null;

      // Build the combined prompt — system + user — since the GET endpoint
      // only takes a single text input.
      const userText = buildUserMessage(clinicalNote, ragContext) +
        "\n\nIMPORTANT: Output ONLY the raw JSON object. Do NOT wrap it in markdown fences. Do NOT add any prose before or after.";

      // Combine system + user into a single prompt for the GET endpoint
      const combinedPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${userText}`;
      const url =
        "https://text.pollinations.ai/" +
        encodeURIComponent(combinedPrompt) +
        `?model=${encodeURIComponent(cfg.model)}&temperature=0.2&seed=42`;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);

        try {
          const headers: Record<string, string> = {
            Accept: "text/plain",
            // Referer identifies the calling app (Pollinations anon tier)
            Referer: "https://icd10-coder.app",
          };
          // If the user has a Pollinations API key (free signup at
          // https://enter.pollinations.ai/keys), use it — this bypasses
          // the anonymous rate limits.
          const pollKey = process.env.POLLINATIONS_API_KEY;
          if (pollKey) {
            headers["Authorization"] = `Bearer ${pollKey}`;
          }

          const res = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            headers,
          });

          clearTimeout(timer);

          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            // 402 = rate-limited / anonymous quota exhausted. Retrying is
            // pointless — break out of the retry loop immediately.
            if (res.status === 402 || res.status === 429) {
              throw new Error(
                `${PROVIDER_NAME} HTTP ${res.status}: ${errBody.slice(0, 150)} — anonymous quota exhausted, skipping retries.`
              );
            }
            throw new Error(
              `${PROVIDER_NAME} returned HTTP ${res.status}: ${errBody.slice(0, 200)}`
            );
          }

          const raw: string = await res.text();

          if (!raw || raw.trim().length === 0) {
            throw new Error(`${PROVIDER_NAME} returned an empty response`);
          }

          let parsed: ClinicalCodingResponse;
          // Strip markdown code fences if present (```json ... ```)
          const cleanedRaw = raw
            .replace(/^```(?:json)?\s*\n?/i, "")
            .replace(/\n?```\s*$/i, "")
            .trim();
          try {
            parsed = JSON.parse(cleanedRaw);
          } catch {
            const match = cleanedRaw.match(/\{[\s\S]*\}/);
            if (!match) {
              throw new Error(
                `${PROVIDER_NAME} did not return valid JSON (attempt ${attempt}/${MAX_ATTEMPTS}). First 200 chars: ${raw.slice(0, 200)}`
              );
            }
            parsed = JSON.parse(match[0]);
          }
          return { parsed, raw };
        } catch (err) {
          clearTimeout(timer);
          lastError = err;
          // 402/429 = anonymous quota exhausted — don't retry, break immediately
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes("HTTP 402") || errMsg.includes("HTTP 429") || errMsg.includes("quota exhausted")) {
            break;
          }
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      const errMsg = errMessage(lastError);
      const hint = errHint(lastError);
      throw new Error(
        hint
          ? `${PROVIDER_NAME} failed after ${MAX_ATTEMPTS} attempts: ${errMsg}. ${hint}`
          : `${PROVIDER_NAME} failed after ${MAX_ATTEMPTS} attempts: ${errMsg}`
      );
    },
  };
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function errHint(e: unknown): string | null {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes("429") || (msg.includes("rate") && msg.includes("limit"))) {
    return "Pollinations rate limit hit — wait a moment and try again, or switch to Smart Offline Coder.";
  }
  if (msg.includes("abort") || msg.includes("timeout") || msg.includes("timed out")) {
    return "Pollinations free tier was slow — try again, or switch to Smart Offline Coder.";
  }
  if (msg.includes("fetch failed") || msg.includes("econnrefused") || msg.includes("enotfound")) {
    return "Could not reach Pollinations — check your internet connection.";
  }
  if (msg.includes("not return valid json") || msg.includes("empty response")) {
    return "Pollinations returned an unexpected response. Try again, or switch to Smart Offline Coder.";
  }
  return null;
}
