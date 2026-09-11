"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Database, Loader2, Copy, Check, Sparkles, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";
import {
  subscribeFullDb,
  ensureFullDbSeeded,
  searchFullDb,
  type FullDbSearchResult,
  type FullDbStatus,
} from "@/lib/icd/full-db";

interface CuratedResult {
  code: string;
  description: string;
  source: string;
}

interface DisplayResult extends FullDbSearchResult {
  origin: "full" | "curated" | "nlm";
}

/**
 * ICD-10-CM lookup panel (Sprint 2).
 * Searches the FULL offline database (~74k codes) in the browser once it is
 * seeded, and merges results from the curated vector DB + NLM via
 * /api/icd-search for cross-checking.
 */
export function SearchPanel({ locale }: { locale: Locale }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fullResults, setFullResults] = useState<DisplayResult[]>([]);
  const [curatedResults, setCuratedResults] = useState<DisplayResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dbStatus, setDbStatus] = useState<FullDbStatus | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);

  useEffect(() => subscribeFullDb(setDbStatus), []);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebounced(query.trim()), 220);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  const dbState = dbStatus?.state ?? "idle";
  const dbVersion = dbStatus?.version ?? null;

  // Full-DB search (local, instant)
  useEffect(() => {
    const id = ++reqId.current;
    async function run() {
      if (!dbStatus || dbStatus.state !== "ready" || debounced.length < 2) {
        setFullResults([]);
        return;
      }
      try {
        const res = await searchFullDb(debounced, 8);
        if (id !== reqId.current) return;
        setFullResults(res.map((r) => ({ ...r, origin: "full" as const })));
      } catch {
        if (id === reqId.current) setFullResults([]);
      }
    }
    run();
  }, [debounced, dbState, dbVersion]);

  // Curated + NLM cross-check (server)
  useEffect(() => {
    const id = reqId.current;
    if (debounced.length < 2) {
      setCuratedResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/icd-search?q=${encodeURIComponent(debounced)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (id !== reqId.current) return;
        const rows = (data?.results ?? []) as CuratedResult[];
        setCuratedResults(
          rows.slice(0, 5).map((r) => ({
            code: r.code,
            description: r.description,
            score: 0,
            chapter: null,
            chapterId: null,
            origin: r.source === "nlm" ? ("nlm" as const) : ("curated" as const),
          }))
        );
      } catch {
        // aborted or network error — leave as-is
      } finally {
        if (id === reqId.current) setSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [debounced]);

  // Dedupe: full results win over curated for the same code
  const seen = new Set(fullResults.map((r) => r.code));
  const merged = [...fullResults, ...curatedResults.filter((r) => !seen.has(r.code))];
  const dbReady = dbStatus?.state === "ready";

  function handleCopy(code: string) {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopiedCode(code);
        setTimeout(() => setCopiedCode(null), 1400);
      },
      () => {}
    );
  }

  function handleFocus() {
    setOpen(true);
    // Seed lazily on first interaction so the first search is instant offline
    if (dbStatus?.state === "idle" || dbStatus?.state === "error") {
      ensureFullDbSeeded().catch(() => {});
    }
  }



  return (
    <Card className="border-2 border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-5 w-5 brand-text" />
          {t(locale, "search_title")}
          {dbReady ? (
            <Badge variant="outline" className="text-[10px] border-emerald-400 text-emerald-700 dark:text-emerald-300">
              <Database className="h-3 w-3 mr-1" />
              {t(locale, "search_full_db_on")}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              <Database className="h-3 w-3 mr-1" />
              {t(locale, "search_curated_only")}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={handleFocus}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            placeholder={t(locale, "search_placeholder")}
            className="pl-9"
            aria-label={t(locale, "search_title")}
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {open && debounced.length >= 2 && merged.length > 0 && (
          <ul className="space-y-1 max-h-72 overflow-y-auto rounded-md border p-1.5 bg-background">
            {merged.map((r) => (
              <li key={`${r.origin}-${r.code}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleCopy(r.code)}
                  className="w-full flex items-start gap-2 rounded px-2 py-1.5 text-left hover:brand-soft-bg transition-colors group"
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 font-mono text-[9px] uppercase mt-0.5",
                      r.origin === "full" && "border-emerald-400 text-emerald-700 dark:text-emerald-300",
                      r.origin === "curated" && "border-slate-400 text-slate-600 dark:text-slate-300",
                      r.origin === "nlm" && "border-sky-400 text-sky-700 dark:text-sky-300"
                    )}
                  >
                    {r.origin === "full" ? "FULL" : r.origin === "nlm" ? "NLM" : "CUR"}
                  </Badge>
                  <code className="font-mono text-xs font-semibold shrink-0 mt-0.5">{r.code}</code>
                  <span className="text-xs text-muted-foreground min-w-0 flex-1">{r.description}</span>
                  <span className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {copiedCode === r.code ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {open && debounced.length >= 2 && !searching && merged.length === 0 && (
          <p className="text-xs text-muted-foreground px-1">{t(locale, "search_no_results")}</p>
        )}

        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          {dbReady ? (
            <>
              <Database className="h-3 w-3" />
              {t(locale, "search_hint_full")}
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              {t(locale, "search_hint_curated")}
            </>
          )}
          <Wifi className="h-3 w-3 ltr:ml-2 rtl:mr-2" />
          {t(locale, "search_hint_nlm")}
        </p>
      </CardContent>
    </Card>
  );
}
