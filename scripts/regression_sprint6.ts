/**
 * Sprint-6 regression harness (v0.8.2 — CDC FY2026 data pass).
 *
 * Guards the bundled FY2026 extract and the app's curated layers against
 * divergence from the OFFICIAL CDC FY2026 classification:
 *
 *   1. Manifest/chunk integrity — counts, billable flags, no dupes, order.
 *   2. QA* family restoration — FY2026 introduced the first letter-at-
 *      position-2 codes (chapter 17 "Q00-QA0"); the v0.8.1 parser regex
 *      silently dropped all 20 of them (13 billable). These checks keep
 *      the family in the bundle permanently.
 *   3. Classification sentinels — the X20-X29 / X40-X49 / X60-X69 /
 *      Y10-Y19 / Y40-Y59 / U10 / U12 / B21 / I64 / I69.4- ranges are
 *      ABSENT from the official FY2023-FY2027 publications (verified
 *      against order file, codes file, tabular XML, external-cause index
 *      XML and the NLM mirror). If a future data refresh ever introduces
 *      these codes, these sentinels FAIL on purpose to force a review of
 *      the engine's poisoning/stroke realignment.
 *   4. Curated-layer conformance — every BUILTIN_ICD10 row and every
 *      mock rule code must exist in the bundle (exact, placeholder-
 *      stripped prefix, or the documented DEFERRED allowlist).
 *   5. Engine alignment — venomous contact codes T63.- primary (no X/Y),
 *      stairs falls W10.8XXA.
 *
 * Run: bun scripts/regression_sprint6.ts
 */
import { BUILTIN_ICD10 } from "../src/lib/icd/data";
import { chapterOfCode } from "../src/lib/icd/chapters";
import { mockProvider } from "../src/lib/llm/mock";
import type { ClinicalCodingResponse } from "../src/lib/schemas/icd";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Load the bundled extract
// ---------------------------------------------------------------------------
const dir = join(process.cwd(), "public", "icd10cm");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
interface Chunk {
  from: string;
  to: string;
  codes: [string, string, number][];
}
const chunkFiles = readdirSync(dir)
  .filter((f) => /^chunk-\d+\.json$/.test(f))
  .sort();
const chunks: Chunk[] = chunkFiles.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

const db = new Map<string, { desc: string; flag: number }>();
const ordered: string[] = [];
for (const ch of chunks) {
  for (const [code, desc, flag] of ch.codes) {
    db.set(code, { desc, flag });
    ordered.push(code);
  }
}
const families = new Set(ordered.map((c) => c.slice(0, 3)));

function allCodes(r: ClinicalCodingResponse): string[] {
  return [
    r.primary_icd10.code,
    ...r.secondary_icd10.map((c) => c.code),
    ...r.tertiary_icd10.map((c) => c.code),
  ];
}

async function runCase(
  name: string,
  note: string,
  fn: (r: ClinicalCodingResponse) => void
) {
  console.log(`\n▶ ${name}`);
  const { parsed } = await mockProvider.generateCoding(note, []);
  console.log(
    `   primary=${parsed.primary_icd10.code} secondary=[${parsed.secondary_icd10
      .map((c) => c.code)
      .join(", ")}] tertiary=[${parsed.tertiary_icd10.map((c) => c.code).join(", ")}]`
  );
  fn(parsed);
}

// ===========================================================================
console.log("\n================ 1. manifest & chunk integrity ================");
// ===========================================================================
check("manifest fiscalYear 2026", manifest.fiscalYear === 2026, String(manifest.fiscalYear));
check("manifest total = 98,186 (official FY2026 order-file lines)", manifest.total === 98186, String(manifest.total));
check("manifest billable = 74,719 (official count)", manifest.billable === 74719, String(manifest.billable));
check("17 chunks", chunks.length === 17, String(chunks.length));
check("chunk entry sum == manifest total", ordered.length === manifest.total, `${ordered.length} vs ${manifest.total}`);
check("chunks declared in manifest == chunk files", manifest.chunks.length === chunks.length);
const sizesOk = chunks.every((c) => c.codes.length > 0 && c.codes.length <= 6000);
check("all chunk sizes within 1..6000", sizesOk);
check("no duplicate codes across chunks", db.size === ordered.length, `${db.size} unique vs ${ordered.length}`);
check("first code is A00", ordered[0] === "A00", ordered[0]);
check("last code is U09.9 (FY2026 tabular tail)", ordered[ordered.length - 1] === "U09.9", ordered[ordered.length - 1]);
const shapeRe = /^[A-Z][A-Z0-9][\dA-Z]*(\.[\dA-Z]+)?$/;
const badShape = ordered.filter((c) => !shapeRe.test(c));
check("every code matches the widened CM shape", badShape.length === 0, badShape.slice(0, 5).join(","));

