"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Activity,
  Languages,
  Loader2,
  Sparkles,
  Trash2,
  FileDown,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  HeartPulse,
  ListChecks,
  AlertTriangle,
  Info,
  Hash,
} from "lucide-react";
import {
  translations,
  SAMPLE_CASES,
  detectDefaultLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n/translations";
import { LLM_PROVIDERS, type LLMProviderId, type LLMProviderMetaWithStatus } from "@/lib/llm/types";

// Fallback list used when /api/providers hasn't returned yet (or failed).
// The provider meta entries lack `configured`; at runtime `configured ?? available`
// gives the right static hint, so cast is safe — see LLM_PROVIDERS docs.
const FALLBACK_PROVIDERS = LLM_PROVIDERS as LLMProviderMetaWithStatus[];
import type { CodingApiResponse } from "@/lib/schemas/icd";
import { CodeCard, EmptyCodeCard } from "@/components/icd/code-card";
import { ValidationPanel, RAGContextPanel } from "@/components/icd/panels";
import { SettingsDialog, buildProviderKeysHeader } from "@/components/icd/settings-dialog";
import { AppearanceMenu } from "@/components/icd/appearance-menu";
import { OfflineDataDialog } from "@/components/icd/offline-data-dialog";
import { SearchPanel } from "@/components/icd/search-panel";
import { subscribeFullDb, lookupFullCode, type FullDbStatus } from "@/lib/icd/full-db";

function useLocale(): [Locale, (l: Locale) => void, (k: TranslationKey) => string] {
  // English is the DEFAULT locale (Arabic/English only via explicit user
  // choice, remembered in localStorage).
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    // Intentional post-hydration sync: the boot script applies the saved
    // locale to the DOM pre-paint; state must catch up after mount to avoid
    // an SSR/client hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(detectDefaultLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = translations[locale].dir;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }, [locale]);

  const setLocale = (l: Locale) => setLocaleState(l);
  const tFn = (k: TranslationKey) => translations[locale][k];
  return [locale, setLocale, tFn];
}

export default function Home() {
  const [locale, setLocale, t] = useLocale();
  const [model, setModel] = useState<LLMProviderId>("auto");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<CodingApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [providers, setProviders] = useState<LLMProviderMetaWithStatus[] | null>(null);
  const [providersVersion, setProvidersVersion] = useState(0);
  const [dbStatus, setDbStatus] = useState<FullDbStatus | null>(null);
  const [verification, setVerification] = useState<Record<string, "ok" | "category" | "missing">>({});
  const resultsRef = useRef<HTMLDivElement>(null);
  const analyzeRef = useRef<() => void>(() => {});

  // Full offline database status (Sprint 2)
  useEffect(() => subscribeFullDb(setDbStatus), []);

  // Fetch provider availability on mount AND whenever keys change
  useEffect(() => {
    const keysHeader = buildProviderKeysHeader();
    fetch("/api/providers", {
      headers: keysHeader ? { "x-provider-keys": keysHeader } : {},
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.providers)) {
          setProviders(d.providers as LLMProviderMetaWithStatus[]);
        }
      })
      .catch(() => {
        // ignore — UI falls back to static list
      });
  }, [providersVersion]);

  const charCount = note.length;
  const maxChars = 4000;
  const overLimit = charCount > maxChars;

  const errorCount = useMemo(
    () => result?.validation_issues.filter((i) => i.level === "error").length ?? 0,
    [result]
  );
  const warnCount = useMemo(
    () => result?.validation_issues.filter((i) => i.level === "warning").length ?? 0,
    [result]
  );

  // All codes as a copyable list for the mobile summary strip
  const allCodesList = result
    ? [
        result.raw_response.primary_icd10,
        ...result.raw_response.secondary_icd10,
        ...result.raw_response.tertiary_icd10,
      ]
    : [];

  // Existence verification (Sprint 2 — idea I): check every returned code
  // against the full offline dataset once it is available. Non-blocking.
  // Three states: "ok" (billable code exists), "category" (exists but is a
  // non-billable category header — needs more specificity), "missing".
  const dbState = dbStatus?.state ?? "idle";
  const dbVersion = dbStatus?.version ?? null;
  useEffect(() => {
    if (dbState !== "ready" || !result) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVerification({});
      return;
    }
    const map: Record<string, "ok" | "category" | "missing"> = {};
    for (const c of allCodesList) {
      if (map[c.code] !== undefined) continue;
      const hit = lookupFullCode(c.code);
      map[c.code] = !hit ? "missing" : hit.billable ? "ok" : "category";
    }
    setVerification(map);
  }, [result, dbState, dbVersion]);

  async function handleAnalyze() {
    if (!note.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const keysHeader = buildProviderKeysHeader();
      const res = await fetch("/api/code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(keysHeader ? { "x-provider-keys": keysHeader } : {}),
        },
        body: JSON.stringify({ clinical_note: note, model }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResult(data as CodingApiResponse);
      // Smooth-scroll to results on mobile
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }
  analyzeRef.current = handleAnalyze;

  function handleClear() {
    setNote("");
    setResult(null);
    setError(null);
  }

  function handleExport() {
    window.print();
  }

  async function handleCopyJson() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.raw_response, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function handleCopyAllCodes() {
    const text = allCodesList.map((c) => c.code).join(", ");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-950/80 print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl brand-bg brand-fg shadow-sm">
              <HeartPulse className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm sm:text-base lg:text-lg font-bold leading-tight text-foreground">
                {t("app_title")}
              </h1>
              <p className="hidden text-xs text-muted-foreground sm:block">{t("app_subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              aria-label="Toggle language"
              className="h-9 px-2.5 sm:h-10"
            >
              <Languages className="h-4 w-4 ltr:mr-1.5 rtl:ml-1.5 sm:ltr:mr-2 sm:rtl:ml-2" />
              <span className="text-xs sm:text-sm">{t("language_toggle")}</span>
            </Button>
            <AppearanceMenu locale={locale} />
            <OfflineDataDialog locale={locale} />
            <SettingsDialog locale={locale} onKeysChanged={() => setProvidersVersion((v) => v + 1)} />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 pb-28 sm:px-6 sm:py-6 sm:pb-6 lg:pb-8">
        <div className="grid min-w-0 gap-5 sm:gap-6 lg:grid-cols-2 print:block">
          {/* Input Column */}
          <section className="min-w-0 space-y-4 print:hidden">
            <Card className="border-2 border-slate-200 dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <Activity className="h-5 w-5 brand-text" />
                  {t("input_label")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Model selector */}
                <div className="space-y-1.5">
                  <Label htmlFor="model-select" className="text-xs font-medium text-muted-foreground">
                    {t("model_label")}
                  </Label>
                  <Select value={model} onValueChange={(v) => setModel(v as LLMProviderId)}>
                    <SelectTrigger id="model-select" className="w-full min-h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(providers ?? FALLBACK_PROVIDERS).map((p) => {
                        const configured = p.configured ?? p.available;
                        return (
                          <SelectItem
                            key={p.id}
                            value={p.id}
                            disabled={!configured}
                            className={configured ? "" : "opacity-50"}
                          >
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium">{p.label}</span>
                                {p.free_tier && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] uppercase px-1 py-0 h-3.5 brand-soft-bg brand-muted-text border-brand-soft"
                                  >
                                    {t("free_badge")}
                                  </Badge>
                                )}
                                {configured ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] uppercase px-1 py-0 h-3.5 bg-slate-50 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                                  >
                                    {t("ready_badge")}
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] uppercase px-1 py-0 h-3.5 bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                                  >
                                    {p.env_hint ? `set ${p.env_hint}` : "n/a"}
                                  </Badge>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground truncate">
                                {locale === "ar" ? p.description_ar : p.description_en}
                              </span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("model_help")}</p>
                  {/* Quick links to sign up for free API keys */}
                  {(providers ?? FALLBACK_PROVIDERS).some((p) => !p.configured && p.signup_url) && (
                    <details className="text-xs">
                      <summary className="cursor-pointer brand-text hover:underline">
                        {t("how_get_keys")}
                      </summary>
                      <ul className="mt-2 space-y-1 text-muted-foreground ltr:ml-4 rtl:mr-4 list-disc">
                        <li>
                          <strong>Groq</strong> (free, ultra-fast Llama 3.3 70B):{" "}
                          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="brand-text hover:underline">
                            console.groq.com/keys
                          </a>{" "}
                          → set <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">GROQ_API_KEY</code>
                        </li>
                        <li>
                          <strong>Google Gemini</strong> (free, 1M context):{" "}
                          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="brand-text hover:underline">
                            aistudio.google.com/app/apikey
                          </a>{" "}
                          → set <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">GEMINI_API_KEY</code>
                        </li>
                        <li>
                          <strong>OpenRouter</strong> (free Llama / Gemma):{" "}
                          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="brand-text hover:underline">
                            openrouter.ai/keys
                          </a>{" "}
                          → set <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">OPENROUTER_API_KEY</code>
                        </li>
                      </ul>
                    </details>
                  )}
                </div>

                {/* Sample cases — horizontal scroll on mobile */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("sample_cases")}</Label>
                  <div className="flex w-full min-w-0 gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 sm:flex-wrap sm:overflow-visible chip-scroll">
                    {SAMPLE_CASES.map((c, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setNote(c.text)}
                        className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300"
                      >
                        {locale === "ar" ? c.label_ar : c.label_en}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Textarea */}
                <div className="space-y-1.5">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("input_placeholder")}
                    rows={7}
                    className={cn(
                      "resize-y text-base leading-relaxed sm:text-sm",
                      overLimit && "border-rose-400 focus-visible:ring-rose-400"
                    )}
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn("text-muted-foreground", overLimit && "text-rose-600 font-medium")}>
                      {charCount} / {maxChars}
                    </span>
                  </div>
                </div>

                {/* Buttons — inline on desktop, sticky bottom bar on mobile */}
                <div className="hidden sm:flex flex-wrap gap-2">
                  <Button
                    onClick={handleAnalyze}
                    disabled={loading || !note.trim() || overLimit}
                    className="flex-1 min-w-[140px] brand-bg hover:opacity-90 text-white brand-fg"
                    style={{ backgroundColor: "var(--brand)" }}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 ltr:mr-2 rtl:ml-2 animate-spin" />
                        {t("analyzing")}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 ltr:mr-2 rtl:ml-2" />
                        {t("analyze_button")}
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={handleClear} disabled={loading}>
                    <Trash2 className="h-4 w-4 ltr:mr-2 rtl:ml-2" />
                    {t("clear_button")}
                  </Button>
                </div>

                {error && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold mb-1">{t("error_title")}</div>
                        <div className="break-words text-xs leading-relaxed">{error}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="text-muted-foreground">{t("try_prefix")}</span>
                      <button
                        type="button"
                        onClick={() => { setModel("auto"); setError(null); }}
                        className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        {t("try_auto")}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setModel("mock"); setError(null); }}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        {t("try_offline")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAnalyze()}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        {t("try_retry")}
                      </button>
                    </div>
                  </div>
                )}

                {/* Full-database lookup (Sprint 2) */}
                <SearchPanel locale={locale} />
              </CardContent>
            </Card>
          </section>

          {/* Results Column */}
          <section ref={resultsRef} className="min-w-0 space-y-4 print:space-y-3">
            {/* Results header bar — print-only visible */}
            <div className="hidden print:block mb-4">
              <h1 className="text-xl font-bold">{t("app_title")}</h1>
              <p className="text-sm text-muted-foreground">{t("app_subtitle")}</p>
              <hr className="my-3" />
              <div className="text-xs">
                <div><strong>{t("app_subtitle")}</strong></div>
                <div className="mt-1"><strong>{t("input_label")}:</strong> {note}</div>
                <div className="mt-1"><strong>{t("model_label")}:</strong> {result?.model ?? model}</div>
              </div>
            </div>

            {result ? (
              <>
                {/* Results summary bar */}
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <h2 className="text-base sm:text-lg font-bold">{t("results_title")}</h2>
                  <Badge variant="outline" className="font-mono text-xs">{result.model}</Badge>
                  <Badge variant="outline" className="text-xs">
                    {t("latency")}: {result.latency_ms} {t("ms")}
                  </Badge>
                  {errorCount > 0 && <Badge className="bg-rose-600 text-white text-xs">{errorCount} {t("errors")}</Badge>}
                  {warnCount > 0 && <Badge className="bg-amber-500 text-white text-xs">{warnCount} {t("warnings")}</Badge>}
                  <div className="ml-auto flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopyJson} className="hidden sm:inline-flex">
                      {copied ? <Check className="h-3.5 w-3.5 ltr:mr-1.5 rtl:ml-1.5" /> : <Copy className="h-3.5 w-3.5 ltr:mr-1.5 rtl:ml-1.5" />}
                      {copied ? t("copied") : t("copy_json")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport}>
                      <FileDown className="h-3.5 w-3.5 ltr:mr-1.5 rtl:ml-1.5" />
                      {t("export_button")}
                    </Button>
                  </div>
                </div>

                {/* Mobile code summary strip — big, tappable, copyable */}
                <div className="rounded-xl border-2 border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 print:hidden sm:hidden">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("codes_summary")}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyAllCodes}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? t("copied") : t("copy_all_codes")}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allCodesList.map((c, idx) => (
                      <code
                        key={idx}
                        className={cn(
                          "inline-flex items-center rounded-md border px-2 py-1 font-mono text-sm font-bold",
                          idx === 0
                            ? "brand-soft-bg-strong brand-text-strong border-current"
                            : "border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        )}
                      >
                        <Hash className="mr-1 h-3 w-3 opacity-50" />
                        {c.code}
                      </code>
                    ))}
                  </div>
                </div>

                {/* Primary */}
                <CodeCard detail={result.raw_response.primary_icd10} level="primary" locale={locale} verified={verification[result.raw_response.primary_icd10.code] ?? null} />

                {/* Secondary */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h3 className="text-sm sm:text-base font-semibold">{t("secondary")}</h3>
                    <Badge variant="outline" className="text-xs">{result.raw_response.secondary_icd10.length}</Badge>
                    <InfoTooltip text={t("secondary_hint")} />
                  </div>
                  {result.raw_response.secondary_icd10.length === 0 ? (
                    <EmptyCodeCard level="secondary" locale={locale} count={0} />
                  ) : (
                    <div className="space-y-2">
                      {result.raw_response.secondary_icd10.map((c, idx) => (
                        <CodeCard key={idx} detail={c} level="secondary" locale={locale} verified={verification[c.code] ?? null} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Supplemental (tertiary) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    <h3 className="text-sm sm:text-base font-semibold">{t("tertiary")}</h3>
                    <Badge variant="outline" className="text-xs">{result.raw_response.tertiary_icd10.length}</Badge>
                    <InfoTooltip text={t("tertiary_hint")} />
                  </div>
                  {result.raw_response.tertiary_icd10.length === 0 ? (
                    <EmptyCodeCard level="tertiary" locale={locale} count={0} />
                  ) : (
                    <div className="space-y-2">
                      {result.raw_response.tertiary_icd10.map((c, idx) => (
                        <CodeCard key={idx} detail={c} level="tertiary" locale={locale} verified={verification[c.code] ?? null} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Validation */}
                <ValidationPanel issues={result.validation_issues} locale={locale} />

                {/* RAG context */}
                <RAGContextPanel
                  results={result.rag_context}
                  nlmOnline={result.rag_context.some((r) => r.source === "nlm")}
                  locale={locale}
                />

                {/* Entities extracted */}
                {result.raw_response.entities_extracted && result.raw_response.entities_extracted.length > 0 && (
                  <Card className="border-2 border-slate-200 dark:border-slate-800 print:hidden">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">{t("entities_title")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-1.5">
                        {result.raw_response.entities_extracted.map((e, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                          >
                            <Badge variant="outline" className="text-[9px] uppercase px-1 py-0">
                              {e.type.replace("_", " ")}
                            </Badge>
                            <span className="font-medium">{e.entity}</span>
                            <span className="text-muted-foreground">= {e.value}</span>
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Summary */}
                {result.raw_response.summary && (
                  <Card className="border-2 border-slate-200 dark:border-slate-800 print:hidden">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">{t("summary")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-relaxed text-foreground">{result.raw_response.summary}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Raw JSON */}
                <Card className="border-2 border-slate-200 dark:border-slate-800 print:hidden">
                  <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="pb-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <CardTitle className="flex items-center gap-2 text-base">
                          {rawOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          {t("raw_json")}
                        </CardTitle>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent>
                        <pre className="max-h-96 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100 dark:bg-black">
                          <code>{JSON.stringify(result.raw_response, null, 2)}</code>
                        </pre>
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>

                {/* Export help */}
                <p className="text-xs text-muted-foreground print:hidden">{t("export_help")}</p>
              </>
            ) : (
              !loading && (
                <Card className="border-2 border-dashed border-slate-200 dark:border-slate-800 print:hidden">
                  <CardContent className="py-12 text-center">
                    <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                      <Sparkles className="h-6 w-6 text-slate-400" />
                    </div>
                    <p className="text-sm text-muted-foreground">{t("no_results")}</p>
                  </CardContent>
                </Card>
              )
            )}

            {loading && (
              <Card className="border-2 border-emerald-200 dark:border-emerald-900 print:hidden">
                <CardContent className="py-12 text-center">
                  <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-emerald-600" />
                  <p className="text-sm text-muted-foreground">{t("analyzing")}</p>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </main>

      {/* Sticky mobile action bar — Analyze always reachable */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 pb-safe backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 print:hidden sm:hidden">
        <div className="flex gap-2">
          <Button
            onClick={() => analyzeRef.current()}
            disabled={loading || !note.trim() || overLimit}
            className="h-12 flex-1 brand-bg brand-fg text-base"
            style={{ backgroundColor: "var(--brand)" }}
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 ltr:mr-2 rtl:ml-2 animate-spin" />
                {t("analyzing")}
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5 ltr:mr-2 rtl:ml-2" />
                {t("analyze_button")}
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={loading}
            className="h-12 w-12 p-0"
            aria-label={t("clear_button")}
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200/70 bg-white/60 py-3 pb-safe dark:border-slate-800/70 dark:bg-slate-950/60 print:hidden sm:pb-3">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <p className="text-center text-xs text-muted-foreground">{t("footer")}</p>
          <p className="mt-1 text-center text-[11px] leading-snug text-muted-foreground/80">{t("snomed_attribution")}</p>
        </div>
      </footer>
    </div>
  );
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/70" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-md border border-slate-200 bg-white p-2.5 text-[11px] font-normal leading-snug text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 ltr:left-0 rtl:right-0 ltr:translate-x-0 rtl:translate-x-0 sm:ltr:left-1/2 sm:rtl:right-auto sm:rtl:left-1/2 sm:-translate-x-1/2">
        {text}
      </span>
    </span>
  );
}
