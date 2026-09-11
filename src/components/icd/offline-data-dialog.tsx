"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Database, RefreshCw, Loader2, CheckCircle2, XCircle, HardDriveDownload, CloudDownload, Trash2 } from "lucide-react";
import type { Locale } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";
import {
  subscribeFullDb,
  ensureFullDbSeeded,
  refreshFromNlmLive,
  clearFullDb,
  type FullDbStatus,
} from "@/lib/icd/full-db";

/**
 * Offline full-database manager (Sprint 2).
 * Shows the bundled snapshot version, seeds IndexedDB from the bundled
 * chunks, and offers a live refresh from the NLM API with progress.
 */
export function OfflineDataDialog({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [dbStatus, setDbStatus] = useState<FullDbStatus | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => subscribeFullDb(setDbStatus), []);

  async function handleSeed() {
    setSeeding(true);
    setActionError(null);
    try {
      await ensureFullDbSeeded();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function handleRefresh() {
    setActionError(null);
    try {
      await refreshFromNlmLive();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  const ready = dbStatus?.state === "ready";
  const isAr = locale === "ar";

  function fmtVersion(v: string | null): string {
    if (!v) return "—";
    if (v.startsWith("live-")) {
      try {
        return new Date(v.slice(5)).toLocaleString(isAr ? "ar" : "en-US", { dateStyle: "medium", timeStyle: "short" });
      } catch {
        return v;
      }
    }
    try {
      return new Date(v).toLocaleDateString(isAr ? "ar" : "en-US", { dateStyle: "medium" });
    } catch {
      return v;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t(locale, "offline_db_title")} title={t(locale, "offline_db_title")}>
          <Database className="h-4 w-4" />
          <span className="hidden sm:inline ltr:ml-2 rtl:mr-2">{t(locale, "offline_db_title")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            {t(locale, "offline_db_title")}
          </DialogTitle>
          <DialogDescription>{t(locale, "offline_db_desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm font-medium">{t(locale, "offline_db_status")}</span>
              {ready ? (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {t(locale, "offline_db_ready")}
                </Badge>
              ) : dbStatus?.state === "seeding" ? (
                <Badge variant="outline" className="text-amber-600 border-amber-400">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  {t(locale, "offline_db_loading")}
                </Badge>
              ) : dbStatus?.state === "error" ? (
                <Badge variant="outline" className="text-rose-600 border-rose-400">
                  <XCircle className="h-3 w-3 mr-1" />
                  {t(locale, "offline_db_error")}
                </Badge>
              ) : (
                <Badge variant="outline">{t(locale, "offline_db_not_loaded")}</Badge>
              )}
            </div>
            {ready && dbStatus && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt className="font-medium text-foreground">{t(locale, "offline_db_codes")}</dt>
                <dd className="tabular-nums">
                  {dbStatus.total.toLocaleString()}
                  {dbStatus.billable !== null &&
                    ` (${dbStatus.billable.toLocaleString()} ${t(locale, "offline_db_billable_short")})`}
                </dd>
                <dt className="font-medium text-foreground">{t(locale, "offline_db_source")}</dt>
                <dd>{dbStatus.source === "nlm-live" ? t(locale, "offline_db_source_live") : t(locale, "offline_db_source_bundled")}</dd>
                <dt className="font-medium text-foreground">{t(locale, "offline_db_version")}</dt>
                <dd>{fmtVersion(dbStatus.version)}</dd>
              </dl>
            )}
            {dbStatus?.state === "error" && dbStatus.error && (
              <p className="text-xs text-rose-600 dark:text-rose-400 break-words">{dbStatus.error}</p>
            )}
          </div>

          {dbStatus?.refreshing && dbStatus.refreshProgress !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t(locale, "offline_db_refreshing")}</span>
                <span className="tabular-nums">{Math.round(dbStatus.refreshProgress * 100)}%</span>
              </div>
              <Progress value={dbStatus.refreshProgress * 100} className="h-2" />
            </div>
          )}

          {actionError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 rounded-md p-2 break-words">
              {actionError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!ready && (
              <Button onClick={handleSeed} disabled={seeding || dbStatus?.state === "seeding"} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {seeding || dbStatus?.state === "seeding" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <HardDriveDownload className="h-4 w-4 mr-2" />
                )}
                {t(locale, "offline_db_load_btn")}
              </Button>
            )}
            <Button
              onClick={handleRefresh}
              disabled={dbStatus?.refreshing || dbStatus?.state === "seeding"}
              size="sm"
              variant="outline"
              title={t(locale, "offline_db_refresh_hint")}
            >
              {dbStatus?.refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CloudDownload className="h-4 w-4 mr-2" />}
              {t(locale, "offline_db_refresh_btn")}
            </Button>
            {ready && (
              <Button onClick={() => clearFullDb().catch(() => {})} size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                {t(locale, "offline_db_clear")}
              </Button>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <RefreshCw className="h-3 w-3 inline ltr:mr-1 rtl:ml-1" />
            {t(locale, "offline_db_footnote")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
