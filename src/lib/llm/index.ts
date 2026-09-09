import type { LLMProvider, LLMProviderId } from "./types";
import { makeGLMProvider, isZaiConfigured } from "./glm";
import { mockProvider } from "./mock";
import { makeGroqProvider, makeOpenRouterProvider } from "./openai-compatible";
import { makeGeminiProvider } from "./gemini";
import { makePollinationsProvider } from "./pollinations";
import { autoProvider } from "./auto";

/**
 * LLM Provider Factory.
 * Returns the appropriate provider for a given id.
 * Switchable at runtime via UI selector.
 */
export function getLLMProvider(id: LLMProviderId): LLMProvider {
  switch (id) {
    case "auto":
      return autoProvider;
    case "glm-4.6":
      return makeGLMProvider("glm-4.6");
    case "glm-4.5":
      return makeGLMProvider("glm-4.5");
    case "glm-4-flash":
      return makeGLMProvider("glm-4-flash");
    case "pollinations-openai":
      return makePollinationsProvider("pollinations-openai");
    case "pollinations-mistral":
      return makePollinationsProvider("pollinations-mistral");
    case "groq-llama-3.3-70b":
      return makeGroqProvider("groq-llama-3.3-70b");
    case "groq-llama-3.1-8b":
      return makeGroqProvider("groq-llama-3.1-8b");
    case "gemini-1.5-flash":
      return makeGeminiProvider("gemini-1.5-flash");
    case "gemini-2.0-flash":
      return makeGeminiProvider("gemini-2.0-flash");
    case "openrouter-llama-3.3-70b":
      return makeOpenRouterProvider("openrouter-llama-3.3-70b");
    case "openrouter-gemma-2-9b":
      return makeOpenRouterProvider("openrouter-gemma-2-9b");
    case "mock":
      return mockProvider;
    default:
      return autoProvider;
  }
}

/**
 * Returns true if a provider's credentials are detected at runtime.
 * Used by /api/providers to gray out unavailable providers in the UI.
 */
export function isProviderConfigured(id: LLMProviderId): boolean {
  switch (id) {
    case "auto":
      // Auto is always available — it falls back to offline if no GLM
      return true;
    case "glm-4.6":
    case "glm-4.5":
    case "glm-4-flash":
      // Z.ai SDK reads from .z-ai-config file or env vars (ZAI_API_KEY)
      return isZaiConfigured();
    case "pollinations-openai":
    case "pollinations-mistral":
      // Pollinations.ai requires NO API key — always available
      return true;
    case "groq-llama-3.3-70b":
    case "groq-llama-3.1-8b":
      return !!process.env.GROQ_API_KEY;
    case "gemini-1.5-flash":
    case "gemini-2.0-flash":
      return !!process.env.GEMINI_API_KEY;
    case "openrouter-llama-3.3-70b":
    case "openrouter-gemma-2-9b":
      return !!process.env.OPENROUTER_API_KEY;
    case "mock":
      return true;
    default:
      return false;
  }
}

export { LLM_PROVIDERS } from "./types";
export type { LLMProvider, LLMProviderId, LLMProviderMeta, LLMProviderMetaWithStatus } from "./types";