// ===========================================================================
console.log("\n================ 2. QA* family restoration (chapter 17 Q00-QA0) ================");
// ===========================================================================
const qaExpect: [string, string, number][] = [
  ["QA0", "Neurodev disord related to specific genetic patho variants", 0],
  ["QA0.0", "Neurodev disord related to patho variants in specific genes", 0],
  ["QA0.0101", "SCN2A-related neurodevelopmental disorder", 1],
  ["QA0.0102", "CACNA1A-related neurodevelopmental disorder", 1],
  ["QA0.0131", "SLC6A1-related disorder", 1],
  ["QA0.0142", "DLG4-related synaptopathy", 1],
  ["QA0.0151", "FOXG1 syndrome", 1],
  ["QA0.8", "Other neurodev dis rel to patho var in other specific genes", 1],
];
for (const [code, desc, flag] of qaExpect) {
  const rec = db.get(code);
  check(
    `QA* row ${code} present (${flag ? "billable" : "header"})`,
    !!rec && rec.desc === desc && rec.flag === flag,
    rec ? `${rec.desc} / flag=${rec.flag}` : "MISSING"
  );
}
const qaAll = ordered.filter((c) => c.startsWith("QA"));
check("20 QA* rows in bundle (official FY2026 count)", qaAll.length === 20, String(qaAll.length));
check("13 QA* rows billable", qaAll.filter((c) => db.get(c)!.flag === 1).length === 13);
check("QA* slotted between Q99.9 and R00 (tabular order)", ordered[ordered.indexOf("QA0") - 1] === "Q99.9" && ordered[ordered.indexOf("QA0.8") + 1] === "R00");
check("chapterOfCode(QA0.0101) -> chapter 17", chapterOfCode("QA0.0101")?.id === 17, JSON.stringify(chapterOfCode("QA0.0101")));
check("chapterOfCode(QA0) -> chapter 17", chapterOfCode("QA0")?.id === 17);
check("chapterOfCode(Q99.9) -> chapter 17", chapterOfCode("Q99.9")?.id === 17);
check("chapterOfCode(R00) -> chapter 18 (QA range does not leak)", chapterOfCode("R00")?.id === 18);

// ===========================================================================
console.log("\n================ 3. official-classification sentinels ================");
// ===========================================================================
// Ranges ABSENT from the official FY2026 publication (order file, codes
// file, tabular XML, eindex XML, FY2023-FY2027; mirrored by NLM). If any
// of these ever appears in a refreshed bundle, STOP and review the
// engine's poisoning/stroke realignment before shipping.
const absentPrefixes = ["X20", "X21", "X23", "X40", "X44", "X59", "X60", "X64", "X69", "Y10", "Y13", "Y40", "Y59", "I69.4"];
for (const p of absentPrefixes) {
  const hits = ordered.filter((c) => c === p || c.startsWith(p + ".") || c.startsWith(p));
  check(`sentinel: no ${p}* codes in the official FY2026 extract`, hits.length === 0, hits.slice(0, 5).join(","));
}
for (const absent of ["B21", "I64", "I64.9", "U10.9", "U12.9"]) {
  check(`sentinel: ${absent} absent (retired / never in CM)`, !db.has(absent));
}
const present: [string, string][] = [
  ["T63.001A", "Toxic effect of unsp snake venom, accidental, init"],
  ["T63.301A", "Toxic effect of venom of spiders, accidental, init"],
  ["T63.411A", "Toxic effect of venom of hornets, wasps and bees, accidental, init"],
  ["W10.8XXA", "Fall (on) (from) other stairs and steps, initial encounter"],
  ["I63.9", "Cerebral infarction, unspecified"],
  ["I69.311", "Memory deficit following cerebral infarction"],
  ["I69.393", "Ataxia following cerebral infarction"],
];
for (const [code, expect] of present) {
  const rec = db.get(code);
  check(`anchor: ${code} present in bundle`, !!rec, "MISSING");
  if (rec && expect) check(`anchor: ${code} is billable`, rec.flag === 1);
}

// ===========================================================================
console.log("\n================ 4. curated-layer conformance vs bundle ================");
// ===========================================================================
/** Strip placeholder forms (W01.XXXA -> W01. ; S60.01XA -> S60.01) so the
 *  curated template rows are checked at their real family/stem level. */
