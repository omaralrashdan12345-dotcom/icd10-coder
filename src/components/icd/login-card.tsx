"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HeartPulse, Loader2, LogIn, AlertTriangle } from "lucide-react";
import type { Locale } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";
import { DEMO_USERNAME, DEMO_PASSWORD } from "@/lib/auth";

interface LoginCardProps {
  locale: Locale;
  callbackUrl?: string;
}

export function LoginCard({ locale, callbackUrl = "/" }: LoginCardProps) {
  const [username, setUsername] = useState(DEMO_USERNAME);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
      callbackUrl,
    });
    setLoading(false);
    if (!res || res.error) {
      setError(t(locale, "login_error"));
    }
    // On success, the session will refresh and the parent component will re-render
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-md border-2 border-emerald-200 dark:border-emerald-900 shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md">
            <HeartPulse className="h-8 w-8" />
          </div>
          <CardTitle className="text-xl">{t(locale, "login_title")}</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">{t(locale, "login_subtitle")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs font-medium text-muted-foreground">
                {t(locale, "username_label")}
              </Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loading}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                {t(locale, "password_label")}
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className="text-sm"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 ltr:mr-2 rtl:ml-2 animate-spin" />
                  {t(locale, "logging_in")}
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4 ltr:mr-2 rtl:ml-2" />
                  {t(locale, "login_button")}
                </>
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground pt-1">
              {t(locale, "demo_hint")}
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
