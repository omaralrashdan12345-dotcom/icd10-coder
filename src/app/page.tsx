"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  LogOut,
} from "lucide-react";
import {
  translations,
  SAMPLE_CASES,
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
import { LoginCard } from "@/components/icd/login-card";
import { SettingsDialog, buildProviderKeysHeader } from "@/components/icd/settings-dialog";

function useLocale(): [Locale, (l: Locale) => void, (k: TranslationKey) => string] {
  const [locale, setLocale] = useState<Locale>("ar");
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = translations[locale].dir;
  }, [locale]);
  const tFn = (k: TranslationKey) => translations[locale][k];
  return [locale, setLocale, tFn];
}

export default function Home() {
  const { data: session, status } = useSession();
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
  const resultsRef = useRef<HTMLDivElement>(null);

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

  // Loading state while NextAuth resolves the session
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-sm text-muted-foreground">…</p>
        </div>
      </div>
    );
  }

  // Unauthenticated → show login card
  if (status === "unauthenticated" || !session) {
    return <LoginCard locale={locale} />;
  }

  const userName = session.user?.name ?? "Omar";
  const userInitial = userName.charAt(0).toUpperCase();

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

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-950/80 print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <HeartPulse className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight text-foreground sm:text-lg">
                {t("app_title")}
              </h1>
              <p className="hidden text-xs text-muted-foreground sm:block">{t("app_subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              aria-label="Toggle language"
            >
              <Languages className="h-4 w-4 ltr:mr-2 rtl:ml-2" />
              <span className="hidden sm:inline">{t("language_toggle")}</span>
            </Button>
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 ltr:pl-1 ltr:pr-2 rtl:pr-1 rtl:pl-2 dark:border-slate-700 dark:bg-slate-900">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-emerald-600 text-white text-xs font-semibold">
                  {userInitial}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col leading-tight">
                <span className="text-[10px] text-muted-foreground">{t("welcome")}</span>
                <span className="text-xs font-semibold text-foreground">{userName}</span>
              </div>
            </div>
            <SettingsDialog locale={locale} onKeysChanged={() => setProvidersVersion((v) => v + 1)} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/" })}
              aria-label={t("logout_button")}
              title={t("logout_button")}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline ltr:ml-2 rtl:mr-2">{t("logout_button")}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="grid gap-6 lg:grid-cols-2 print:block">
          {/* Input Column */}
          <section className="space-y-4 print:hidden">
            <Card className="border-2 border-slate-200 dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
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
                    <SelectTrigger id="model-select" className="w-full">
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
                                    className="text-[9px] uppercase px-1 py-0 h-3.5 bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                                  >
                                    {locale === "ar" ? "مجاني" : "FREE"}
                                  </Badge>
                                )}
                                {configured ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] uppercase px-1 py-0 h-3.5 bg-slate-50 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                                  >
                                    {locale === "ar" ? "جاهز" : "ready"}
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
                      <summary className="cursor-pointer text-emerald-600 dark:text-emerald-400 hover:underline">
                        {locale === "ar" ? "كيف تحصل على مفاتيح API مجانية؟" : "How to get free API keys?"}
                      </summary>
                      <ul className="mt-2 space-y-1 text-muted-foreground ltr:ml-4 rtl:mr-4 list-disc">
                        <li>
                          <strong>Groq</strong> (free, ultra-fast Llama 3.3 70B):{" "}
                          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:underline">
                            console.groq.com/keys
                          </a>{" "}
                          → set <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">GROQ_API_KEY</code>
                        </li>
                        <li>
                          <strong>Google Gemini</strong> (free, 1M context):{" "}
                          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:underline">
                            aistudio.google.com/app/apikey
                          </a>{" "}
                          → set <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">GEMINI_API_KEY</code>
                        </li>
                        <li>
                          <strong>OpenRouter</strong> (free Llama / Gemma):{" "}
                          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-emerald-600 dark:text-emerald-400 hover:underline">
                            openrouter.ai/keys
                          </a>{" "}
                          → set <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">OPENROUTER_API_KEY</code>
                        </li>
                      </ul>
                    </details>
                  )}
                </div>

                {/* Sample cases */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">{t("sample_cases")}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {SAMPLE_CASES.map((c, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setNote(c.text)}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300"
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
                      "resize-y text-sm leading-relaxed",
                      overLimit && "border-rose-400 focus-visible:ring-rose-400"
                    )}
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn("text-muted-foreground", overLimit && "text-rose-600 font-medium")}>
                      {charCount} / {maxChars}
                    </span>
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={handleAnalyze}
                    disabled={loading || !note.trim() || overLimit}
                    className="flex-1 min-w-[140px] bg-emerald-600 hover:bg-emerald-700 text-white"
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
                        <div className="font-semibold mb-1">{locale === "ar" ? "خطأ في التحليل" : "Analysis failed"}</div>
                        <div className="break-words text-xs leading-relaxed">{error}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="text-muted-foreground">{locale === "ar" ? "جرّب:" : "Try:"}</span>
                      <button
                        type="button"
                        onClick={() => { setModel("auto"); setError(null); }}
                        className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        {locale === "ar" ? "تبديل إلى Auto (يحاول GLM ثم يعمل دون اتصال)" : "Switch to Auto (tries GLM then offline)"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setModel("mock"); setError(null); }}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-medium text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        {locale === "ar" ? "تبديل إلى المُرمّز الذكي (دون اتصال)" : "Switch to Smart Offline Coder"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setModel("glm-4-flash"); setError(null); }}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-medium text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        {locale === "ar" ? "تبديل إلى GLM-4-Flash (مجاني)" : "Switch to GLM-4-Flash (free)"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAnalyze()}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-medium text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        {locale === "ar" ? "إعادة المحاولة" : "Retry"}
                      </button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Results Column */}
          <section ref={resultsRef} className="space-y-4 print:space-y-3">
            {/* Results header bar — print-only visible */}
            <div className="hidden print:block mb-4">
              <h1 className="text-xl font-bold">{t("app_title")}</h1>
              <p className="text-sm text-muted-foreground">{t("app_subtitle")}</p>
              <hr className="my-3" />
              <div className="text-xs">
                <div><strong>{t("signed_in_as")}:</strong> {userName}</div>
                <div className="mt-1"><strong>{t("input_label")}:</strong> {note}</div>
                <div className="mt-1"><strong>{t("model_label")}:</strong> {result?.model ?? model}</div>
              </div>
            </div>

            {result ? (
              <>
                {/* Results summary bar */}
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <h2 className="text-base font-bold">{t("results_title")}</h2>
                  <Badge variant="outline" className="font-mono text-xs">{result.model}</Badge>
                  <Badge variant="outline" className="text-xs">
                    {t("latency")}: {result.latency_ms} {t("ms")}
                  </Badge>
                  {errorCount > 0 && <Badge className="bg-rose-600 text-white text-xs">{errorCount} {t("errors")}</Badge>}
                  {warnCount > 0 && <Badge className="bg-amber-500 text-white text-xs">{warnCount} {t("warnings")}</Badge>}
                  <div className="ml-auto flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopyJson}>
                      {copied ? <Check className="h-3.5 w-3.5 ltr:mr-1.5 rtl:ml-1.5" /> : <Copy className="h-3.5 w-3.5 ltr:mr-1.5 rtl:ml-1.5" />}
                      {copied ? t("copied") : t("copy_json")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport}>
                      <FileDown className="h-3.5 w-3.5 ltr:mr-1.5 rtl:ml-1.5" />
                      {t("export_button")}
                    </Button>
                  </div>
                </div>

                {/* Primary */}
                <CodeCard detail={result.raw_response.primary_icd10} level="primary" locale={locale} />

                {/* Secondary */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <h3 className="text-sm font-semibold">{t("secondary")}</h3>
                    <Badge variant="outline" className="text-xs">{result.raw_response.secondary_icd10.length}</Badge>
                  </div>
                  {result.raw_response.secondary_icd10.length === 0 ? (
                    <EmptyCodeCard level="secondary" locale={locale} count={0} />
                  ) : (
                    <div className="space-y-2">
                      {result.raw_response.secondary_icd10.map((c, idx) => (
                        <CodeCard key={idx} detail={c} level="secondary" locale={locale} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Tertiary */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    <h3 className="text-sm font-semibold">{t("tertiary")}</h3>
                    <Badge variant="outline" className="text-xs">{result.raw_response.tertiary_icd10.length}</Badge>
                  </div>
                  {result.raw_response.tertiary_icd10.length === 0 ? (
                    <EmptyCodeCard level="tertiary" locale={locale} count={0} />
                  ) : (
                    <div className="space-y-2">
                      {result.raw_response.tertiary_icd10.map((c, idx) => (
                        <CodeCard key={idx} detail={c} level="tertiary" locale={locale} />
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

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200/70 bg-white/60 py-3 dark:border-slate-800/70 dark:bg-slate-950/60 print:hidden">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <p className="text-center text-xs text-muted-foreground">{t("footer")}</p>
        </div>
      </footer>
    </div>
  );
}
