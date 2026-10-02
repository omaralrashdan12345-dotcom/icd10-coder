"use client";

import { Activity, Hash, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { CodingResult, CodedTerm } from "@/lib/snomed/types";
import type { Locale } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";

const ROLE_STYLES: Record<CodedTerm["role"], string> = {
  primary: "brand-soft-bg-strong brand-text-strong",
  secondary: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300",
  supplemental: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
};

export interface SnomedPanelProps {
  result: CodingResult | null;
  loading: boolean;
  locale: Locale;
  /** ICD-10-CM codes from the main coding result, for the SNOMED-map cross-check */
  icdCodes?: string[];
}

export function SnomedPanel({ result, loading, locale, icdCodes = [] }: SnomedPanelProps) {
  if (loading) {
    return (
      <Card className="border-2 border-slate-200 dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            {t(locale, "snomed_panel_title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t(locale, "analyzing")}…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result || result.results.length === 0) {
    return (
      <Card className="border-2 border-slate-200 dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            {t(locale, "snomed_panel_title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t(locale, "snomed_no_auto")}</p>
        </CardContent>
      </Card>
    );
  }

  const normCat = (code: string) => code.replace(/\./g, "").slice(0, 3).toUpperCase();
  const icdCats = new Set(icdCodes.map(normCat));
  const mismatches = icdCats.size
    ? result.results.flatMap((rt) => {
        if (!rt.chosen) return [];
        const chosen = rt.candidates.find((c) => c.conceptId === rt.chosen);
        if (!chosen || chosen.icd10cm.length === 0) return [];
        if (chosen.icd10cm.some((m) => icdCats.has(normCat(m.code)))) return [];
        return [{ pt: chosen.pt, codes: chosen.icd10cm.map((m) => m.code) }];
      })
    : [];

  return (
    <Card className="border-2 border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          {t(locale, "snomed_panel_title")}
          <Badge variant="outline" className="text-xs">{result.results.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {mismatches.length > 0 && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs dark:border-amber-900 dark:bg-amber-950/40">
            <p className="font-semibold text-amber-800 dark:text-amber-300">{t(locale, "snomed_map_mismatch")}</p>
            <p className="mt-1 text-amber-700 dark:text-amber-400">
              {mismatches.map((m) => `${m.pt} → ${m.codes.join(", ")}`).join(" · ")}
            </p>
          </div>
        )}
        <div className="space-y-2">
          {result.results.map((rt, i) => {
            const chosen = rt.chosen ? rt.candidates.find((c) => c.conceptId === rt.chosen) : null;
            return (
              <div key={i} className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{rt.term}</p>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold", ROLE_STYLES[rt.role] ?? ROLE_STYLES.supplemental)}>
                    {rt.role}
                  </span>
                </div>
                {chosen ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Hash className="h-3 w-3 text-sky-600 dark:text-sky-400" />
                      <code className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                        {chosen.conceptId}
                      </code>
                      <span className="text-sm font-medium text-foreground">{chosen.pt}</span>
                      {chosen.tag && (
                        <Badge variant="outline" className="text-[10px] tracking-wide uppercase">{chosen.tag}</Badge>
                      )}
                    </div>
                    {chosen.fsn && <p className="text-xs italic text-muted-foreground">{chosen.fsn}</p>}
                    {chosen.icd10cm.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {t(locale, "snomed_map_label")}
                        </span>
                        {chosen.icd10cm.map((m) => (
                          <code
                            key={m.code}
                            title={m.name}
                            className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          >
                            {m.code}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2">
                    <p className="text-xs text-amber-600 dark:text-amber-400">{t(locale, "snomed_review")}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {rt.candidates.map((c, idx) => (
                        <code key={idx} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {c.conceptId} · {c.pt}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
