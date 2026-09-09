import ZAI from "z-ai-web-dev-sdk";
import fs from "node:fs";
import path from "node:path";
import type { ClinicalCodingResponse } from "@/lib/schemas/icd";
import type { LLMProvider } from "./types";
import { SYSTEM_PROMPT, buildUserMessage } from "./shared-prompt";

/**
 * Ensure the ZAI SDK can find its config on cloud deployments (Vercel /
 * Netlify) where you can't ship a `.z-ai-config` file. We write a config
 * file at module load time if the env vars are set and no config file
 * exists yet.
 */
function ensureZaiConfig(): void {
  const candidates = [
    path.join(process.cwd(), ".z-ai-config"),
    path.join(process.env.HOME ?? "/tmp", ".z-ai-config"),
    "/etc/.z-ai-config",
  ];
  const exists = candidates.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  if (exists) return;

  // Try to construct from env vars
  const baseUrl = process.env.ZAI_BASE_URL;
  const apiKey = process.env.ZAI_API_KEY;
  const token = process.env.ZAI_TOKEN;
  if (!baseUrl || !apiKey) return; // nothing we can do

  const config: Record<string, string> = { baseUrl, apiKey };
  if (token) config.token = token;
  if (process.env.ZAI_CHAT_ID) config.chatId = process.env.ZAI_CHAT_ID;
  if (process.env.ZAI_USER_ID) config.userId = process.env.ZAI_USER_ID;

  try {
    fs.writeFileSync(candidates[0], JSON.stringify(config, null, 2), { mode: 0o600 });
  } catch {
    // If we can't write to project root (read-only FS), try /tmp
    try {
      fs.writeFileSync("/tmp/.z-ai-config", JSON.stringify(config, null, 2), { mode: 0o600 });
    } catch {
      // give up silently — the SDK will throw a clearer error later
    }
  }
}

ensureZaiConfig();

/**
 * Returns true if a *real* Z.ai credential is available (env var or .z-ai-config file).
 * Placeholder/dummy values ("your-zai-api-key", etc.) count as NOT configured.
 * Used by the Auto provider to decide whether to attempt the GLM tier.
 */
export function isZaiConfigured(): boolean {
  const placeholder = (v?: string) => !v || v.includes("your-") || v.includes("replace-with") || v.trim().length < 8;
  if (process.env.ZAI_API_KEY && !placeholder(process.env.ZAI_API_KEY)) return true;
  try {
    const candidates = [
      path.join(process.cwd(), ".z-ai-config"),
      path.join(process.env.HOME ?? "/tmp", ".z-ai-config"),
      "/etc/.z-ai-config",
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      const cfg = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, string>;
      if (cfg.apiKey && !placeholder(cfg.apiKey)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function makeGLMProvider(modelId: "glm-4.6" | "glm-4.5" | "glm-4-flash"): LLMProvider {
  const modelName =
    modelId === "glm-4.6" ? "glm-4.6" : modelId === "glm-4.5" ? "glm-4.5" : "glm-4-flash";
  const label =
    modelId === "glm-4.6" ? "GLM-4.6" : modelId === "glm-4.5" ? "GLM-4.5" : "GLM-4-Flash";
  return {
    id: modelId,
    modelLabel: label,
    async generateCoding(clinicalNote, ragContext) {
      const zai = await ZAI.create();

      // Try up to 2 times (initial + 1 retry) with a 45s timeout per attempt.
      const MAX_ATTEMPTS = 2;
      const PER_ATTEMPT_TIMEOUT_MS = 45000;
      let lastError: unknown = null;
      let raw: string = "";

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Race the LLM call against a timeout — the ZAI SDK doesn't expose
        // a timeout option directly.
        const llmPromise = zai.chat.completions.create({
          model: modelName,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserMessage(clinicalNote, ragContext) },
          ],
          thinking: { type: "disabled" },
          temperature: 0.2,
          response_format: { type: "json_object" },
        } as any);

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`GLM API timed out after ${PER_ATTEMPT_TIMEOUT_MS / 1000}s`)),
            PER_ATTEMPT_TIMEOUT_MS
          );
        });

        try {
          const completion = await Promise.race([llmPromise, timeoutPromise]);
          raw = completion?.choices?.[0]?.message?.content ?? "";

          if (!raw || raw.trim().length === 0) {
            throw new Error("GLM API returned an empty response");
          }

          // Try to parse the JSON. If it fails, salvage by extracting the
          // first {...} block. If that also fails, retry.
          let parsed: ClinicalCodingResponse;
          try {
            parsed = JSON.parse(raw);
          } catch {
            const match = raw.match(/\{[\s\S]*\}/);
            if (!match) {
              throw new Error(
                `GLM did not return valid JSON (attempt ${attempt}/${MAX_ATTEMPTS}). First 200 chars: ${raw.slice(0, 200)}`
              );
            }
            parsed = JSON.parse(match[0]);
          }
          return { parsed, raw };
        } catch (err) {
          lastError = err;
          // Brief backoff before retry
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }

      // All retries exhausted. Throw a clear, actionable error.
      const errMsg = errMessage(lastError);
      const hint = errHint(lastError);
      const finalMsg = hint
        ? `GLM API failed after ${MAX_ATTEMPTS} attempts: ${errMsg}. ${hint}`
        : `GLM API failed after ${MAX_ATTEMPTS} attempts: ${errMsg}`;
      throw new Error(finalMsg);
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
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) {
    return "This is an authentication error — your ZAI_API_KEY / ZAI_TOKEN is missing or invalid. Check your `.z-ai-config` file or env vars. You can also switch to the Mock Coder model in the UI for an offline demo.";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "The GLM API took too long to respond. Try again, or switch to GLM-4.5 (faster) or Mock Coder (offline).";
  }
  if (msg.includes("network") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("fetch failed")) {
    return "Could not reach the GLM API — check your internet connection. You can switch to Mock Coder in the UI for an offline demo.";
  }
  if (msg.includes("rate") && msg.includes("limit")) {
    return "GLM API rate limit hit — wait a minute and try again, or switch to Mock Coder.";
  }
  if (msg.includes("not return valid json") || msg.includes("empty response")) {
    return "GLM returned an unexpected response. Please try again — if it persists, switch to GLM-4.5 or Mock Coder.";
  }
  return null;
}
