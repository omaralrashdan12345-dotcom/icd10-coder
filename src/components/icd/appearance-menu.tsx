"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Palette, Check, Sun, Moon, Monitor, Type } from "lucide-react";
import type { Locale } from "@/lib/i18n/translations";
import { t, type TranslationKey } from "@/lib/i18n/translations";

export type ThemeId = "emerald" | "ocean" | "violet" | "rose" | "amber" | "mono";
export type FontSizeId = "sm" | "md" | "lg" | "xl";
export type DarkModeId = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "icd10_theme";
const FONT_STORAGE_KEY = "icd10_font";
const DARK_STORAGE_KEY = "icd10_dark";

const THEMES: { id: ThemeId; labelKey: TranslationKey; swatch: string }[] = [
  { id: "emerald", labelKey: "theme_emerald", swatch: "#059669" },
  { id: "ocean", labelKey: "theme_ocean", swatch: "#0284c7" },
  { id: "violet", labelKey: "theme_violet", swatch: "#7c3aed" },
  { id: "rose", labelKey: "theme_rose", swatch: "#e11d48" },
  { id: "amber", labelKey: "theme_amber", swatch: "#d97706" },
  { id: "mono", labelKey: "theme_mono", swatch: "#334155" },
];

const FONT_SIZES: { id: FontSizeId; labelKey: TranslationKey; sample: string }[] = [
  { id: "sm", labelKey: "font_small", sample: "A" },
  { id: "md", labelKey: "font_normal", sample: "A" },
  { id: "lg", labelKey: "font_large", sample: "A" },
  { id: "xl", labelKey: "font_xl", sample: "A" },
];

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

function applyFont(size: FontSizeId) {
  document.documentElement.setAttribute("data-font", size);
  try {
    localStorage.setItem(FONT_STORAGE_KEY, size);
  } catch {
    /* ignore */
  }
}

function applyDark(mode: DarkModeId) {
  const root = document.documentElement;
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  root.classList.toggle("dark", dark);
  try {
    localStorage.setItem(DARK_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function AppearanceMenu({ locale }: { locale: Locale }) {
  const [theme, setTheme] = useState<ThemeId>("emerald");
  const [font, setFont] = useState<FontSizeId>("md");
  const [dark, setDark] = useState<DarkModeId>("system");

  // Read current values from the DOM on mount (set by the boot script).
  // Intentional post-hydration sync — the boot script applies theme/font
  // pre-paint to avoid a flash; state catches up after mount (no hydration
  // mismatch because the DOM, not the render output, is the source here).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const root = document.documentElement;
    const th = root.getAttribute("data-theme") as ThemeId | null;
    if (th) setTheme(th);
    const fs = root.getAttribute("data-font") as FontSizeId | null;
    if (fs) setFont(fs);
    try {
      const dm = localStorage.getItem(DARK_STORAGE_KEY) as DarkModeId | null;
      if (dm) setDark(dm);
      else setDark(root.classList.contains("dark") ? "dark" : "system");
    } catch {
      /* ignore */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t(locale, "appearance")} title={t(locale, "appearance")}>
          <Palette className="h-4 w-4" />
          <span className="hidden sm:inline ltr:ml-2 rtl:mr-2">{t(locale, "appearance")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{t(locale, "theme_label")}</DropdownMenuLabel>
        {THEMES.map((th) => (
          <DropdownMenuItem
            key={th.id}
            onClick={() => {
              setTheme(th.id);
              applyTheme(th.id);
            }}
          >
            <span
              className="inline-block h-4 w-4 shrink-0 rounded-full border border-black/10"
              style={{ backgroundColor: th.swatch }}
            />
            <span className="flex-1">{t(locale, th.labelKey)}</span>
            {theme === th.id && <Check className="h-4 w-4 brand-text" />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t(locale, "font_size_label")}</DropdownMenuLabel>
        <div className="flex items-center justify-between gap-1 px-2 pb-2">
          {FONT_SIZES.map((fs) => (
            <button
              key={fs.id}
              type="button"
              onClick={() => {
                setFont(fs.id);
                applyFont(fs.id);
              }}
              className={`
                flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md border py-1.5 text-foreground transition
                ${
                  font === fs.id
                    ? "brand-soft-bg-strong brand-text-strong border-current"
                    : "border-border hover:bg-accent"
                }
              `}
              aria-pressed={font === fs.id}
            >
              <Type className={fs.id === "sm" ? "h-3 w-3" : fs.id === "md" ? "h-3.5 w-3.5" : fs.id === "lg" ? "h-4 w-4" : "h-5 w-5"} />
              <span className="text-[10px] leading-none">{t(locale, fs.labelKey)}</span>
            </button>
          ))}
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t(locale, "mode_light")} / {t(locale, "mode_dark")}</DropdownMenuLabel>
        <div className="grid grid-cols-3 gap-1 px-2 pb-2">
          {(
            [
              { id: "light" as DarkModeId, icon: Sun, labelKey: "mode_light" as TranslationKey },
              { id: "dark" as DarkModeId, icon: Moon, labelKey: "mode_dark" as TranslationKey },
              { id: "system" as DarkModeId, icon: Monitor, labelKey: "mode_system" as TranslationKey },
            ]
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setDark(m.id);
                applyDark(m.id);
              }}
              className={`
                flex flex-col items-center justify-center gap-0.5 rounded-md border py-1.5 text-foreground transition
                ${
                  dark === m.id
                    ? "brand-soft-bg-strong brand-text-strong border-current"
                    : "border-border hover:bg-accent"
                }
              `}
              aria-pressed={dark === m.id}
            >
              <m.icon className="h-4 w-4" />
              <span className="text-[10px] leading-none">{t(locale, m.labelKey)}</span>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
