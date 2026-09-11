"use client";

/**
 * Full offline ICD-10-CM database (Sprint 2 — idea J + existence check I).
 *
 * Two data paths:
 *  1. BUNDLED SEED (default): static JSON chunks in /icd10cm/*.json generated
 *     at build time by scripts/fetch-icd10cm.mjs and committed to the repo.
 *     Seeded into IndexedDB on demand — the app works fully offline forever.
 *  2. LIVE REFRESH (optional button): paginated pull from the NLM Clinical
 *     Tables API (`terms=*` full-dump path) straight into IndexedDB, with
 *     progress reporting. Used when the bundled snapshot should be updated
 *     between app releases (e.g. October 1 fiscal-year code drops).
 *
 * In-memory after load: Map<code, description> for existence checks plus a
 * time-sliced inverted index for fast full-text search across all ~74k codes.
 */

import { chapterOfCode, normCode } from "./chapters";

export interface FullDbStatus {
  state: "idle" | "seeding" | "ready" | "error";
  source: "bundled" | "nlm-live" | null;
  /** manifest generatedAt (bundled) or fetchedAt (live refresh). */
  version: string | null;
  total: number;
  /** Billable-level codes among total (categories excluded). */
  billable: number | null;
  /** Live-refresh progress 0..1 (null when not refreshing). */
  refreshing: boolean;
  refreshProgress: number | null;
  error: string | null;
}

interface Manifest {
  source: string;
  fiscalYear?: number;
  generatedAt: string;
  total: number;
  billable?: number;
  chunkSize: number;
  chunks: { file: string; count: number; from: string; to: string }[];
}

interface StoredMeta {
  version: string;
  source: "bundled" | "nlm-live";
  fetchedAt: string;
  total: number;
  billable?: number;
}

export interface FullDbSearchResult {
  code: string;
  description: string;
  score: number;
  chapter: string | null;
  chapterId: number | null;
}

const DB_NAME = "icd10-full-db";
const DB_VERSION = 1;
const STORE_CHUNKS = "chunks";
const STORE_META = "meta";
const MANIFEST_URL = "/icd10cm/manifest.json";
const CHUNK_URL = (file: string) => `/icd10cm/${file}`;
const NLM_API = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search";
const NLM_PAGE = 500;
const NLM_DELAY_MS = 130;
const INDEX_SLICE = 4000; // docs per time-slice when building the search index

const status: FullDbStatus = {
  state: "idle",
  source: null,
  version: null,
  total: 0,
  billable: null,
  refreshing: false,
  refreshProgress: null,
  error: null,
};

const listeners = new Set<(s: FullDbStatus) => void>();

function emit() {
  const snapshot = { ...status };
  listeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {
      // listener errors must never break the db layer
    }
  });
}

export function subscribeFullDb(cb: (s: FullDbStatus) => void): () => void {
  listeners.add(cb);
  cb({ ...status });
  return () => listeners.delete(cb);
}

export function getFullDbStatus(): FullDbStatus {
  return { ...status };
}

// ---------------------------------------------------------------------------
// IndexedDB primitives (no external deps)
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) db.createObjectStore(STORE_CHUNKS);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbSet(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let codeMap: Map<string, CodeRecord> | null = null;
let codeList: string[] = [];
let searchIndex: Map<string, number[]> | null = null;
let indexBuilding = false;
let indexReadyPromise: Promise<void> | null = null;
let ensurePromise: Promise<void> | null = null;

interface ChunkShape {
  from: string;
  to: string;
  /** [code, description, billableFlag(1|0)] — flag is optional for legacy shapes. */
  codes: [string, string, number?][];
}

/** In-memory record for one code. */
interface CodeRecord {
  desc: string;
  billable: boolean;
}

function loadIntoMemory(chunks: ChunkShape[]): void {
  const map = new Map<string, CodeRecord>();
  for (const chunk of chunks) {
    for (const entry of chunk.codes) {
      const [code, desc, flag] = entry;
      map.set(normCode(code), { desc, billable: flag !== 0 });
    }
  }
  codeMap = map;
  // Search list: billable codes only (category headers are noise in search
  // but remain resolvable via lookupFullCode for existence checks).
  codeList = [];
  for (const [code, rec] of map) {
    if (rec.billable) codeList.push(code);
  }
  codeList.sort();
  searchIndex = null;
  indexReadyPromise = null;
}

// ---------------------------------------------------------------------------
// Light tokenization + inverted index
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "on", "with", "without", "for", "from", "by", "at", "as", "is", "are", "due", "other", "specified", "type", "use", "not", "elsewhere", "classified"]);