function stemOf(code: string): string {
  const noEnc = code.replace(/\{ENC\}/g, "");
  return noEnc.replace(/(X+)?[ADS]?$/, (m) => (m.includes("X") ? "" : m)) || noEnc;
}
const DEFERRED_ALLOWLIST = new Set([
  // v0.8.2 deferral: curated rows whose EXACT subcode needs re-curation
  // against the FY2026 index (family exists; specificity fix tracked for a
  // later sprint). Kept explicit so future drift still fails the suite.
  "I82.909", "M79.679", "M81.80", "Y92.46",
  "S00.161A", "S60.01XA", "S60.02XA", "S60.09XA", "S80.04XA",
  "V09.2XXA", "V29.9XXA", "W17.XXXA", "W18.22XA", "W31.XXXA",
]);
const curatedViolations: string[] = [];
for (const entry of BUILTIN_ICD10) {
  if (DEFERRED_ALLOWLIST.has(entry.code)) continue;
  if (db.has(entry.code)) continue;
  const stem = stemOf(entry.code);
  const prefixHit = ordered.some((c) => c.startsWith(stem));
  if (!prefixHit) curatedViolations.push(entry.code);
}
check(
  "every curated data.ts row exists in the bundle (exact / stem / allowlist)",
  curatedViolations.length === 0,
  curatedViolations.join(", ")
);
check("deferred allowlist stays small (< 25 rows)", DEFERRED_ALLOWLIST.size < 25, String(DEFERRED_ALLOWLIST.size));

// CodeFirstRule code lists must reference real bundle codes / families.
// References may be full codes (E11.621), 3-char families (I12.9), or
// chapter-level ranges ("C", "D4") used for grouped matchers.
const ruleViolations: string[] = [];
const famList = [...families];
for (const rule of (await import("../src/lib/icd/data")).CODE_FIRST_RULES) {
  const lists = [
    ...(rule.trigger_codes ?? []),
    ...(rule.companion_codes ?? []),
    ...(rule.code_first_codes ?? []),
  ];
  for (const c of lists) {
    const ok =
      db.has(c) ||
      families.has(c) ||
      famList.some((f) => f.startsWith(c));
    if (!ok) ruleViolations.push(`${rule.rule_id}:${c}`);
  }
}
check("CODE_FIRST_RULES reference real bundle families", ruleViolations.length === 0, ruleViolations.join(", "));

// ===========================================================================
console.log("\n================ 5. engine alignment cases ================");
// ===========================================================================
await runCase("D1 — venomous snake bite codes T63 toxic effect, no X/Y external cause",
  "Bitten by a venomous snake while hiking this morning, swelling of the right hand.",
  (r) => {
    check("primary T63.001A", r.primary_icd10.code === "T63.001A", r.primary_icd10.code);
    check("no X20/X23 external cause", !allCodes(r).some((c) => c.startsWith("X20") || c.startsWith("X23")), allCodes(r).join(","));
  });

await runCase("D2 — wasp sting codes T63 toxic effect, no X/Y external cause",
  "Wasp sting on the left forearm two hours ago with local swelling.",
  (r) => {
    check("primary T63.411A", r.primary_icd10.code === "T63.411A", r.primary_icd10.code);
    check("no X23 external cause", !allCodes(r).some((c) => c.startsWith("X23")), allCodes(r).join(","));
  });

await runCase("D3 — poisoning still intent-coded on the T-code, no X44 tertiary",
  "Accidental overdose of unknown pills.",
  (r) => {
    check("primary T50.901A (accidental per note)", r.primary_icd10.code === "T50.901A", r.primary_icd10.code);
    check("no X40-X49 external cause", !allCodes(r).some((c) => /^X4/.test(c)), allCodes(r).join(","));
  });

await runCase("D4 — stairs fall uses W10.8XXA",
  "Elderly man fell down the stairs at home, right hip pain.",
  (r) => {
    check("W10.8XXA tertiary", r.tertiary_icd10.some((c) => c.code === "W10.8XXA"), r.tertiary_icd10.map((c) => c.code).join(","));
    check("no W10.XXXA generic (absent from FY2026)", !allCodes(r).some((c) => c === "W10.XXXA"), allCodes(r).join(","));
  });

await runCase("D5 — fentanyl codes the FY2024+ T40.41- family, not T40.2",
  "Accidental fentanyl overdose.",
  (r) => {
    check("primary T40.411A (fentanyl, accidental)", r.primary_icd10.code === "T40.411A", r.primary_icd10.code);
    check("no T40.2 other-opioids code for fentanyl", !allCodes(r).some((c) => c.startsWith("T40.2")), allCodes(r).join(","));
  });

// ===========================================================================
console.log("\n==================================================");
console.log(`Sprint 6 (CDC FY2026 data pass): ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("ALL GREEN");
