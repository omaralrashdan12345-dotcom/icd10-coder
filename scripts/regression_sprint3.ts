/**
 * Sprint-3 regression harness: sequela dual-coding (C), full episode-of-care
 * 7th-character grammar (B), medication-status Z-codes (G).
 * Run: bun scripts/regression_sprint3.ts
 */
import { mockProvider } from "../src/lib/llm/mock";
import { validateResponse } from "../src/lib/icd/validation";
import type { ClinicalCodingResponse, ICDCodeDetail } from "../src/lib/schemas/icd";

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

// ---- synthetic-response helpers (validation unit tests) ----
function detail(code: string): ICDCodeDetail {
  return {
    code,
    description: "test",
    rationale: "test",
    confidence: 0.9,
    laterality: "not_applicable",
    acuity: "unspecified",
    seventh_character: "not_required",
  };
}
function resp(primary: string, secondary: string[] = [], tertiary: string[] = []): ClinicalCodingResponse {
  return {
    primary_icd10: detail(primary),
    secondary_icd10: secondary.map(detail),
    tertiary_icd10: tertiary.map(detail),
    entities_extracted: [],
  };
}

async function main() {
  // ============ 1. Idea C — sequela dual-coding ============
  console.log("================ idea C — sequela dual-coding ================");

  await runCase("C1 — residual pain sequenced first, injury S second", "Patient presents for evaluation of chronic right wrist pain, sequela of an old distal radius fracture.", (r, issues) => {
    check("primary M25.531 (pain in right wrist) FIRST", r.primary_icd10.code === "M25.531", r.primary_icd10.code);
    check("S52.501S in secondary", r.secondary_icd10.some((c) => c.code === "S52.501S"), r.secondary_icd10.map((c) => c.code).join(","));
    check("SEQUELA_DUAL_CODE_OK info", issues.some((i) => i.rule === "SEQUELA_DUAL_CODE_OK"), JSON.stringify(issues.map((i) => i.rule)));
    check("no error-level validation", !issues.some((i) => i.level === "error"), JSON.stringify(issues.filter((i) => i.level === "error").map((i) => i.rule)));
  });

  await runCase("C2 — sequela without documented residual stays S-only", "Patient evaluated for sequela of displaced left lateral malleolus fracture.", (r, issues) => {
    check("primary S82.62XS", r.primary_icd10.code === "S82.62XS", r.primary_icd10.code);
    check("seventh_character field = S", r.primary_icd10.seventh_character === "S", String(r.primary_icd10.seventh_character));
    check("no SEQUELA_RESIDUAL_MISSING (no residual documented)", !issues.some((i) => i.rule === "SEQUELA_RESIDUAL_MISSING"), JSON.stringify(issues.map((i) => i.rule)));
  });

  await runCase("C3 — second residual also reported", "Follow-up evaluation of chronic left knee pain and stiffness, sequela of an old tibia fracture.", (r) => {
    const cs = allCodes(r);
    check("residual pain M25.562 present", cs.includes("M25.562"), cs.join(","));
    check("residual stiffness M25.662 present", cs.includes("M25.662"), cs.join(","));
    check("injury S82.20xS present", has(cs, "S82.20") && cs.some((c) => /S82\.20\dS$/.test(c)), cs.join(","));
  });

  {
    console.log("\n▶ U-C1 — SEQUELA_RESIDUAL_MISSING warning (LLM path)");
    const issues = validateResponse(resp("S52.501S"), "Sequela of wrist fracture with chronic pain and stiffness.");
    check("warning fires", issues.some((i) => i.rule === "SEQUELA_RESIDUAL_MISSING" && i.level === "warning"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ U-C2 — SEQUELA_ORDER warning (S-code listed before residual)");
    const issues = validateResponse(resp("S52.501S", ["M25.531"]), "Chronic right wrist pain, sequela of old wrist fracture.");
    check("warning fires", issues.some((i) => i.rule === "SEQUELA_ORDER" && i.level === "warning"), JSON.stringify(issues.map((i) => i.rule)));
  }

  // ============ 2. Idea B — full episode-of-care 7th-char grammar ============
  console.log("\n================ idea B — episode-of-care grammar ================");

  await runCase("B1 — subsequent encounter -> D", "Routine cast check follow-up for right tibia fracture, healing well.", (r, issues) => {
    check("primary S82.201D", r.primary_icd10.code === "S82.201D", r.primary_icd10.code);
    check("description says subsequent", /subsequent/i.test(r.primary_icd10.description), r.primary_icd10.description);
    check("no errors", !issues.some((i) => i.level === "error"));
  });

  await runCase("B2 — external cause shares the episode character (D)", "Follow-up after fall from ladder 4 weeks ago, right tibia fracture in cast, routine healing.", (r, issues) => {
    const cs = allCodes(r);
    check("S82.201D present", cs.includes("S82.201D"), cs.join(","));
    check("W11.XXXD tertiary", r.tertiary_icd10.some((c) => c.code === "W11.XXXD"), r.tertiary_icd10.map((c) => c.code).join(","));
    check("no SEVENTH_CHAR_MISMATCH", !issues.some((i) => i.rule === "SEVENTH_CHAR_MISMATCH"), JSON.stringify(issues.map((i) => i.rule)));
    check("no SEVENTH_CHAR_EPISODE", !issues.some((i) => i.rule === "SEVENTH_CHAR_EPISODE"), JSON.stringify(issues.map((i) => i.rule)));
  });

  await runCase("B3 — nonunion -> K", "Patient presents 3 months after closed left distal radius fracture with nonunion on X-ray.", (r) => {
    check("primary S52.502K", r.primary_icd10.code === "S52.502K", r.primary_icd10.code);
  });

  await runCase("B4 — delayed healing -> G (overrides D)", "Follow-up of right hip fracture with delayed healing.", (r) => {
    check("primary S72.001G", r.primary_icd10.code === "S72.001G", r.primary_icd10.code);
  });

  await runCase("B5 — malunion -> P", "Post-traumatic malunion of prior right femoral neck fracture.", (r) => {
    check("primary S72.001P", r.primary_icd10.code === "S72.001P", r.primary_icd10.code);
  });

  await runCase("B6 — anaphylaxis subsequent -> XD", "Patient returns for follow-up after anaphylactic reaction last week, now resolved.", (r) => {
    check("primary T78.40XD", r.primary_icd10.code === "T78.40XD", r.primary_icd10.code);
  });

  await runCase("B7 — FY2026 M79.6 limb-pain realignment", "62-year-old with chronic left leg pain.", (r) => {
    check("primary M79.605 (pain in LEFT LEG, not arm)", r.primary_icd10.code === "M79.605", r.primary_icd10.code);
  });

  {
    console.log("\n▶ U-B1 — SEVENTH_CHAR_EPISODE warning (LLM path)");
    const issues = validateResponse(resp("S82.201A"), "Cast check follow-up for tibia fracture, routine healing.");
    check("warning fires", issues.some((i) => i.rule === "SEVENTH_CHAR_EPISODE" && i.level === "warning"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ U-B2 — SEVENTH_CHAR_MISMATCH warning (LLM path)");
    const issues = validateResponse(resp("S52.501A", [], ["W19.XXXD"]), "Patient fell 3 weeks ago, wrist in cast.");
    check("warning fires", issues.some((i) => i.rule === "SEVENTH_CHAR_MISMATCH" && i.level === "warning"), JSON.stringify(issues.map((i) => i.rule)));
  }

  // ============ 3. Idea G — medication status Z-codes ============
  console.log("\n================ idea G — medication status Z-codes ================");

  await runCase("G1 — anticoagulant + INR monitoring (Z51.81 leads)", "72-year-old on warfarin for chronic atrial fibrillation, here for INR check.", (r, issues) => {
    const cs = allCodes(r);
    check("Z51.81 present", has(cs, "Z51.81"), cs.join(","));
    check("Z79.01 present", has(cs, "Z79.01"), cs.join(","));
    check("Z51.81 is primary (monitoring is the reason for encounter)", r.primary_icd10.code === "Z51.81", r.primary_icd10.code);
    check("no MED/monitoring warnings", !issues.some((i) => /MED_ZCODE_MISSING|DRUG_MONITORING_MISSING/.test(i.rule)), JSON.stringify(issues.map((i) => i.rule)));
  });

  await runCase("G2 — insulin AND oral hypoglycemic both coded", "Type 2 diabetes on insulin and metformin, here for follow-up.", (r) => {
    const cs = allCodes(r);
    check("Z79.4 present", has(cs, "Z79.4"), cs.join(","));
    check("Z79.84 present", has(cs, "Z79.84"), cs.join(","));
  });

  await runCase("G3 — GLP-1 injectable -> Z79.85", "Type 2 diabetes on ozempic weekly.", (r) => {
    check("Z79.85 present", has(allCodes(r), "Z79.85"), allCodes(r).join(","));
    check("NOT Z79.84 (injectable, not oral)", !has(allCodes(r), "Z79.84"), allCodes(r).join(","));
  });

  await runCase("G4 — inhaled vs systemic steroid", "Asthma on fluticasone inhaler; polymyalgia treated with prednisone 5 mg daily.", (r) => {
    const cs = allCodes(r);
    check("Z79.51 (inhaled) present", has(cs, "Z79.51"), cs.join(","));
    check("Z79.52 (systemic) present", has(cs, "Z79.52"), cs.join(","));
  });

  await runCase("G5 — antiplatelet + anticoagulant", "75-year-old on rivaroxaban and low-dose aspirin for cardiovascular prevention.", (r) => {
    const cs = allCodes(r);
    check("Z79.01 present", has(cs, "Z79.01"), cs.join(","));
    check("Z79.02 present", has(cs, "Z79.02"), cs.join(","));
  });

  await runCase("G6 — long-term NSAID", "Chronic right knee pain, takes ibuprofen daily.", (r) => {
    const cs = allCodes(r);
    check("Z79.1 present", has(cs, "Z79.1"), cs.join(","));
    check("M25.561 knee pain primary", r.primary_icd10.code === "M25.561", r.primary_icd10.code);
  });

  await runCase("G7 — bisphosphonate", "Osteoporosis on alendronate weekly.", (r) => {
    check("Z79.83 present", has(allCodes(r), "Z79.83"), allCodes(r).join(","));
  });

  await runCase("G8 — immunosuppressive biologic", "Rheumatoid arthritis on humira every two weeks.", (r) => {
    check("Z79.620 present", has(allCodes(r), "Z79.620"), allCodes(r).join(","));
  });

  await runCase("G9 — hormonal contraceptive", "Here for pill refill, on oral contraceptive pills.", (r) => {
    check("Z79.3 present", has(allCodes(r), "Z79.3"), allCodes(r).join(","));
  });

  await runCase("G10 — drug allergy statuses Z88", "Allergic to penicillin and sulfa drugs; allergic to codeine.", (r) => {
    const cs = allCodes(r);
    check("Z88.0 present", has(cs, "Z88.0"), cs.join(","));
    check("Z88.2 present", has(cs, "Z88.2"), cs.join(","));
    check("Z88.4 present", has(cs, "Z88.4"), cs.join(","));
  });

  await runCase("G11 — stopped medication not coded", "Metformin was discontinued last month; diabetes resolved.", (r) => {
    check("NO Z79.84 (discontinued)", !has(allCodes(r), "Z79.84"), allCodes(r).join(","));
  });

  await runCase("G12 — allergy mention is not long-term use", "Allergic to aspirin, takes acetaminophen instead.", (r) => {
    const cs = allCodes(r);
    check("NO Z79.02 (allergy, not use)", !has(cs, "Z79.02"), cs.join(","));
    check("Z88.6 present", has(cs, "Z88.6"), cs.join(","));
  });

  await runCase("G13 — acute overdose is not long-term use", "Admitted after overdose of aspirin.", (r) => {
    check("NO Z79.02 (acute ingestion)", !has(allCodes(r), "Z79.02"), allCodes(r).join(","));
  });

  {
    console.log("\n▶ U-G1 — MED_ZCODE_MISSING warning (LLM path)");
    const issues = validateResponse(resp("I10"), "Patient on warfarin for atrial fibrillation.");
    check("warning fires", issues.some((i) => i.rule === "MED_ZCODE_MISSING" && i.level === "warning"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ U-G2 — ALLERGY_ZCODE_MISSING warning (LLM path)");
    const issues = validateResponse(resp("I10"), "Penicillin allergy documented.");
    check("warning fires", issues.some((i) => i.rule === "ALLERGY_ZCODE_MISSING" && i.level === "warning"), JSON.stringify(issues.map((i) => i.rule)));
  }

  console.log("\n==================================================");
  if (failures.length) {
    console.log("FAILURES:");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
