import type { ClinicalCodingResponse } from "@/lib/schemas/icd";
import type { LLMProvider } from "./types";
import { SYSTEM_PROMPT, buildUserMessage } from "./shared-prompt";

/**
 * Google Gemini provider via the Generative Language API.
 * Free tier: 15 RPM, 1500 RPD, 1M token context (Gemini 1.5 Flash).
 *
 * Uses the v1beta generateContent endpoint with responseMimeType=json
 * to force structured JSON output.
 */

interface GeminiConfig {
  id: LLMProvider["id"];
  label: string;
  model: string;
}

const PROVIDER_NAME = "Google Gemini";

export function makeGeminiProvider(
  modelId: "gemini-1.5-flash" | "gemini-2.0-flash"
): LLMProvider {
  const modelMap: Record<typeof modelId, string> = {
    "gemini-1.5-flash": "gemini-1.5-flash-latest",
    "gemini-2.0-flash": "gemini-2.0-flash",
  };
  const labelMap: Record<typeof modelId, string> = {
    "gemini-1.5-flash": "Gemini 1.5 Flash",
    "gemini-2.0-flash": "Gemini 2.0 Flash",
  };
  const cfg: GeminiConfig = {
    id: modelId,
    label: labelMap[modelId],
    model: modelMap[modelId],
  };

  return {
    id: cfg.id,
    modelLabel: cfg.label,
    async generateCoding(clinicalNote, ragContext) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          `Google Gemini API key not found. Set the GEMINI_API_KEY environment variable. ` +
            `Get a free key at https://aistudio.google.com/app/apikey. ` +
            `You can also switch to Mock Coder in the UI for an offline demo.`
        );
      }

      const MAX_ATTEMPTS = 2;
      const PER_ATTEMPT_TIMEOUT_MS = 45000;
      let lastError: unknown = null;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const userText = buildUserMessage(clinicalNote, ragContext);

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);

        try {
          const res = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [
                { role: "user", parts: [{ text: userText }] },
              ],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4000,
                responseMimeType: "application/json",
              },
            }),
          });

          clearTimeout(timer);

          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new Error(
              `${PROVIDER_NAME} API returned HTTP ${res.status}: ${errBody.slice(0, 300)}`
            );
          }

          const data = (await res.json()) as any;
          const raw: string =
            data?.candidates?.[0]?.content?.parts?.[0]?.text ??
            data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ??
            "";

          if (!raw || raw.trim().length === 0) {
            // Gemini sometimes returns finishReason: SAFETY with no content
            const reason = data?.candidates?.[0]?.finishReason;
            if (reason === "SAFETY") {
              throw new Error(`${PROVIDER_NAME} blocked the response for safety reasons. Try rephrasing the clinical note.`);
            }
            throw new Error(`${PROVIDER_NAME} returned an empty response (finishReason: ${reason ?? "unknown"})`);
          }

          let parsed: ClinicalCodingResponse;
          try {
            parsed = JSON.parse(raw);
          } catch {
            const match = raw.match(/\{[\s\S]*\}/);
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
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 500));
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
  if (msg.includes("400") && msg.includes("api key not valid")) {
    return "Your GEMINI_API_KEY is invalid. Get one at https://aistudio.google.com/app/apikey";
  }
  if (msg.includes("401") || msg.includes("unauthorized")) {
    return "Authentication failed — your GEMINI_API_KEY is invalid. Try Mock Coder for an offline demo.";
  }
  if (msg.includes("403") || msg.includes("forbidden")) {
    return "Access denied — your Gemini key may not have access to this model. Try Gemini 1.5 Flash or Mock Coder.";
  }
  if (msg.includes("429") || msg.includes("rate") && msg.includes("limit") || msg.includes("quota")) {
    return "Gemini free-tier rate limit (15 RPM / 1500 RPD) hit. Wait a minute and try again, or switch to Mock Coder.";
  }
  if (msg.includes("abort") || msg.includes("timeout") || msg.includes("timed out")) {
    return "Gemini took too long. Try again, or switch to Mock Coder.";
  }
  if (msg.includes("fetch failed") || msg.includes("econnrefused") || msg.includes("enotfound")) {
    return "Could not reach Google Gemini — check your internet connection. Try Mock Coder for offline.";
  }
  if (msg.includes("safety")) {
    return "Gemini flagged the content as unsafe. Try rephrasing the clinical note, or switch to Mock Coder.";
  }
  return null;
}