/** Very light stem — consistent for both docs and queries. */
function liteStem(tok: string): string {
  if (tok.length > 4 && tok.endsWith("ies")) return tok.slice(0, -3) + "y";
  if (tok.length > 3 && tok.endsWith("es") && !tok.endsWith("ses")) return tok.slice(0, -2);
  if (tok.length > 3 && tok.endsWith("s") && !tok.endsWith("ss")) return tok.slice(0, -1);
  return tok;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9.]+/)) {
    if (!raw || raw.length < 2 || raw === ".") continue;
    if (/\d/.test(raw)) {
      // code-like token: index both with and without the dot
      out.push(raw);
      const noDot = raw.replace(/\./g, "");
      if (noDot !== raw) out.push(noDot);
      continue;
    }
    if (STOPWORDS.has(raw)) continue;
    out.push(liteStem(raw));
  }
  return out;
}

function buildIndexSync(): void {
  if (!codeMap) return;
  const idx = new Map<string, number[]>();
  const docs = codeList;
  for (let i = 0; i < docs.length; i++) {
    const code = docs[i];
    const desc = codeMap.get(code)?.desc ?? "";
    const toks = tokenize(`${code} ${desc}`);
    for (const tok of new Set(toks)) {
      const arr = idx.get(tok);
      if (arr) arr.push(i);
      else idx.set(tok, [i]);
    }
  }
  searchIndex = idx;
}

/**
 * Build the inverted index in time slices so the UI never freezes.
 * Safe to call repeatedly — returns the same promise while building.
 */
export function ensureSearchIndex(): Promise<void> {
  if (searchIndex) return Promise.resolve();
  if (indexReadyPromise) return indexReadyPromise;
  if (!codeMap) return Promise.reject(new Error("full database not loaded"));
  indexBuilding = true;
  indexReadyPromise = new Promise<void>((resolve) => {
    let i = 0;
    const idx = new Map<string, number[]>();
    function slice() {
      const end = Math.min(i + INDEX_SLICE, codeList.length);
      for (; i < end; i++) {
        const code = codeList[i];
        const toks = tokenize(`${code} ${codeMap!.get(code)?.desc ?? ""}`);
        for (const tok of new Set(toks)) {
          const arr = idx.get(tok);
          if (arr) arr.push(i);
          else idx.set(tok, [i]);
        }
      }
      if (i < codeList.length) {
        setTimeout(slice, 0);
      } else {
        searchIndex = idx;
        indexBuilding = false;
        resolve();
      }
    }
    setTimeout(slice, 0);
  });
  return indexReadyPromise;
}

export function isIndexBuilding(): boolean {
  return indexBuilding;
}

// ---------------------------------------------------------------------------
// Seeding from bundled chunks
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function readStoredMeta(db: IDBDatabase): Promise<StoredMeta | undefined> {
  return idbGet<StoredMeta>(db, STORE_META, "meta");
}

async function loadChunksFromIdb(db: IDBDatabase): Promise<ChunkShape[]> {
  const stored = await idbGetAll<ChunkShape>(db, STORE_CHUNKS);
  // getAll loses key order — re-sort by first code
  stored.sort((a, b) => (a.from < b.from ? -1 : 1));
  return stored;
}

async function downloadAndStoreBundled(db: IDBDatabase, manifest: Manifest): Promise<void> {
  await idbClear(db, STORE_CHUNKS);
  const chunks: ChunkShape[] = [];
  for (const c of manifest.chunks) {
    const data = await fetchJson<ChunkShape>(CHUNK_URL(c.file));
    chunks.push(data);
    await idbSet(db, STORE_CHUNKS, c.file, data);
  }
  const meta: StoredMeta = {
    version: manifest.generatedAt,
    source: "bundled",
    fetchedAt: new Date().toISOString(),
    total: manifest.total,
    billable: manifest.billable,
  };
  await idbSet(db, STORE_META, "meta", meta);
  loadIntoMemory(chunks);
  status.source = "bundled";
  status.version = manifest.generatedAt;
  status.total = manifest.total;
  status.billable = manifest.billable ?? null;
}

/**
 * Ensure the full database is loaded (from IndexedDB cache, seeding from the
 * bundled chunks when absent or stale). Idempotent.
 */
