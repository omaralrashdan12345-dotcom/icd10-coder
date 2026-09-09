import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { SessionProviderWrapper } from "@/components/providers/session-provider";

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
    "Convert clinical text into ICD-10-CM codes ranked dynamically (Primary / Secondary / Tertiary) with RAG validation and 7th-character checks. حوّل النص الإكلينيكي إلى رموز ICD-10-CM مرتبة ديناميكياً.",
  keywords: [
    "ICD-10-CM",
    "medical coding",
    "AI agent",
    "RAG",
    "clinical NER",
    "ترميز طبي",
    "ذكاء اصطناعي",
  ],
  authors: [{ name: "Z.ai" }],
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <SessionProviderWrapper>
          {children}
          <Toaster />
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
