"use client";

import { ChevronDown, History, RotateCcw, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

import type { HistoryEntry } from "@/lib/history";
import type { Locale } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";

export interface HistoryPanelProps {
  entries: HistoryEntry[];
  open: boolean;
  onToggle: () => void;
  onRestore: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  locale: Locale;
}

export function HistoryPanel({ entries, open, onToggle, onRestore, onDelete, onClear, locale }: HistoryPanelProps) {
  return (
    <Card className="border-2 border-slate-200 dark:border-slate-800 print:hidden">
      <CardHeader className="pb-3">
        <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 text-left">
          <History className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          <span className="text-base font-semibold">{t(locale, "history_title")}</span>
          <Badge variant="outline" className="text-xs">{entries.length}</Badge>
          <ChevronDown className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CardHeader>
      {open && (
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(locale, "history_empty")}</p>
          ) : (
            <>
              <div className="space-y-2">
                {entries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
                    <button type="button" onClick={() => onRestore(e)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-medium">{e.note}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{new Date(e.ts).toLocaleString()}</span>
                        {e.result.raw_response.primary_icd10 && (
                          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {e.result.raw_response.primary_icd10.code}
                          </code>
                        )}
                        {e.snomed && e.snomed.results.some((r) => r.chosen) && (
                          <span className="font-medium text-sky-600 dark:text-sky-400">
                            {e.snomed.results.filter((r) => r.chosen).length} SNOMED
                          </span>
                        )}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onRestore(e)}
                        title={t(locale, "history_restore")}
                        className="rounded-md p-1.5 text-sky-600 transition hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(e.id)}
                        title={t(locale, "history_delete")}
                        className="rounded-md p-1.5 text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={onClear}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t(locale, "history_clear")}
                </button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
