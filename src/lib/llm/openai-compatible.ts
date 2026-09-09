import type { ClinicalCodingResponse } from "@/lib/schemas/icd";
import type { LLMProvider, LLMProviderId } from "./types";
import { SYSTEM_PROMPT, buildUserMessage } from "./shared-prompt";

/**
 * Generic OpenAI-compatible HTTP provider.
 * Works with: Groq, OpenRouter, Together, Anyscale, Fireworks, etc.
 *
 * All of these implement the OpenAI /v1/chat/completions API format.
 */

interface OpenAICompatConfig {
  /** Provider id from LLMProviderId union */
  id: LLMProviderId;
  /** Display label */
  label: string;
  /** Base URL, e.g. https://api.groq.com/openai/v1 */
  baseUrl: string;
  /** Model name as the provider expects it, e.g. "llama-3.3-70b-versatile" */
  model: string;
  /** Env var name holding the API key */
  apiKeyEnv: string;
  /** Optional: extra HTTP headers (e.g. OpenRouter requires HTTP-Referer) */
  extraHeaders?: Record<string, string>;
  /** Optional: provider-specific error prefix for messages */
  providerName: string;
}

export function makeOpenAICompatProvider(cfg: OpenAICompatConfig): LLMProvider {
  return {
    id: cfg.id,
    modelLabel: cfg.label,
    async generateCoding(clinicalNote, ragContext) {
      const apiKey = process.env[cfg.apiKeyEnv];
      if (!apiKey) {
        throw new Error(
          `${cfg.providerName} API key not found. Set the ${cfg.apiKeyEnv} environment variable. ` +
            `Get a free key at: see provider docs. You can also switch to Mock Coder in the UI for an offline demo.`
        );
      }

      const MAX_ATTEMPTS = 2;
      const PER_ATTEMPT_TIMEOUT_MS = 45000;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);

        try {
          const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              ...(cfg.extraHeaders ?? {}),
            },
            body: JSON.stringify({
              model: cfg.model,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: buildUserMessage(clinicalNote, ragContext) },
              ],
              temperature: 0.2,
              response_format: { type: "json_object" },
              max_tokens: 4000,
            }),
          });

          clearTimeout(timer);

          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new Error(
              `${cfg.providerName} API returned HTTP ${res.status}: ${errBody.slice(0, 300)}`
            );
          }

          const data = (await res.json()) as any;
          const raw: string = data?.choices?.[0]?.message?.content ?? "";

          if (!raw || raw.trim().length === 0) {
            throw new Error(`${cfg.providerName} returned an empty response`);
          }

          let parsed: ClinicalCodingResponse;
          try {
            parsed = JSON.parse(raw);
          } catch {
            const match = raw.match(/\{[\s\S]*\}/);
            if (!match) {
              throw new Error(
                `${cfg.providerName} did not return valid JSON (attempt ${attempt}/${MAX_ATTEMPTS}). First 200 chars: ${raw.slice(0, 200)}`
              );
            }
            parsed = JSON.parse(match[0]);
          }
          return { parsed, raw };
        } catch (err) {
          clearTimeout(timer);
          lastError = err;
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }

      const errMsg = errMessage(lastError);
      const hint = errHint(lastError, cfg.providerName);
      throw new Error(
        hint
          ? `${cfg.providerName} failed after ${MAX_ATTEMPTS} attempts: ${errMsg}. ${hint}`
          : `${cfg.providerName} failed after ${MAX_ATTEMPTS} attempts: ${errMsg}`
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

function errHint(e: unknown, providerName: string): string | null {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes("401") || msg.includes("unauthorized")) {
    return `Authentication failed — your ${providerName.toUpperCase().replace(/\s/g, "_")} API key is invalid. Try Mock Coder for an offline demo.`;
  }
  if (msg.includes("403") || msg.includes("forbidden")) {
    return `Access denied — your ${providerName} key doesn't have permission for this model. Try a different model or Mock Coder.`;
  }
  if (msg.includes("429") || msg.includes("rate") && msg.includes("limit")) {
    return `${providerName} rate limit hit — wait a minute and try again, or switch to Mock Coder.`;
  }
  if (msg.includes("abort") || msg.includes("timeout") || msg.includes("timed out")) {
    return `${providerName} took too long. Try again, or switch to Mock Coder.`;
  }
  if (msg.includes("fetch failed") || msg.includes("econnrefused") || msg.includes("enotfound")) {
    return `Could not reach ${providerName} — check your internet connection. Try Mock Coder for offline.`;
  }
  if (msg.includes("not return valid json") || msg.includes("empty response")) {
    return `${providerName} returned an unexpected response. Try again, or switch to Mock Coder.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pre-configured factories for each supported OpenAI-compatible provider
// ---------------------------------------------------------------------------

export function makeGroqProvider(modelId: "groq-llama-3.3-70b" | "groq-llama-3.1-8b"): LLMProvider {
  const modelMap: Record<typeof modelId, string> = {
    "groq-llama-3.3-70b": "openai/gpt-oss-120b",
    "groq-llama-3.1-8b": "openai/gpt-oss-20b",
  };
  const labelMap: Record<typeof modelId, string> = {
    "groq-llama-3.3-70b": "Groq · GPT-OSS 120B",
    "groq-llama-3.1-8b": "Groq · GPT-OSS 20B",
  };
  return makeOpenAICompatProvider({
    id: modelId,
    label: labelMap[modelId],
    baseUrl: "https://api.groq.com/openai/v1",
    model: modelMap[modelId],
    apiKeyEnv: "GROQ_API_KEY",
    providerName: "Groq",
  });
}

export function makeOpenRouterProvider(
  modelId: "openrouter-llama-3.3-70b" | "openrouter-gemma-2-9b"
): LLMProvider {
  const modelMap: Record<typeof modelId, string> = {
    "openrouter-llama-3.3-70b": "meta-llama/llama-3.3-70b-instruct:free",
    "openrouter-gemma-2-9b": "google/gemma-2-9b-it:free",
  };
  const labelMap: Record<typeof modelId, string> = {
    "openrouter-llama-3.3-70b": "OpenRouter · Llama 3.3 70B (free)",
    "openrouter-gemma-2-9b": "OpenRouter · Gemma 2 9B (free)",
  };
  return makeOpenAICompatProvider({
    id: modelId,
    label: labelMap[modelId],
    baseUrl: "https://openrouter.ai/api/v1",
    model: modelMap[modelId],
    apiKeyEnv: "OPENROUTER_API_KEY",
    providerName: "OpenRouter",
    extraHeaders: {
      "HTTP-Referer": "https://icd10-coder.local",
      "X-Title": "ICD-10-CM AI Coding Agent",
    },
  });
}
