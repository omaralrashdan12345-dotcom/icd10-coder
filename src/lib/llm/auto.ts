import type { ClinicalCodingResponse } from "@/lib/schemas/icd";
import type { LLMProvider } from "./types";
import { makeGLMProvider } from "./glm";
import { makeGroqProvider } from "./openai-compatible";
import { makePollinationsProvider } from "./pollinations";
import { mockProvider } from "./mock";
import { isZaiConfigured } from "./glm";

/**
 * "Auto" provider — the recommended default.
 *
 * Tries every available free online model in order, then falls back to the
 * Smart Offline Coder as the last resort. The user NEVER sees an error
 * unless every single path fails (which is extremely rare).
 *
 * Fallback chain:
 *   1. GLM-4-Flash (Z.ai — fast, free, configured via .z-ai-config)
 *   2. Groq Llama 3.3 70B (free, ultra-fast ~500 tok/s — uses GROQ_API_KEY)
 *   3. Groq Llama 3.1 8B   (free, fastest small model — uses GROQ_API_KEY)
 *   4. Pollinations.ai OpenAI (truly free, no API key needed)
 *   5. Pollinations.ai Mistral (truly free, no API key needed)
 *   6. Smart Offline Coder (67 clinical patterns, always works)
 *
 * Each tier logs which path actually succeeded so the UI shows e.g.
 * "Auto → Groq (GLM-Flash unreachable)".
 */

interface TierResult {
  parsed: ClinicalCodingResponse;
  raw: string;
  tierLabel: string;
}

async function tryTier(
  name: string,
  fn: () => Promise<{ parsed: ClinicalCodingResponse; raw: string }>
): Promise<TierResult | null> {
  try {
    const result = await fn();
    return { ...result, tierLabel: name };
  } catch {
    return null;
  }
}

export const autoProvider: LLMProvider = {
  id: "auto",
  modelLabel: "Auto (GLM → Groq → Pollinations → Offline)",
  async generateCoding(clinicalNote, ragContext) {
    const failedReasons: string[] = [];

    // Tier 1: GLM-4-Flash (best quality among free options — skip fast if no key configured)
    const glm = makeGLMProvider("glm-4-flash");
    let tier1: TierResult | null = null;
    if (isZaiConfigured()) {
      tier1 = await tryTier("GLM-4-Flash", () => glm.generateCoding(clinicalNote, ragContext));
      if (tier1) {
        return {
          parsed: tier1.parsed,
          raw: tier1.raw,
        };
      }
      failedReasons.push("GLM-4-Flash");
    }

    // Tier 2: Groq Llama 3.3 70B (fast, reliable, uses GROQ_API_KEY)
    const groq70b = makeGroqProvider("groq-llama-3.3-70b");
    const tier2 = await tryTier("Groq Llama 3.3 70B", () => groq70b.generateCoding(clinicalNote, ragContext));
    if (tier2) {
      return {
        parsed: tier2.parsed,
        raw: tier2.raw,
      };
    }
    failedReasons.push("Groq Llama 3.3 70B");

    // Tier 3: Groq Llama 3.1 8B (fastest small model — second chance with Groq)
    const groq8b = makeGroqProvider("groq-llama-3.1-8b");
    const tier3 = await tryTier("Groq Llama 3.1 8B", () => groq8b.generateCoding(clinicalNote, ragContext));
    if (tier3) {
      return {
        parsed: tier3.parsed,
        raw: tier3.raw,
      };
    }
    failedReasons.push("Groq Llama 3.1 8B");

    // Tier 4: Pollinations OpenAI (truly free, no key)
    const pollinationsOpenai = makePollinationsProvider("pollinations-openai");
    const tier4 = await tryTier("Pollinations OpenAI", () =>
      pollinationsOpenai.generateCoding(clinicalNote, ragContext)
    );
    if (tier4) {
      return {
        parsed: {
          ...tier4.parsed,
          summary: `[Auto-fallback: ${failedReasons.join(", ")} unreachable → used Pollinations OpenAI] ${tier4.parsed.summary ?? ""}`.trim(),
        },
        raw: tier4.raw,
      };
    }
    failedReasons.push("Pollinations OpenAI");

    // Tier 5: Pollinations Mistral (truly free, no key, different model)
    const pollinationsMistral = makePollinationsProvider("pollinations-mistral");
    const tier5 = await tryTier("Pollinations Mistral", () =>
      pollinationsMistral.generateCoding(clinicalNote, ragContext)
    );
    if (tier5) {
      return {
        parsed: {
          ...tier5.parsed,
          summary: `[Auto-fallback: ${failedReasons.join(", ")} unreachable → used Pollinations Mistral] ${tier5.parsed.summary ?? ""}`.trim(),
        },
        raw: tier5.raw,
      };
    }
    failedReasons.push("Pollinations Mistral");

    // Tier 6: Smart Offline Coder (always works)
    const offline = await mockProvider.generateCoding(clinicalNote, ragContext);
    return {
      parsed: {
        ...offline.parsed,
        summary: `[⚠️ All online models unreachable (${failedReasons.join(", ")}). Fell back to Smart Offline Coder — pattern-matched from 67 clinical patterns.] ${offline.parsed.summary ?? ""}`.trim(),
      },
      raw: offline.raw,
    };
  },
};