export function ensureFullDbSeeded(): Promise<void> {
  if (status.state === "ready") return Promise.resolve();
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") {
      throw new Error("full database requires a browser environment");
    }
    status.state = "seeding";
    status.error = null;
    emit();

    try {
      const db = await openDb();
      const meta = await readStoredMeta(db);

      // Fetch the bundled manifest to compare versions (cheap).
      const manifest = await fetchJson<Manifest>(MANIFEST_URL);

      if (meta && meta.version === manifest.generatedAt && meta.total === manifest.total) {
        // Up-to-date cache — load from IndexedDB only (fast, no network).
        const chunks = await loadChunksFromIdb(db);
        if (chunks.length > 0 && chunks.reduce((n, c) => n + c.codes.length, 0) > 0) {
          loadIntoMemory(chunks);
          status.source = meta.source;
          status.version = meta.version;
          status.total = meta.total;
          status.billable = meta.billable ?? null;
          status.state = "ready";
          emit();
          return;
        }
      }

      await downloadAndStoreBundled(db, manifest);
      status.state = "ready";
      emit();
    } catch (err) {
      status.state = "error";
      status.error = err instanceof Error ? err.message : String(err);
      ensurePromise = null;
      emit();
      throw err;
    }
  })();

  return ensurePromise;
}

