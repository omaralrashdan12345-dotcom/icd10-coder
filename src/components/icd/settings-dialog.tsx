"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Settings, Eye, EyeOff, Loader2, CheckCircle2, XCircle, ExternalLink, KeyRound, Trash2 } from "lucide-react";
import type { Locale } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";

const STORAGE_KEY = "icd10-coder-provider-keys";

/**
 * Provider config — which env var name, where to sign up, and what the
 * placeholder should look like.
 */
interface ProviderKeyConfig {
  envVar: string;
  label_en: string;
  label_ar: string;
  signup_url: string;
  placeholder: string;
  prefix_hint: string;
}

const PROVIDER_KEYS: ProviderKeyConfig[] = [
  {
    envVar: "GROQ_API_KEY",
    label_en: "Groq (Llama 3.3 70B — ultra-fast, free)",
    label_ar: "Groq (Llama 3.3 70B — فائق السرعة، مجاني)",
    signup_url: "https://console.groq.com/keys",
    placeholder: "gsk_...",
    prefix_hint: "gsk_",
  },
  {
    envVar: "GEMINI_API_KEY",
    label_en: "Google Gemini (1.5/2.0 Flash — free, 1M context)",
    label_ar: "Google Gemini (1.5/2.0 Flash — مجاني، سياق 1M)",
    signup_url: "https://aistudio.google.com/app/apikey",
    placeholder: "AIza...",
    prefix_hint: "AIza",
  },
  {
    envVar: "OPENROUTER_API_KEY",
    label_en: "OpenRouter (free Llama / Gemma models)",
    label_ar: "OpenRouter (نماذج Llama / Gemma مجانية)",
    signup_url: "https://openrouter.ai/keys",
    placeholder: "sk-or-v1-...",
    prefix_hint: "sk-or-",
  },
  {
    envVar: "POLLINATIONS_API_KEY",
    label_en: "Pollinations.ai (optional — bypass anon rate limits)",
    label_ar: "Pollinations.ai (اختياري — تجاوز حدود المجهول)",
    signup_url: "https://enter.pollinations.ai/keys",
    placeholder: "optional",
    prefix_hint: "",
  },
];

interface SettingsDialogProps {
  locale: Locale;
  onKeysChanged?: () => void;
}

interface TestState {
  loading: boolean;
  result: { ok: boolean; message: string } | null;
}

