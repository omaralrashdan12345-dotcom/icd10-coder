/**
 * Sprint-1 regression harness for the Smart Offline Coder.
 * Run: bun scripts/regression_sprint1.ts
 * Covers: 6 v0.3 sample cases (no regressions) + Sprint-1 behaviors
 * (open-fracture B, rule-out stripping, history Z-codes, family-history,
 * specificity warnings, format checks, medication synonym retrieval).
 */
import { mockProvider } from "../src/lib/llm/mock";
import { validateResponse } from "../src/lib/icd/validation";
import { ragSearch } from "../src/lib/icd/rag";
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
  console.log(`   primary=${parsed.primary_icd10.code} secondary=[${parsed.secondary_icd10.map((c) => c.code).join(", ")}] tertiary=[${parsed.tertiary_icd10.map((c) => c.code).join(", ")}]`);
  fn(parsed, issues);
}

async function main() {
  console.log("================ v0.3 regression: 6 sample cases ================");

  await runCase("Case 1 — Cat scratch + DM2", "Patient came to ER with cat scratch on his right lower leg today, controlled type 2 diabetes.", (r, issues) => {
    const cs = allCodes(r);
    check("primary S81.811A", r.primary_icd10.code === "S81.811A", r.primary_icd10.code);
    check("E11.9 in secondary", r.secondary_icd10.some((c) => c.code === "E11.9"));
    check("W55.03XA tertiary", r.tertiary_icd10.some((c) => c.code === "W55.03XA"));
    check("no error-level validation", !issues.some((i) => i.level === "error"), JSON.stringify(issues.filter((i) => i.level === "error").map((i) => i.rule)));
  });

  await runCase("Case 2 — DM2 foot ulcer", "55-year-old male with long-standing type 2 diabetes presents with a non-healing ulcer on the right heel for 6 weeks. No gangrene. Hypertension well-controlled on lisinopril.", (r, issues) => {
    const cs = allCodes(r);
    check("E11.621 code-first primary", r.primary_icd10.code === "E11.621", r.primary_icd10.code);
    check("L97.- secondary", has(r.secondary_icd10.map((c) => c.code), "L97"));
    check("I10 secondary", r.secondary_icd10.some((c) => c.code === "I10"));
    check("no error-level validation", !issues.some((i) => i.level === "error"));
  });

  await runCase("Case 3 — COPD exacerbation (no fever)", "62-year-old female with COPD presenting with increased dyspnea, purulent sputum, and wheeze for 3 days. No fever. Home nebulizer ineffective.", (r) => {
    check("J44.1 primary", r.primary_icd10.code === "J44.1", r.primary_icd10.code);
    check("R50.9 fever NOT coded", !has(allCodes(r), "R50.9"));
  });

  await runCase("Case 4 — Dog bite left hand", "Patient presents with dog bite on left hand sustained this morning. Wound is clean, no tendon involvement. Td vaccine up to date.", (r) => {
    check("S61.412A primary (left)", r.primary_icd10.code === "S61.412A", r.primary_icd10.code);
    check("W54.0XXA tertiary", r.tertiary_icd10.some((c) => c.code === "W54.0XXA"));
  });

  await runCase("Case 5 — HTN + CKD follow-up", "Follow-up visit for chronic kidney disease stage 3 and essential hypertension. Creatinine stable. No edema. Patient also has hyperlipidemia.", (r) => {
    const cs = allCodes(r);
    check("I12.9 present", cs.includes("I12.9"), cs.join(","));
    check("N18.3 present", cs.includes("N18.3"));
    check("E78.5 present", cs.includes("E78.5"));
  });

  await runCase("Case 6 — Fall + fractures", "78-year-old woman tripped on the stairs at home and fell onto her left side this morning. Left wrist pain and deformity, X-ray shows distal radius fracture. Also known bilateral knee osteoarthritis and chronic anemia. No head strike, no loss of consciousness.", (r) => {
    const cs = allCodes(r);
    check("S52.502A primary (left wrist)", r.primary_icd10.code === "S52.502A", r.primary_icd10.code);
    check("M17.0 bilateral OA secondary", r.secondary_icd10.some((c) => c.code === "M17.0"), r.secondary_icd10.map((c) => c.code).join(","));
    check("D64.9 anemia secondary", r.secondary_icd10.some((c) => c.code === "D64.9"));
    check("W10.8XXA stairs tertiary", r.tertiary_icd10.some((c) => c.code === "W10.8XXA"), r.tertiary_icd10.map((c) => c.code).join(","));
    check("Y92.008 home tertiary", r.tertiary_icd10.some((c) => c.code === "Y92.008"));
  });

  console.log("\n================ Sprint 1 new behaviors ================");

  await runCase("S1-A — Open fracture → 7th char B", "41-year-old construction worker presents after falling from a ladder with an open fracture of the right tibia, Gustilo type II. Wound 4 cm, no vascular deficit. Tetanus given.", (r, issues) => {
    check("S82.201B primary (open, right tibia)", r.primary_icd10.code === "S82.201B", r.primary_icd10.code);
    check("7th char field = B", r.primary_icd10.seventh_character === "B", String(r.primary_icd10.seventh_character));
    check("W11.XXXA ladder tertiary", r.tertiary_icd10.some((c) => c.code === "W11.XXXA"), r.tertiary_icd10.map((c) => c.code).join(","));
    check("NO open-fracture warning (already B)", !issues.some((i) => i.rule === "SEVENTH_CHAR_OPEN_FRACTURE"));
  });

  await runCase("S1-B — Gustilo III → 7th char C", "25-year-old male with open fracture of left tibia after MVA, Gustilo type III with severe soft tissue damage.", (r) => {
    check("S82.202C primary (Gustilo III)", r.primary_icd10.code === "S82.202C", r.primary_icd10.code);
  });

  await runCase("S1-C — Rule-out pneumonia not coded", "23-year-old with cough and fever for 3 days, probable pneumonia. Denies chest pain.", (r, issues) => {
    const cs = allCodes(r);
    check("J18.9 NOT coded", !has(cs, "J18"), cs.join(","));
    check("R50.9 fever still coded", has(cs, "R50.9"));
    check("UNCONFIRMED_OUTPATIENT info present", issues.some((i) => i.rule === "UNCONFIRMED_OUTPATIENT" && i.level === "info"), JSON.stringify(issues.map((i) => i.rule)));
    check("info message quotes the phrase", issues.some((i) => i.rule === "UNCONFIRMED_OUTPATIENT" && i.message_en.includes("probable pneumonia")));
  });

  await runCase("S1-D — History of stroke → Z86.73 (no I63.9)", "68-year-old man for medication review. History of stroke with no residual deficits. Denies dizziness. On aspirin.", (r) => {
    const cs = allCodes(r);
    check("Z86.73 present", cs.includes("Z86.73"), cs.join(","));
    check("I63.9 NOT coded", !has(cs, "I63"));
    check("G45.9 NOT coded", !has(cs, "G45"));
  });

  await runCase("S1-E — Family history → Z80.3 + Z83.3 (no C50, no E11)", "45-year-old woman here for annual checkup. Family history of breast cancer and diabetes. No breast lump. No pain.", (r, issues) => {
    const cs = allCodes(r);
    check("Z80.3 present", cs.includes("Z80.3"), cs.join(","));
    check("Z83.3 present", cs.includes("Z83.3"), cs.join(","));
    check("no C-chapter code", !cs.some((c) => c.startsWith("C")));
    check("no E11 code", !has(cs, "E11"));
  });

  await runCase("S1-F — 'history of diabetes' stays ACTIVE (PMH convention)", "59-year-old with history of diabetes here for foot check. Slight numbness in toes.", (r) => {
    const cs = allCodes(r);
    check("E11.- ACTIVE code present", has(cs, "E11"), cs.join(","));
    check("E11.40 neuropathy refine", cs.includes("E11.40"), cs.join(","));
    check("no Z83.3 (not family)", !cs.includes("Z83.3"));
  });

  await runCase("S1-G — Old MI → I25.2", "72-year-old man for cardiology follow-up. History of MI 3 years ago. Stable. No chest pain.", (r) => {
    const cs = allCodes(r);
    check("I25.2 present", cs.includes("I25.2"), cs.join(","));
    check("I21/I22 NOT coded", !has(cs, "I21") && !has(cs, "I22"));
  });

  await runCase("S1-H — s/p DVT → Z86.718", "60-year-old woman on rivaroxaban, s/p DVT last year. Here for medication refill. No leg swelling.", (r) => {
    const cs = allCodes(r);
    check("Z86.718 present", cs.includes("Z86.718"), cs.join(","));
    check("I82 NOT coded", !has(cs, "I82"));
  });

  await runCase("S1-I — Negated history ignored", "33-year-old with severe headache. No history of stroke. Family history negative for cancer.", (r) => {
    const cs = allCodes(r);
    check("no Z86.73 (negated)", !cs.includes("Z86.73"), cs.join(","));
    check("no Z85.- (negated family cancer)", !has(cs, "Z85"));
  });

  await runCase("S1-J — comma-chained history clauses (browser-found bug)", "68-year-old man for medication review. History of stroke with no residual deficits, family history of diabetes. Cough for 3 days, probable pneumonia. Denies fever. On aspirin.", (r, issues) => {
    const cs = allCodes(r);
    check("Z86.73 present", cs.includes("Z86.73"), cs.join(","));
    check("Z83.3 present (comma clause not negation-poisoned)", cs.includes("Z83.3"), cs.join(","));
    check("J18.9 NOT coded", !has(cs, "J18"));
    check("R50.9 NOT coded (denies fever)", !has(cs, "R50.9"));
    check("UNCONFIRMED_OUTPATIENT info present", issues.some((i) => i.rule === "UNCONFIRMED_OUTPATIENT"));
  });

  console.log("\n================ Sprint 1 validation unit tests ================");
  const mkResp = (codes: string[]): ClinicalCodingResponse => ({
    primary_icd10: {
      code: codes[0], description: "test", rationale: "test", confidence: 0.9,
      laterality: "not_applicable", acuity: "unspecified", seventh_character: "not_required",
    },
    secondary_icd10: [],
    tertiary_icd10: [],
    entities_extracted: [],
  });

  {
    console.log("\n▶ V1 — bilateral clue");
    const issues = validateResponse(mkResp(["M17.9"]), "70-year-old with bilateral knee osteoarthritis pain.");
    check("SPECIFICITY_BILATERAL warning", issues.some((i) => i.rule === "SPECIFICITY_BILATERAL"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ V2 — uncontrolled DM clue");
    const issues = validateResponse(mkResp(["E11.9"]), "Diabetes uncontrolled, glucose 340.");
    check("SPECIFICITY_UNCONTROLLED_DM warning", issues.some((i) => i.rule === "SPECIFICITY_UNCONTROLLED_DM"));
  }
  {
    console.log("\n▶ V3 — open fx clue against A code");
    const issues = validateResponse(mkResp(["S82.201A"]), "Open fracture of right tibia.");
    check("SEVENTH_CHAR_OPEN_FRACTURE warning", issues.some((i) => i.rule === "SEVENTH_CHAR_OPEN_FRACTURE"));
  }
  {
    console.log("\n▶ V4 — laterality clue");
    const issues = validateResponse(mkResp(["M25.569"]), "Left knee pain for 2 weeks.");
    check("SPECIFICITY_LATERALITY warning", issues.some((i) => i.rule === "SPECIFICITY_LATERALITY"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ V5 — poisoning placeholder X");
    const issues = validateResponse(mkResp(["T39.12A"]), "Ingested unknown quantity of aspirin.");
    check("POISONING_PLACEHOLDER_X warning", issues.some((i) => i.rule === "POISONING_PLACEHOLDER_X"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ V6 — correct poisoning code passes");
    const issues = validateResponse(mkResp(["T39.1X1A"]), "Ingested unknown quantity of aspirin.");
    check("NO placeholder warning for T39.1X1A", !issues.some((i) => i.rule === "POISONING_PLACEHOLDER_X"));
  }
  {
    console.log("\n▶ V7 — incomplete external cause");
    const issues = validateResponse(mkResp(["W19.XA"]), "Patient fell.");
    check("EXTERNAL_CAUSE_INCOMPLETE warning", issues.some((i) => i.rule === "EXTERNAL_CAUSE_INCOMPLETE"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ V8 — invalid 7th character");
    const issues = validateResponse(mkResp(["S82.201Z"]), "Tibia injury follow-up.");
    check("INVALID_SEVENTH_CHAR warning", issues.some((i) => i.rule === "INVALID_SEVENTH_CHAR"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ V9 — 3-char code with known children");
    const issues = validateResponse(mkResp(["E11"]), "Diabetes encounter.");
    check("NOT_CODED_TO_FULL_SPECIFICITY warning", issues.some((i) => i.rule === "NOT_CODED_TO_FULL_SPECIFICITY"), JSON.stringify(issues.map((i) => i.rule)));
    const issuesI10 = validateResponse(mkResp(["I10"]), "Hypertension encounter.");
    check("I10 (leaf) NOT flagged", !issuesI10.some((i) => i.rule === "NOT_CODED_TO_FULL_SPECIFICITY"));
  }

  console.log("\n================ Sprint 1 retrieval (medication synonyms) ================");
  {
    console.log("\n▶ R1 — meds-only note retrieves disease families");
    const dm = await ragSearch("62M on metformin, presents for refill", 4);
    check("diabetes results non-empty", dm.results.length > 0, "0 results");
    check("E11 family retrieved via metformin", dm.results.some((r) => r.code.startsWith("E11")), dm.results.slice(0, 6).map((r) => r.code).join(","));
    const htn = await ragSearch("62F on lisinopril and amlodipine, BP recheck", 4);
    check("hypertension results non-empty", htn.results.length > 0, "0 results");
    check("I10 family retrieved via lisinopril/amlodipine", htn.results.some((r) => r.code.startsWith("I10")), htn.results.slice(0, 6).map((r) => r.code).join(","));
  }

  console.log("\n==================================================");
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(" - " + f);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
