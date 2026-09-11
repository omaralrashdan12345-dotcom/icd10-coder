"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck, Info, Database, Wifi, WifiOff } from "lucide-react";
import type { ValidationIssue } from "@/lib/schemas/icd";
import type { Locale } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";
import { ValidationAlertIcon } from "./code-card";

interface ValidationPanelProps {
  issues: ValidationIssue[];
  locale: Locale;
}

export function ValidationPanel({ issues, locale }: ValidationPanelProps) {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const infos = issues.filter((i) => i.level === "info");

  return (
    <Card className="border-2 border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5 brand-text" />
          {t(locale, "validation_title")}
          {issues.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              {errors.length > 0 && <Badge className="bg-rose-600 text-white">{errors.length} {t(locale, "errors")}</Badge>}
              {warnings.length > 0 && <Badge className="bg-amber-500 text-white">{warnings.length} {t(locale, "warnings")}</Badge>}
              {infos.length > 0 && <Badge className="bg-slate-500 text-white">{infos.length} {t(locale, "info")}</Badge>}
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {issues.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md brand-soft-bg p-3 text-sm brand-muted-text">
            <ShieldCheck className="h-4 w-4" />
            {t(locale, "no_validation")}
          </div>
        ) : (
          issues.map((issue, idx) => <ValidationIssueRow key={idx} issue={issue} locale={locale} />)
        )}
      </CardContent>
    </Card>
  );
}

function ValidationIssueRow({ issue, locale }: { issue: ValidationIssue; locale: Locale }) {
  const bgClass =
    issue.level === "error"
      ? "bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900"
      : issue.level === "warning"
      ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900"
      : "bg-slate-50 border-slate-200 dark:bg-slate-900/40 dark:border-slate-800";

  return (
    <div className={cn("rounded-md border p-3", bgClass)}>
      <div className="flex items-start gap-2">
        <ValidationAlertIcon level={issue.level} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-xs font-semibold text-foreground">{issue.rule}</code>
            {issue.code && <code className="font-mono text-xs text-muted-foreground">→ {issue.code}</code>}
          </div>
          <p className="mt-1 text-sm text-foreground leading-relaxed">
            {locale === "ar" ? issue.message_ar : issue.message_en}
          </p>
          {(issue.suggestion_en || issue.suggestion_ar) && (
            <p className="mt-1 text-xs text-muted-foreground italic">
              {locale === "ar" ? issue.suggestion_ar : issue.suggestion_en}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface RAGContextPanelProps {
  results: { code: string; description: string; score: number; source: string }[];
  nlmOnline: boolean | null;
  locale: Locale;
}

export function RAGContextPanel({ results, nlmOnline, locale }: RAGContextPanelProps) {
  return (
    <Card className="border-2 border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          {t(locale, "rag_context_title")}
          <div className="ml-auto">
            {nlmOnline === null ? null : nlmOnline ? (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <Wifi className="h-3 w-3 mr-1" />
                {t(locale, "nlm_status_ok")}
              </Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                <WifiOff className="h-3 w-3 mr-1" />
                {t(locale, "nlm_status_fail")}
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">{t(locale, "rag_empty")}</div>
        ) : (
          <ul className="space-y-1.5">
            {results.map((r, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 font-mono text-[10px]",
                    r.source === "nlm"
                      ? "border-brand text-[var(--brand-muted-text)]"
                      : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  )}
                >
                  {r.source === "nlm" ? "NLM" : "VEC"}
                </Badge>
                <code className="font-mono text-xs font-semibold shrink-0">{r.code}</code>
                <span className="text-xs text-muted-foreground min-w-0 flex-1 truncate">{r.description}</span>
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                  {r.score.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
