#!/usr/bin/env node
/**
 * Build-time ICD-10-CM full-dataset bundler (Sprint 2 — idea J).
 *
 * Primary source: the OFFICIAL CDC/NCHS order file for the current fiscal
 * year (https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/<FY>/icd10cm-Code Descriptions-<FY>.zip).
 * It contains every code (billable + category headers), the billable flag,
 * and short + long descriptions — no API, no rate limits, no flakiness.
 *
 * Fallback source: NLM Clinical Tables `terms=*` pagination (degraded to
 * 7 rows/page during upstream incidents, so CDC is preferred).
 *
 * Output (committed to the repo):
 *   public/icd10cm/manifest.json   { source, generatedAt, total, billable, chunks[] }
 *   public/icd10cm/chunk-NN.json   { from, to, codes: [[code, desc, flag], ...] }
 *     code is dotted (A00.0), desc = short description, flag: 1 billable, 0 category header
 *
 * Usage:
 *   node scripts/fetch-icd10cm.mjs                        # download CDC FY zip + build
 *   CDC_TXT=/path/icd10cm-order-2026.txt node scripts/fetch-icd10cm.mjs   # parse local file
 *   FY=2027 node scripts/fetch-icd10cm.mjs                # bundle a future fiscal year
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "icd10cm");

const FY = process.env.FY || String(new Date().getUTCFullYear() + (new Date().getUTCMonth() >= 9 ? 1 : 0));
// Effective FY: Oct 1 — Dec 31 belongs to FY+1's release year label.
// (FY2026 = released 2025, effective Oct 2025–Sep 2026)
const CDC_DIR = `https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/${FY}`;
// Zip naming changed with FY2027: lowercase-hyphenated (FY2026 and earlier
// used "icd10cm-Code Descriptions-<FY>.zip" with mixed case + spaces).
const CDC_ZIPS = [
  `${CDC_DIR}/icd10cm-code-descriptions-${FY}.zip`,
  `${CDC_DIR}/icd10cm-Code%20Descriptions-${FY}.zip`,
];
const CHUNK_SIZE = 6000;

function dotted(code) {
  return code.length > 3 ? `${code.slice(0, 3)}.${code.slice(3)}` : code;
}

async function downloadZip(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

async function unzip(zipPath, destDir) {
  await mkdir(destDir, { recursive: true });
  // try system unzip first, then python
  try {
    await execFileP("unzip", ["-o", zipPath, "-d", destDir]);
    return;
  } catch {
    // fall through to python
  }
  await execFileP("python3", ["-c", `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`, zipPath, destDir]);
}

/**
 * Parse the fixed-width order file.
 *
 * Code shape: FY2026 introduced the first letter-at-position-2 codes — the
 * QA0* neurodevelopmental-genetic family that extends chapter 17 to
 * "(Q00-QA0)". The shape regex therefore accepts a letter OR digit in the
 * second position; the previous /^[A-Z]\d.../ silently dropped all 20 QA*
 * lines (13 billable) from the bundled extract (v0.8.2 data pass fix).
 */
function parseOrderFile(text) {
  const entries = [];
  let dropped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.length < 20) continue;
    const order = line.slice(0, 5).trim();
    const raw = line.slice(6, 13).trim();
    const flag = line.slice(14, 15).trim() === "1" ? 1 : 0;
    const short = line.slice(16, 77).trim();
    if (!/^[A-Z][A-Z0-9][\dA-Z]*$/.test(raw)) {
      dropped++;
      console.warn(`[fetch-icd10cm] dropped line (unparseable code field): order=${order} raw="${raw}" desc="${short}"`);
      continue;
    }
    entries.push({ order, code: dotted(raw), flag, desc: short });
  }
  if (dropped > 0) {
    console.warn(`[fetch-icd10cm] WARNING: ${dropped} order-file line(s) dropped by the code-shape filter — inspect before shipping`);
  }
  // The file is already in tabular order; keep that order (it equals code order)
  return entries;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let text;
  if (process.env.CDC_TXT) {
    text = await readFile(process.env.CDC_TXT, "utf8");
    console.log(`[fetch-icd10cm] parsed local order file: ${process.env.CDC_TXT}`);
  } else {
    const zipPath = "/tmp/icd10cm-desc.zip";
    const workDir = "/tmp/icd10cm-desc-unzip";
    await rm(workDir, { recursive: true, force: true });
    console.log(`[fetch-icd10cm] downloading CDC FY${FY} zip…`);
    let bytes = 0;
    let lastErr;
    for (const url of CDC_ZIPS) {
      try {
        bytes = await downloadZip(url, zipPath);
        console.log(`[fetch-icd10cm] downloaded ${bytes} bytes from ${url}`);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    await unzip(zipPath, workDir);
    const files = await readdir(workDir);
    const orderFile = files.find((f) => /^icd10cm-order-\d{4}\.txt$/i.test(f));
    if (!orderFile) throw new Error(`order file not found in zip; contents: ${files.join(", ")}`);
    text = await readFile(path.join(workDir, orderFile), "utf8");
    console.log(`[fetch-icd10cm] parsed ${orderFile} from zip`);
  }

  const entries = parseOrderFile(text);
  const billable = entries.filter((e) => e.flag === 1).length;
  console.log(`[fetch-icd10cm] ${entries.length} codes (${billable} billable, ${entries.length - billable} category headers)`);

  if (entries.length < 90000) {
    throw new Error(`suspiciously few entries (${entries.length}) — refusing to write a partial dataset`);
  }

  // Clean old chunk files
  const old = await readdir(OUT_DIR);
  await Promise.all(old.filter((f) => f.startsWith("chunk-")).map((f) => rm(path.join(OUT_DIR, f), { force: true })));

  const chunks = [];
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const slice = entries.slice(i, i + CHUNK_SIZE);
    const idx = String(chunks.length).padStart(2, "0");
    const file = `chunk-${idx}.json`;
    const payload = {
      from: slice[0].code,
      to: slice[slice.length - 1].code,
      codes: slice.map((e) => [e.code, e.desc, e.flag]),
    };
    await writeFile(path.join(OUT_DIR, file), JSON.stringify(payload));
    chunks.push({ file, count: slice.length, from: payload.from, to: payload.to });
    console.log(`[fetch-icd10cm] wrote ${file}: ${slice.length} codes (${payload.from} → ${payload.to})`);
  }

  const manifest = {
    source: `CDC/NCHS ICD-10-CM FY${FY} order file (https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/)`,
    fiscalYear: Number(FY),
    generatedAt: new Date().toISOString(),
    total: entries.length,
    billable,
    chunkSize: CHUNK_SIZE,
    chunks,
  };
  await writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[fetch-icd10cm] DONE — ${entries.length} codes in ${chunks.length} chunks → public/icd10cm/`);
}

main().catch((err) => {
  console.error("[fetch-icd10cm] FAILED:", err.message);
  process.exit(1);
});
