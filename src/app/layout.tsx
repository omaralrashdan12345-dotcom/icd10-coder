import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ICD-10-CM AI Coding Agent | وكيل ترميز ICD-10-CM الذكي",
  description:
    "Convert clinical text into ICD-10-CM codes ranked dynamically (Primary / Secondary / Supplemental) with RAG validation and 7th-character checks. Works offline. حوّل النص الإكلينيكي إلى رموز ICD-10-CM مرتبة ديناميكياً.",
  keywords: [
    "ICD-10-CM",
    "medical coding",
    "AI agent",
    "RAG",
    "clinical NER",
    "ترميز طبي",
    "ذكاء اصطناعي",
  ],
  authors: [{ name: "Omar Al Rashdan" }],
  applicationName: "ICD-10 AI Coder",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ICD-10 Coder",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon.svg" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

/**
 * Runs BEFORE first paint: restores the saved locale / color theme /
 * text-size preferences from localStorage so there is no flash of the
 * wrong language (RTL/LTR), theme, or font size after hydration.
 * English is the default when nothing is saved.
 */
const BOOT_SCRIPT = `(function(){try{
var d=document.documentElement;
var l=localStorage.getItem('icd10_locale_v2');
if(l!=='ar'&&l!=='en'){l='en';}
d.lang=l;d.dir=l==='ar'?'rtl':'ltr';
var th=localStorage.getItem('icd10_theme');
if(th&&/^(emerald|ocean|violet|rose|amber|mono)$/.test(th))d.setAttribute('data-theme',th);
var fs=localStorage.getItem('icd10_font');
if(fs&&/^(sm|md|lg|xl)$/.test(fs))d.setAttribute('data-font',fs);else d.setAttribute('data-font','md');
var dm=localStorage.getItem('icd10_dark');
if(dm==='dark'){d.classList.add('dark');}
else if(dm==='light'){d.classList.remove('dark');}
else{if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)d.classList.add('dark');}
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning data-theme="emerald" data-font="md">
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