export function SettingsDialog({ locale, onKeysChanged }: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [saved, setSaved] = useState(false);

  // Load keys from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setKeys(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  function handleSave() {
    try {
      // Strip empty values before saving
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(keys)) {
        if (v && v.trim()) cleaned[k] = v.trim();
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      setKeys(cleaned);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onKeysChanged?.();
    } catch (e) {
      console.error("Failed to save keys:", e);
    }
  }

  function handleClear() {
    setKeys({});
    localStorage.removeItem(STORAGE_KEY);
    onKeysChanged?.();
  }

  async function handleTest(envVar: string) {
    const keyValue = keys[envVar]?.trim();
    if (!keyValue) {
      setTestStates((s) => ({
        ...s,
        [envVar]: { loading: false, result: { ok: false, message: "Paste a key first" } },
      }));
      return;
    }

    // Map env var back to a provider_id for testing
    const providerIdMap: Record<string, string> = {
      GROQ_API_KEY: "groq-llama-3.3-70b",
      GEMINI_API_KEY: "gemini-1.5-flash",
      OPENROUTER_API_KEY: "openrouter-llama-3.3-70b",
      POLLINATIONS_API_KEY: "pollinations-openai",
    };
    const providerId = providerIdMap[envVar];
    if (!providerId) return;

    setTestStates((s) => ({ ...s, [envVar]: { loading: true, result: null } }));

    try {
      const res = await fetch("/api/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_id: providerId, api_key: keyValue }),
      });
      const data = await res.json();
      setTestStates((s) => ({
        ...s,
        [envVar]: {
          loading: false,
          result: {
            ok: data.ok,
            message: data.ok ? data.message : data.error,
          },
        },
      }));
    } catch (e) {
      setTestStates((s) => ({
        ...s,
        [envVar]: {
          loading: false,
          result: { ok: false, message: e instanceof Error ? e.message : String(e) },
        },
      }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={locale === "ar" ? "الإعدادات" : "Settings"} title={locale === "ar" ? "الإعدادات" : "Settings"}>
          <Settings className="h-4 w-4" />
          <span className="hidden sm:inline ltr:ml-2 rtl:mr-2">{locale === "ar" ? "مفاتيح API" : "API Keys"}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            {locale === "ar" ? "مفاتيح API" : "API Keys"}
          </DialogTitle>
          <DialogDescription>
            {locale === "ar"
              ? "ألصق مفاتيح API هنا لتشغيل النماذج المجانية. تُحفظ المفاتيح في متصفحك فقط (localStorage) ولا تُرسل لأي خادم آخر."
              : "Paste your free API keys here to enable the models. Keys are stored in your browser only (localStorage) and never sent to any other server."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {PROVIDER_KEYS.map((pk) => {
            const testState = testStates[pk.envVar];
            const keyValue = keys[pk.envVar] ?? "";
            const showThisKey = showKeys[pk.envVar] ?? false;
            return (
              <div key={pk.envVar} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={pk.envVar} className="text-xs font-medium">
                    {locale === "ar" ? pk.label_ar : pk.label_en}
                  </Label>
                  <a
                    href={pk.signup_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    {locale === "ar" ? "احصل على مفتاح" : "Get key"}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      id={pk.envVar}
                      type={showThisKey ? "text" : "password"}
                      value={keyValue}
                      onChange={(e) => setKeys((s) => ({ ...s, [pk.envVar]: e.target.value }))}
                      placeholder={pk.placeholder}
                      className="text-xs pr-9 font-mono"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeys((s) => ({ ...s, [pk.envVar]: !showThisKey }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showThisKey ? "Hide" : "Show"}
                    >
                      {showThisKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(pk.envVar)}
                    disabled={testState?.loading}
                    className="text-xs shrink-0"
                  >
                    {testState?.loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <span>{locale === "ar" ? "اختبار" : "Test"}</span>
                    )}
                  </Button>
                </div>
                {testState?.result && (
                  <div
                    className={`flex items-start gap-1.5 rounded-md p-2 text-xs ${
                      testState.result.ok
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                    }`}
                  >
                    {testState.result.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    )}
                    <span className="break-words">{testState.result.message}</span>
                  </div>
                )}
                {keyValue && !testState?.result && (
                  <div className="text-[10px] text-muted-foreground">
                    {keyValue.startsWith(pk.prefix_hint) ? (
                      <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 h-3.5">
                        looks valid
                      </Badge>
                    ) : pk.prefix_hint ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        ⚠️ Expected to start with "{pk.prefix_hint}"
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
          {locale === "ar"
            ? "🔒 المفاتيح تُحفظ في متصفحك فقط. امسحها بزر 'حذف الكل' قبل استخدام التطبيق على جهاز مشترك."
            : "🔒 Keys are stored in your browser only. Click 'Clear all' before using this app on a shared device."}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={handleClear} className="text-rose-600 hover:text-rose-700">
            <Trash2 className="h-3.5 w-3.5 ltr:mr-1.5 rtl:ml-1.5" />
            {locale === "ar" ? "حذف الكل" : "Clear all"}
          </Button>
          <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {saved ? (
              <>
                <CheckCircle2 className="h-4 w-4 ltr:mr-2 rtl:ml-2" />
                {locale === "ar" ? "تم الحفظ" : "Saved"}
              </>
            ) : (
              locale === "ar" ? "حفظ" : "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Helper: read the stored keys from localStorage. Used by page.tsx to
 * attach the x-provider-keys header to every API request.
 */
export function getStoredProviderKeys(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, string>;
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) cleaned[k] = v.trim();
    }
    return cleaned;
  } catch {
    return {};
  }
}

/**
 * Helper: build the x-provider-keys header value (JSON string).
 * Returns undefined if no keys are stored.
 */
export function buildProviderKeysHeader(): string | undefined {
  const keys = getStoredProviderKeys();
  if (Object.keys(keys).length === 0) return undefined;
  return JSON.stringify(keys);
}