// ---------------------------------------------------------------------------
// Live refresh from NLM
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchNlmPage(offset: number): Promise<{ total: number; rows: [string, string][] }> {
  const url = `${NLM_API}?terms=*&sf=code,name&max=${NLM_PAGE}&offset=${offset}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as [number, string[], null, [string, string][]];
      if (!Array.isArray(data) || data.length < 4) throw new Error("bad payload");
      return { total: data[0] ?? 0, rows: data[3] ?? [] };
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(500 * attempt);
    }
  }
  throw new Error("unreachable");
}

/**
 * Pull the complete dataset from NLM directly into IndexedDB (~150 pages,
 * ~40s with throttling). Replaces the bundled seed until the next bundled
 * release catches up. Progress is reported through the status subscription.
 */
export async function refreshFromNlmLive(): Promise<void> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error("requires a browser environment");
  }
  status.refreshing = true;
  status.refreshProgress = 0;
  status.error = null;
  emit();

  try {
    const db = await openDb();
    const all: [string, string][] = [];
    let total = Infinity;
    let offset = 0;

    while (offset < total) {
      const { total: reported, rows } = await fetchNlmPage(offset);
      total = reported;
      if (rows.length === 0) break;
      all.push(...rows);
      offset += rows.length;
      status.refreshProgress = total > 0 ? Math.min(0.99, offset / total) : null;
      emit();
      await sleep(NLM_DELAY_MS);
    }

    // Normalize + dedupe
    const seen = new Set<string>();
    const entries: [string, string][] = [];
    for (const [code, name] of all) {
      if (typeof code !== "string" || typeof name !== "string") continue;
      const c = normCode(code);
      if (!/^[A-Z]\d[\dA-Z.]*$/.test(c) || seen.has(c)) continue;
      seen.add(c);
      entries.push([c, name.trim()]);
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    // Store as our own chunks in IndexedDB (5000 codes each). NLM serves the
    // full code list without billable flags — treat every entry as billable
    // (the NLM dump mirrors the reportable codes file).
    await idbClear(db, STORE_CHUNKS);
    const CHUNK = 5000;
    const chunks: ChunkShape[] = [];
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      chunks.push({ from: slice[0][0], to: slice[slice.length - 1][0], codes: slice.map(([c, d]) => [c, d, 1]) });
    }
    await Promise.all(chunks.map((c, i) => idbSet(db, STORE_CHUNKS, `live-${String(i).padStart(2, "0")}`, c)));

    const meta: StoredMeta = {
      version: `live-${new Date().toISOString()}`,
      source: "nlm-live",
      fetchedAt: new Date().toISOString(),
      total: entries.length,
      billable: entries.length,
    };
    await idbSet(db, STORE_META, "meta", meta);

    loadIntoMemory(chunks);
    status.source = "nlm-live";
    status.version = meta.version;
    status.total = entries.length;
    status.billable = entries.length;
    status.refreshProgress = 1;
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    status.refreshing = false;
    emit();
  }
}

export async function clearFullDb(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await idbClear(db, STORE_CHUNKS);
  await idbClear(db, STORE_META);
  codeMap = null;
  codeList = [];
  searchIndex = null;
  indexReadyPromise = null;
  ensurePromise = null;
  status.state = "idle";
  status.source = null;
  status.version = null;
  status.total = 0;
  status.refreshProgress = null;
  status.error = null;
  emit();
}

// ---------------------------------------------------------------------------
// Public lookups
// ---------------------------------------------------------------------------

export interface CodeLookup {
  code: string;
  description: string;
  /** True when the code is a billable leaf code; false = category header. */
  billable: boolean;
  chapter: string | null;
  chapterId: number | null;
}

/** Exact code existence check against the full dataset (idea I). */
export function lookupFullCode(code: string): CodeLookup | null {
  if (!codeMap) return null;
  const c = normCode(code);
  const rec = codeMap.get(c);
  if (!rec) return null;
  const ch = chapterOfCode(c);
  return { code: c, description: rec.desc, billable: rec.billable, chapter: ch?.label_en ?? null, chapterId: ch?.id ?? null };
}

export function isFullDbReady(): boolean {
  return status.state === "ready" && codeMap !== null;
}

export function fullDbCodeCount(): number {
  return codeMap?.size ?? 0;
}

/**
 * Full-database search across all ~74k codes using the inverted index.
 * Returns ranked results (exact/prefix code matches boosted).
 */
export async function searchFullDb(query: string, limit = 10): Promise<FullDbSearchResult[]> {
  if (!codeMap || !codeList.length) return [];
  await ensureSearchIndex();
  const idx = searchIndex;
  if (!idx) return [];

  const q = query.trim();
  if (!q) return [];

  const normalized = normCode(q);

  // Direct code hit (typed full or partial code)
  const results = new Map<number, number>();
  const directPrefixes: number[] = [];

  if (/^[A-Z]\d/i.test(q)) {
    // exact
    const exactIdx = codeList.indexOf(normalized);
    if (exactIdx >= 0) results.set(exactIdx, (results.get(exactIdx) ?? 0) + 4);
    // category prefix, e.g. "E11" matches E11.9 etc.
    if (normalized.length >= 3) {
      const withDot = normalized.length > 3 ? `${normalized.slice(0, 3)}.${normalized.slice(3)}` : normalized;
      const lo = lowerBound(codeList, withDot);
      for (let i = lo; i < codeList.length; i++) {
        if (!codeList[i].startsWith(withDot)) break;
        directPrefixes.push(i);
        if (directPrefixes.length > 200) break;
      }
    }
  }

  const qTokens = tokenize(q);
  const lastTokRaw = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).pop() ?? "";
  const lastTokStem = liteStem(lastTokRaw);

  for (const tok of qTokens) {
    const isLast = tok === lastTokStem;
    const exact = idx.get(tok);
    const contribution = (arr: number[] | undefined, weight: number) => {
      if (!arr) return;
      // Cap huge postings to keep queries fast; common words still rank via count.
      const step = arr.length > 8000 ? Math.ceil(arr.length / 8000) : 1;
      for (let i = 0; i < arr.length; i += step) {
        results.set(arr[i], (results.get(arr[i]) ?? 0) + weight);
      }
    };
    contribution(exact, 1.0);
    if (isLast && tok.length >= 3) {
      // prefix expansion on the last token (typeahead feel)
      for (const [key, arr] of idx) {
        if (key.startsWith(tok) && key !== tok) contribution(arr, 0.45);
      }
    }
  }

  // Apply code-prefix boosts
  for (const i of directPrefixes) {
    results.set(i, (results.get(i) ?? 0) + 1.5);
  }

  // Rank
  const out: FullDbSearchResult[] = [];
  const entries = Array.from(results.entries());
  entries.sort((a, b) => b[1] - a[1]);

  for (const [docIdx, score] of entries) {
    if (out.length >= limit) break;
    const code = codeList[docIdx];
    const desc = codeMap!.get(code)?.desc ?? "";
    // Small specificity bonus: shorter descriptions are usually broader/cleaner targets
    const specificity = Math.max(0, 0.3 - desc.length / 400);
    const ch = chapterOfCode(code);
    out.push({
      code,
      description: desc,
      score: Number((score + specificity).toFixed(3)),
      chapter: ch ? `${ch.label_en}` : null,
      chapterId: ch?.id ?? null,
    });
  }
  return out;
}

function lowerBound(sorted: string[], target: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
