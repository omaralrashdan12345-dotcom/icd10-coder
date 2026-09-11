"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ShieldCheck, Activity, MapPin, Clock, Hash, Copy, Check } from "lucide-react";
import type { ICDCodeDetail } from "@/lib/schemas/icd";
import type { Locale } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";

interface CodeCardProps {
  detail: ICDCodeDetail;
  level: "primary" | "secondary" | "tertiary";
  locale: Locale;
}

const LEVEL_STYLES: Record<
  CodeCardProps["level"],
  { border: string; bg: string; chip: string; icon: typeof Activity }
> = {
  primary: {
    border: "border-brand",
    bg: "brand-soft-bg",
    chip: "brand-bg brand-fg",
    icon: Activity,
  },
  secondary: {
    border: "border-amber-600/40",
    bg: "bg-amber-50/50 dark:bg-amber-950/20",
    chip: "bg-amber-600 text-white",
    icon: ShieldCheck,
  },
  tertiary: {
    border: "border-slate-500/40",
    bg: "bg-slate-50/60 dark:bg-slate-900/40",
    chip: "bg-slate-600 text-white",
    icon: Hash,
  },
};

function confidenceColor(c: number): string {
  if (c >= 0.85) return "brand-text-strong";
  if (c >= 0.6) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function confidenceBarColor(c: number): string {
  if (c >= 0.85) return "brand-bg";
  if (c >= 0.6) return "bg-amber-500";
  return "bg-rose-500";
}

function lateralityLabel(v: ICDCodeDetail["laterality"], locale: Locale): string {
  switch (v) {
    case "right": return t(locale, "right");
    case "left": return t(locale, "left");
    case "bilateral": return t(locale, "bilateral");
    case "unspecified": return t(locale, "unspecified");
    default: return t(locale, "not_applicable");
  }
}

function acuityLabel(v: ICDCodeDetail["acuity"], locale: Locale): string {
  switch (v) {
    case "acute": return t(locale, "acute");
    case "chronic": return t(locale, "chronic");
    case "acute_on_chronic": return t(locale, "acute_on_chronic");
    case "unspecified": return t(locale, "unspecified");
    default: return t(locale, "not_applicable");
  }
}

function seventhCharLabel(v: ICDCodeDetail["seventh_character"], locale: Locale): string {
  switch (v) {
    case "A": return t(locale, "char_a");
    case "B": return t(locale, "char_b");
    case "C": return t(locale, "char_c");
    case "D": return t(locale, "char_d");
    case "S": return t(locale, "char_s");
    case "G": return t(locale, "char_g");
    case "K": return t(locale, "char_k");
    case "P": return t(locale, "char_p");
    case "not_required": return t(locale, "char_not_required");
    case "missing": return t(locale, "char_missing");
    default: return t(locale, "not_applicable");
  }
}

function seventhCharBadgeClass(v: ICDCodeDetail["seventh_character"]): string {
  if (v === "missing") return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
  if (v === "A" || v === "B" || v === "C" || v === "D" || v === "S" || v === "G" || v === "K" || v === "P") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export function CodeCard({ detail, level, locale }: CodeCardProps) {
  const style = LEVEL_STYLES[level];
  const Icon = style.icon;
  const levelLabel = level === "primary" ? t(locale, "level_primary") : level === "secondary" ? t(locale, "level_secondary") : t(locale, "level_tertiary");
  const confidence = typeof detail.confidence === "number" ? detail.confidence : 0;
  const [copiedCode, setCopiedCode] = useState(false);

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(detail.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <Card className={cn("border-2 shadow-sm transition-shadow hover:shadow-md", style.border, style.bg)}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", style.chip)}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <code className="font-mono text-lg sm:text-xl font-bold tracking-tight text-foreground">{detail.code}</code>
                <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", style.chip)}>{levelLabel}</Badge>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white/80 text-slate-500 transition hover:brand-soft-bg hover:brand-text-strong dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400"
                  aria-label={t(locale, "copy_code")}
                  title={t(locale, "copy_code")}
                >
                  {copiedCode ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground leading-snug break-words">{detail.description}</p>
            </div>
          </div>
          <div className="text-left rtl:text-right shrink-0">
            <div className={cn("text-xs font-medium", confidenceColor(confidence))}>
              {t(locale, "confidence")}: {(confidence * 100).toFixed(0)}%
            </div>
            <Progress value={confidence * 100} className={cn("mt-1 h-1.5 w-24", "[&>div]:", confidenceBarColor(confidence))} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <MapPin className="h-3 w-3" />
            {t(locale, "laterality")}: {lateralityLabel(detail.laterality, locale)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <Clock className="h-3 w-3" />
            {t(locale, "acuity")}: {acuityLabel(detail.acuity, locale)}
          </span>
          <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs", seventhCharBadgeClass(detail.seventh_character))}>
            <Hash className="h-3 w-3" />
            {t(locale, "seventh_char")}: {seventhCharLabel(detail.seventh_character, locale)}
          </span>
        </div>
        <div className="rounded-md border border-border/60 bg-background/60 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(locale, "rationale")}
          </div>
          <p className="text-sm leading-relaxed text-foreground">{detail.rationale}</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface EmptyCodeCardProps {
  level: "primary" | "secondary" | "tertiary";
  locale: Locale;
  count: number;
}

export function EmptyCodeCard({ level, locale, count }: EmptyCodeCardProps) {
  const style = LEVEL_STYLES[level];
  const Icon = style.icon;
  const levelLabel = level === "primary" ? t(locale, "level_primary") : level === "secondary" ? t(locale, "level_secondary") : t(locale, "level_tertiary");
  const targetCount = level === "primary" ? 1 : 0;

  return (
    <Card className={cn("border-2 border-dashed opacity-60", style.border, "bg-muted/20")}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg", style.chip)}>
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", style.chip)}>{levelLabel}</Badge>
            <p className="mt-1 text-sm text-muted-foreground">
              {level === "primary"
                ? locale === "ar" ? "في انتظار التحليل…" : "Awaiting analysis…"
                : locale === "ar" ? `${count} رمز ثانوي` : `${count} ${level} codes`}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
          {targetCount === 1 ? (locale === "ar" ? "—" : "—") : (locale === "ar" ? "لا توجد رموز" : "no codes")}
        </div>
      </CardContent>
    </Card>
  );
}

export function ValidationAlertIcon({ level }: { level: "error" | "warning" | "info" }) {
  if (level === "error") return <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />;
  if (level === "warning") return <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />;
  return <ShieldCheck className="h-4 w-4 brand-text shrink-0" />;
}
