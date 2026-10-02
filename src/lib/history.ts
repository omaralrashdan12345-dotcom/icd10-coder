import type { CodingApiResponse } from "@/lib/schemas/icd";
import type { CodingResult } from "@/lib/snomed/types";

/**
 * Local analysis history — autosaved on the working machine (browser
 * localStorage, nothing leaves the device). One entry per successful
 * analyze; repeat notes restore instantly without re-hitting the engines.
 */

export interface HistoryEntry {
  id: string;
  ts: number;
  note: string;
  result: CodingApiResponse;
  snomed: CodingResult | null;
}

const HISTORY_KEY = "icd10_history_v1";
const HISTORY_MAX = 50;

/** Canonical note key: case/whitespace-insensitive dedup matching. */
export function normalizeNote(note: string): string {
  return note.toLowerCase().replace(/\s+/g, " ").trim();
}

export function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.note === "string" && e.result && e.result.raw_response);
  } catch {
    return [];
  }
}

export function persistHistory(entries: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    // quota exceeded / private mode - drop silently, never break the app
  }
}

/** Prepend entry, dropping any earlier entry with the same note. */
export function addHistoryEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const key = normalizeNote(entry.note);
  const rest = entries.filter((e) => normalizeNote(e.note) !== key);
  return [entry, ...rest].slice(0, HISTORY_MAX);
}

export function findHistoryByNote(entries: HistoryEntry[], note: string): HistoryEntry | null {
  const key = normalizeNote(note);
  if (!key) return null;
  return entries.find((e) => normalizeNote(e.note) === key) ?? null;
}

export function historyId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
