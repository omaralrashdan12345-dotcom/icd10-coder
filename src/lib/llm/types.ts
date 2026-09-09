import type { ClinicalCodingResponse } from "@/lib/schemas/icd";

export type LLMProviderId =
  | "auto"
  | "glm-4.6"
  | "glm-4.5"
  | "glm-4-flash"
  | "pollinations-openai"
  | "pollinations-mistral"
  | "groq-llama-3.3-70b"
  | "groq-llama-3.1-8b"
  | "gemini-1.5-flash"
  | "gemini-2.0-flash"
  | "openrouter-llama-3.3-70b"
  | "openrouter-gemma-2-9b"
  | "mock";

export interface LLMProvider {
  id: LLMProviderId;
  modelLabel: string;
  generateCoding(
    clinicalNote: string,
    ragContext: { code: string; description: string; score: number; source: string }[]
  ): Promise<{ parsed: ClinicalCodingResponse; raw: string }>;
}

export interface LLMProviderMeta {
  id: LLMProviderId;
  label: string;
  description_en: string;
  description_ar: string;
  /** Static hint — runtime availability is determined by /api/providers */
  available: boolean;
  /** Env var name to set to enable this provider (null = no key needed) */
  env_hint: string | null;
  free_tier: boolean;
  /** Where to sign up for the API key */
  signup_url?: string;
}

export type LLMProviderMetaWithStatus = LLMProviderMeta & {
  /** True if credentials are detected at runtime */
  configured: boolean;
};

/**
 * Master list of all supported LLM providers.
 * `available` is a static hint — the runtime check is done by /api/providers
 * which inspects env vars / config files.
 */
export const LLM_PROVIDERS: LLMProviderMeta[] = [
  // --- Auto (recommended) ---
  {
    id: "auto",
    label: "Auto (with offline fallback) ★",
    description_en: "Tries GLM-4-Flash first, auto-falls back to Smart Offline Coder on network errors",
    description_ar: "يجرّب GLM-4-Flash أولاً ثم يتحول تلقائياً إلى المُرمّز الذكي دون اتصال عند فشل الشبكة",
    available: true,
    env_hint: null,
    free_tier: true,
  },
  // --- Z.ai GLM family ---
  {
    id: "glm-4.6",
    label: "GLM-4.6",
    description_en: "Z.ai GLM-4.6 — best reasoning quality (paid)",
    description_ar: "Z.ai GLM-4.6 — أفضل جودة استدلال (مدفوع)",
    available: true,
    env_hint: null,
    free_tier: false,
  },
  {
    id: "glm-4.5",
    label: "GLM-4.5",
    description_en: "Z.ai GLM-4.5 — balanced speed/quality (paid)",
    description_ar: "Z.ai GLM-4.5 — توازن بين السرعة والجودة (مدفوع)",
    available: true,
    env_hint: null,
    free_tier: false,
  },
  {
    id: "glm-4-flash",
    label: "GLM-4-Flash",
    description_en: "Z.ai GLM-4-Flash — FREE, very fast, lower quality",
    description_ar: "Z.ai GLM-4-Flash — مجاني، سريع جداً، جودة أقل",
    available: true,
    env_hint: null,
    free_tier: true,
  },
  // --- Pollinations.ai (TRULY FREE — NO API KEY REQUIRED) ---
  {
    id: "pollinations-openai",
    label: "Pollinations · OpenAI (no key)",
    description_en: "Pollinations.ai OpenAI — TRULY FREE, no signup, no API key needed",
    description_ar: "Pollinations.ai OpenAI — مجاني تماماً، دون تسجيل أو مفتاح API",
    available: true,
    env_hint: null,
    free_tier: true,
  },
  {
    id: "pollinations-mistral",
    label: "Pollinations · Mistral (no key)",
    description_en: "Pollinations.ai Mistral — TRULY FREE, no signup, no API key needed",
    description_ar: "Pollinations.ai Mistral — مجاني تماماً، دون تسجيل أو مفتاح API",
    available: true,
    env_hint: null,
    free_tier: true,
  },
  // --- Groq (FREE — 500+ tok/s, 30 RPM, 14400 RPD) ---
  {
    id: "groq-llama-3.3-70b",
    label: "Groq · GPT-OSS 120B",
    description_en: "Groq GPT-OSS 120B — FREE, ultra-fast (500+ tok/s)",
    description_ar: "Groq GPT-OSS 120B — مجاني، فائق السرعة (500+ توكن/ث)",
    available: false,
    env_hint: "GROQ_API_KEY",
    free_tier: true,
    signup_url: "https://console.groq.com/keys",
  },
  {
    id: "groq-llama-3.1-8b",
    label: "Groq · GPT-OSS 20B",
    description_en: "Groq GPT-OSS 20B — FREE, fastest small model",
    description_ar: "Groq GPT-OSS 20B — مجاني، أسرع نموذج صغير",
    available: false,
    env_hint: "GROQ_API_KEY",
    free_tier: true,
    signup_url: "https://console.groq.com/keys",
  },
  // --- Google Gemini (FREE — 15 RPM, 1500 RPD, 1M context) ---
  {
    id: "gemini-1.5-flash",
    label: "Gemini 1.5 Flash",
    description_en: "Google Gemini 1.5 Flash — FREE, 1M token context",
    description_ar: "Google Gemini 1.5 Flash — مجاني، سياق 1M توكن",
    available: false,
    env_hint: "GEMINI_API_KEY",
    free_tier: true,
    signup_url: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    description_en: "Google Gemini 2.0 Flash — FREE, latest, faster than 1.5",
    description_ar: "Google Gemini 2.0 Flash — مجاني، الأحدث، أسرع من 1.5",
    available: false,
    env_hint: "GEMINI_API_KEY",
    free_tier: true,
    signup_url: "https://aistudio.google.com/app/apikey",
  },
  // --- OpenRouter (FREE models available, requires API key) ---
  {
    id: "openrouter-llama-3.3-70b",
    label: "OpenRouter · Llama 3.3 70B (free)",
    description_en: "OpenRouter free Llama 3.3 70B — meta-llama/Llama-3.3-70B-Instruct:free",
    description_ar: "OpenRouter مجاني Llama 3.3 70B",
    available: false,
    env_hint: "OPENROUTER_API_KEY",
    free_tier: true,
    signup_url: "https://openrouter.ai/keys",
  },
  {
    id: "openrouter-gemma-2-9b",
    label: "OpenRouter · Gemma 2 9B (free)",
    description_en: "OpenRouter free Gemma 2 9B — google/gemma-2-9b-it:free",
    description_ar: "OpenRouter مجاني Gemma 2 9B",
    available: false,
    env_hint: "OPENROUTER_API_KEY",
    free_tier: true,
    signup_url: "https://openrouter.ai/keys",
  },
  // --- Smart Offline Coder (always available, no API needed) ---
  {
    id: "mock",
    label: "Smart Offline Coder",
    description_en: "Offline pattern-based coder — 50+ chief complaints, works without internet",
    description_ar: "مُرمّز ذكي دون اتصال — أكثر من 50 شكوى رئيسية، يعمل دون إنترنت",
    available: true,
    env_hint: null,
    free_tier: true,
  },
];
