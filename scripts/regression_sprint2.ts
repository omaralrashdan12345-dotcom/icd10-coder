/**
 * Sprint-2 regression harness: full-database bundler + existence check +
 * expanded code-first rules + chapter labels.
 * Run: bun scripts/regression_sprint2.ts
 *
 * Note: browser-only paths (IndexedDB seeding, search index) are verified
 * separately with agent-browser; this harness covers server/TS logic.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockProvider } from "../src/lib/llm/mock";
import { validateResponse } from "../src/lib/icd/validation";
import { chapterOfCode } from "../src/lib/icd/chapters";
import type { ClinicalCodingResponse } from "../src/lib/schemas/icd";

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

function allCodes(r: ClinicalCodingResponse): string[] {
  return [r.primary_icd10.code, ...r.secondary_icd10.map((c) => c.code), ...r.tertiary_icd10.map((c) => c.code)];
}
function has(code: string[], prefix: string): boolean {
  return code.some((c) => c.toUpperCase().startsWith(prefix.toUpperCase()));
}
async function runCase(name: string, note: string, fn: (r: ClinicalCodingResponse, issues: ReturnType<typeof validateResponse>) => void) {
  console.log(`\n▶ ${name}`);
  const { parsed } = await mockProvider.generateCoding(note, []);
  const issues = validateResponse(parsed, note);
  console.log(`   primary=${parsed.primary_icd10.code} secondary=[${parsed.secondary_icd10.map((c) => c.code).join(", ")}]`);
  fn(parsed, issues);
}

async function main() {
  // ============ 1. Bundled dataset integrity ============
  console.log("================ bundled dataset integrity ================");
  const pubDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icd10cm");
  const manifest = JSON.parse(await readFile(path.join(pubDir, "manifest.json"), "utf8"));
  check("manifest total >= 98000", manifest.total >= 98000, String(manifest.total));
  check("manifest billable ~74700", manifest.billable >= 74600 && manifest.billable <= 74800, String(manifest.billable));
  check("fiscal year 2026", manifest.fiscalYear === 2026, String(manifest.fiscalYear));

  let sum = 0;
  let billableSum = 0;
  let allDotted = true;
  let allFlags = true;
  let sawBillable = false;
  let sawCategory = false;
  let descOk = true;
  for (const c of manifest.chunks) {
    const chunk = JSON.parse(await readFile(path.join(pubDir, c.file), "utf8"));
    sum += chunk.codes.length;
    for (const [code, desc, flag] of chunk.codes) {
      // Real ICD-10-CM allows letters at positions 2-4 (e.g. C4A.*, M1A.*)
      if (!/^[A-Z][0-9A-Z]{2}(\.[0-9A-Z]{1,4})?$/.test(code)) { allDotted = false; console.log("     bad code:", code); }
      if (flag !== 0 && flag !== 1) allFlags = false;
      if (flag === 1) sawBillable = true; else sawCategory = true;
      if (typeof desc !== "string" || desc.length < 3) descOk = false;
      if (flag === 1) billableSum++;
    }
  }
  check("chunk counts sum == manifest.total", sum === manifest.total, `${sum} vs ${manifest.total}`);
  check("billable sum matches manifest.billable", billableSum === manifest.billable, `${billableSum} vs ${manifest.billable}`);
  check("codes are dotted (A00.0 format)", allDotted);
  check("flags valid 0/1", allFlags);
  check("dataset has both billable + category codes", sawBillable && sawCategory);
  check("descriptions non-trivial", descOk);

  // Spot-check well-known codes
  const probe = new Map<string, [string, number]>();
  for (const c of manifest.chunks) {
    const chunk = JSON.parse(await readFile(path.join(pubDir, c.file), "utf8"));
    for (const [code, desc, flag] of chunk.codes) probe.set(code, [desc, flag]);
  }
  check("E11.9 exists (billable)", probe.get("E11.9")?.[1] === 1, JSON.stringify(probe.get("E11.9")));
  check("E11 exists as category", probe.get("E11")?.[1] === 0, JSON.stringify(probe.get("E11")));
  check("S82.201A exists (billable)", probe.get("S82.201A")?.[1] === 1, JSON.stringify(probe.get("S82.201A")));
  check("U09.9 post-COVID exists", probe.has("U09.9"));
  check("Z79.4 long-term insulin exists", probe.get("Z79.4")?.[1] === 1);
  check("M1A.00X0 flattened-category exists", probe.has("M1A.00X0"));
  check("E11.621 diabetic foot ulcer exists", probe.get("E11.621")?.[1] === 1);
  check("count > 95000 for completeness", probe.size >= 95000, String(probe.size));

  // ============ 2. Chapter labels ============
  console.log("\n================ chapter table ================");
  check("S82.201A → Injury chapter 19", chapterOfCode("S82.201A")?.id === 19);
  check("E11.9 → Endocrine chapter 4", chapterOfCode("E11.9")?.id === 4);
  check("I10 → Circulatory chapter 9", chapterOfCode("I10")?.id === 9);
  check("W55.03XA → External causes chapter 20", chapterOfCode("W55.03XA")?.id === 20);
  check("Z79.4 → Factors chapter 21", chapterOfCode("Z79.4")?.id === 21);
  check("F32.9 → Mental chapter 5", chapterOfCode("F32.9")?.id === 5);
  check("O24.92 → Pregnancy chapter 15", chapterOfCode("O24.92")?.id === 15);
  check("M1A.00X0 → Musculoskeletal chapter 13", chapterOfCode("M1A.00X0")?.id === 13);

  // ============ 3. Expanded code-first rules (idea H) ============
  console.log("\n================ expanded code-first rules ================");

  await runCase("Diabetic CKD — E11.22 + N18.3", "Patient with type 2 diabetes and diabetic chronic kidney disease stage 3 presents for follow-up. On metformin.", (r, issues) => {
    const cs = allCodes(r);
    check("E11.22 present", has(cs, "E11.22"), cs.join(","));
    check("N18.3 present", has(cs, "N18.3"), cs.join(","));
    const rule = issues.find((i) => i.rule === "DIABETIC_CKD_CODE_FIRST");
    check("DIABETIC_CKD_CODE_FIRST fires", !!rule, JSON.stringify(issues.map((i) => i.rule)));
  });

  await runCase("HTN with heart failure", "Elderly man with hypertensive heart disease with congestive heart failure, mild exacerbation. No chest pain.", (r, issues) => {
    const cs = allCodes(r);
    check("I11.0 present", has(cs, "I11.0"), cs.join(","));
    check("I50.- present", has(cs, "I50"), cs.join(","));
    const rule = issues.find((i) => i.rule === "HTN_WITH_HEART_FAILURE");
    check("HTN_WITH_HEART_FAILURE fires", !!rule, JSON.stringify(issues.map((i) => i.rule)));
  });

  await runCase("Sepsis due to UTI", "88-year-old woman admitted with urosepsis. Blood cultures positive. Urinalysis consistent with urinary tract infection. Afebrile now.", (r, issues) => {
    const cs = allCodes(r);
    check("A41.- present", has(cs, "A41"), cs.join(","));
    check("N39.0 present", has(cs, "N39.0"), cs.join(","));
    const rule = issues.find((i) => i.rule === "SEPSIS_UNDERLYING_INFECTION");
    check("SEPSIS_UNDERLYING_INFECTION fires", !!rule, JSON.stringify(issues.map((i) => i.rule)));
  });

  await runCase("Anemia in CKD", "Patient with stage 4 chronic kidney disease and anemia due to CKD. On erythropoietin. Also hypertension on amlodipine.", (r, issues) => {
    const cs = allCodes(r);
    check("D63.1 present", has(cs, "D63.1"), cs.join(","));
    check("N18.4 present", has(cs, "N18.4"), cs.join(","));
    const rule = issues.find((i) => i.rule === "ANEMIA_IN_CKD");
    check("ANEMIA_IN_CKD fires", !!rule, JSON.stringify(issues.map((i) => i.rule)));
  });

  await runCase("Rule count sanity", "Healthy adult annual physical exam. No complaints.", (_r, issues) => {
    check("no code-first rules falsely trigger", !issues.some((i) => /CODE_FIRST|SEPSIS|ANEMIA_IN|HTN_WITH/.test(i.rule)), JSON.stringify(issues.map((i) => i.rule)));
  });

  // ============ 4. Sprint-1 behaviors unchanged ============
  console.log("\n================ sprint-1 spot checks ================");
  await runCase("Open fracture still B", "Skydiver fell from a ladder and sustained an open fracture of the right tibia shaft. Wound measures 8 cm with muscle involvement, Gustilo type II.", (r) => {
    check("S82.201B primary", r.primary_icd10.code === "S82.201B", r.primary_icd10.code);
  });
  await runCase("Rule-out + history still works", "68-year-old man for medication review. History of stroke with no residual deficits, family history of diabetes. Cough for 3 days, probable pneumonia. Denies fever. On aspirin.", (r, issues) => {
    const cs = allCodes(r);
    check("Z86.73 present", has(cs, "Z86.73"), cs.join(","));
    check("Z83.3 present", has(cs, "Z83.3"), cs.join(","));
    check("no J18 pneumonia", !has(cs, "J18"), cs.join(","));
    check("UNCONFIRMED_OUTPATIENT info", issues.some((i) => i.rule === "UNCONFIRMED_OUTPATIENT"));
  });

  console.log("\n==================================================");
  if (failures.length) {
    console.log("FAILURES:");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  if (fail > 0) process.exit(1);
}

main();
