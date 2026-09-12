/**
 * Sprint-5 regression harness: procedure complications (K) and the
 * severe-sepsis ladder (L), plus a DB-presence sweep proving every emitted
 * code is a real row of the bundled FY2026 extract.
 * Run: bun scripts/regression_sprint5.ts
 */
import { mockProvider } from "../src/lib/llm/mock";
import { validateResponse } from "../src/lib/icd/validation";
import { ragSearch } from "../src/lib/icd/rag";
import type { ClinicalCodingResponse, ICDCodeDetail } from "../src/lib/schemas/icd";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const failures: string[] = [];
const emittedCodes = new Set<string>();

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
  return [
    r.primary_icd10.code,
    ...r.secondary_icd10.map((c) => c.code),
    ...r.tertiary_icd10.map((c) => c.code),
  ];
}
function has(codes: string[], code: string): boolean {
  return codes.some((c) => c.toUpperCase() === code.toUpperCase());
}

async function runCase(
  name: string,
  note: string,
  fn: (r: ClinicalCodingResponse, issues: ReturnType<typeof validateResponse>) => void
) {
  console.log(`\n▶ ${name}`);
  const { parsed } = await mockProvider.generateCoding(note, []);
  const issues = validateResponse(parsed, note);
  for (const c of allCodes(parsed)) emittedCodes.add(c.toUpperCase());
  console.log(
    `   primary=${parsed.primary_icd10.code} secondary=[${parsed.secondary_icd10
      .map((c) => c.code)
      .join(", ")}] tertiary=[${parsed.tertiary_icd10.map((c) => c.code).join(", ")}]`
  );
  fn(parsed, issues);
}

// ---- synthetic-response helper (validation unit tests) ----
function detail(code: string, extra: Partial<ICDCodeDetail> = {}): ICDCodeDetail {
  return {
    code,
    description: "test",
    rationale: "test",
    confidence: 0.9,
    laterality: "not_applicable",
    acuity: "unspecified",
    seventh_character: "not_required",
    ...extra,
  };
}
function resp(primary: string, secondary: string[] = []): ClinicalCodingResponse {
  return {
    primary_icd10: detail(primary),
    secondary_icd10: secondary.map((c) => detail(c)),
    tertiary_icd10: [],
    entities_extracted: [],
  };
}
function rulesOf(issues: ReturnType<typeof validateResponse>): string[] {
  return issues.map((i) => i.rule);
}

async function main() {
  // ============ 1. Idea K — procedure complications ============
  console.log("================ idea K — procedure complications (I.C.20.d) ================");

  await runCase(
    "K1 — infected right hip prosthesis",
    "Admitted with an infected right hip prosthesis. Started on IV antibiotics.",
    (r, issues) => {
      check("primary T84.51XA", r.primary_icd10.code === "T84.51XA", r.primary_icd10.code);
      check("Y79.2 orthopedic device ext cause", r.tertiary_icd10.some((c) => c.code === "Y79.2"), r.tertiary_icd10.map((c) => c.code).join(","));
      check("no error-level issues", !issues.some((i) => i.level === "error"));
    }
  );

  await runCase(
    "K2 — catheter-associated UTI (Foley)",
    "Admitted for a catheter-associated UTI. Foley catheter in place for two weeks.",
    (r) => {
      check("primary T83.518A", r.primary_icd10.code === "T83.518A", r.primary_icd10.code);
      check("Y84.6 urinary catheterization ext cause", r.tertiary_icd10.some((c) => c.code === "Y84.6"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K3 — CLABSI",
    "CLABSI: central line-associated bloodstream infection, blood cultures positive.",
    (r) => {
      check("primary T80.211A", r.primary_icd10.code === "T80.211A", r.primary_icd10.code);
      check("Y84.8 ext cause (no sterile-failure cue)", r.tertiary_icd10.some((c) => c.code === "Y84.8"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K4 — superficial surgical site infection",
    "Postoperative surgical site infection, superficial incisional, treated with antibiotics.",
    (r) => {
      check("primary T81.41XA", r.primary_icd10.code === "T81.41XA", r.primary_icd10.code);
      check("Y83.9 surgical procedure ext cause", r.tertiary_icd10.some((c) => c.code === "Y83.9"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K5 — postoperative sepsis (T81.44 + A41.9)",
    "Postoperative sepsis identified on post-op day 3.",
    (r) => {
      check("primary T81.44XA", r.primary_icd10.code === "T81.44XA", r.primary_icd10.code);
      check("A41.9 organism unspecified secondary", r.secondary_icd10.some((c) => c.code === "A41.9"), r.secondary_icd10.map((c) => c.code).join(","));
      check("A41.9 sequenced BEFORE nothing precedes complication", r.secondary_icd10.findIndex((c) => c.code === "A41.9") >= 0);
    }
  );

  await runCase(
    "K6 — complication follow-up visit gets D",
    "Follow-up of the post-op wound infection; on oral antibiotics, wound improving.",
    (r) => {
      check("primary T81.40XD (subsequent)", r.primary_icd10.code === "T81.40XD", r.primary_icd10.code);
    }
  );

  await runCase(
    "K7 — wound dehiscence",
    "Wound dehiscence noted at the surgical incision; staples separated. Taken back to the OR for closure.",
    (r) => {
      check("primary T81.31XA", r.primary_icd10.code === "T81.31XA", r.primary_icd10.code);
      check("Y83.9 ext cause", r.tertiary_icd10.some((c) => c.code === "Y83.9"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K8 — anastomotic leak (GI disruption)",
    "Anastomotic leak from the bowel anastomosis after colon resection.",
    (r) => {
      check("primary T81.320A", r.primary_icd10.code === "T81.320A", r.primary_icd10.code);
    }
  );

  await runCase(
    "K9 — retained surgical sponge",
    "Retained surgical sponge discovered on CT after appendectomy.",
    (r) => {
      check("primary T81.500A", r.primary_icd10.code === "T81.500A", r.primary_icd10.code);
      check("Y83.9 ext cause", r.tertiary_icd10.some((c) => c.code === "Y83.9"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K10 — sterile-precautions failure documented -> Y62.0",
    "Wound infection after hernia repair. Operative note documents failure of sterile precautions.",
    (r) => {
      check("primary T81.40XA", r.primary_icd10.code === "T81.40XA", r.primary_icd10.code);
      check("Y62.0 sterile precautions ext cause", r.tertiary_icd10.some((c) => c.code === "Y62.0"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K11 — hemolytic transfusion reaction",
    "Acute hemolytic transfusion reaction during blood transfusion.",
    (r) => {
      check("primary T80.910A", r.primary_icd10.code === "T80.910A", r.primary_icd10.code);
      check("Y84.8 ext cause", r.tertiary_icd10.some((c) => c.code === "Y84.8"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K12 — chemotherapy extravasation",
    "Chemotherapy extravasation of vesicant agent into the forearm.",
    (r) => {
      check("primary T80.810A (antineoplastic)", r.primary_icd10.code === "T80.810A", r.primary_icd10.code);
      check("Y84.8 ext cause", r.tertiary_icd10.some((c) => c.code === "Y84.8"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K13 — malignant hyperthermia",
    "Malignant hyperthermia during general anesthesia for laparoscopic cholecystectomy.",
    (r) => {
      check("primary T88.3XXA", r.primary_icd10.code === "T88.3XXA", r.primary_icd10.code);
      check("Y83.9 ext cause", r.tertiary_icd10.some((c) => c.code === "Y83.9"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K14 — broken left hip prosthesis",
    "Broken left hip prosthesis documented on x-ray. Orthopedics consulted.",
    (r) => {
      check("primary T84.011A", r.primary_icd10.code === "T84.011A", r.primary_icd10.code);
      check("Y79.2 ext cause", r.tertiary_icd10.some((c) => c.code === "Y79.2"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K15 — dislocated right hip prosthesis",
    "Dislocated right hip prosthesis, closed reduction attempted.",
    (r) => {
      check("primary T84.020A", r.primary_icd10.code === "T84.020A", r.primary_icd10.code);
    }
  );

  await runCase(
    "K16 — pacemaker battery failure",
    "Pacemaker battery failure; device interrogation confirms generator depletion.",
    (r) => {
      check("primary T82.111A", r.primary_icd10.code === "T82.111A", r.primary_icd10.code);
      check("Y71.2 cardiovascular device ext cause", r.tertiary_icd10.some((c) => c.code === "Y71.2"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K17 — infected pacemaker",
    "Infected pacemaker pocket; blood cultures drawn.",
    (r) => {
      check("primary T82.7XXA", r.primary_icd10.code === "T82.7XXA", r.primary_icd10.code);
      check("Y71.2 ext cause", r.tertiary_icd10.some((c) => c.code === "Y71.2"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K18 — pseudoaneurysm after cardiac cath",
    "Pseudoaneurysm at the femoral site after cardiac catheterization.",
    (r) => {
      check("primary T81.718A", r.primary_icd10.code === "T81.718A", r.primary_icd10.code);
      check("Y84.0 cardiac catheterization ext cause", r.tertiary_icd10.some((c) => c.code === "Y84.0"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K19 — unspecified surgical complication fallback",
    "Admitted with a postoperative complication after knee surgery.",
    (r) => {
      check("primary T81.9XXA", r.primary_icd10.code === "T81.9XXA", r.primary_icd10.code);
      check("Y83.9 ext cause", r.tertiary_icd10.some((c) => c.code === "Y83.9"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "K20 — infected peritoneal dialysis catheter",
    "Infected peritoneal dialysis catheter with exit-site drainage.",
    (r) => {
      check("primary T85.71XA", r.primary_icd10.code === "T85.71XA", r.primary_icd10.code);
      check("Y84.1 kidney dialysis ext cause", r.tertiary_icd10.some((c) => c.code === "Y84.1"), r.tertiary_icd10.map((c) => c.code).join(","));
    }
  );

  // ---- live negatives ----
  await runCase(
    "U-K1 — routine post-op visit, no complication",
    "Routine post-operative follow-up after cholecystectomy. Incision healing well, no complaints.",
    (r) => {
      const cs = allCodes(r);
      check("no T80-T88 complication code", !cs.some((c) => /^T8[0-8]\./.test(c)), cs.join(","));
    }
  );

  await runCase(
    "U-K2 — family history never codes the patient",
    "Discussed family history: her mother had a wound infection after surgery years ago. Patient here for annual physical.",
    (r) => {
      const cs = allCodes(r);
      check("no T80-T88 complication code", !cs.some((c) => /^T8[0-8]\./.test(c)), cs.join(","));
      check("no Y62-Y84 ext cause", !cs.some((c) => /^Y(6[2-9]|7[0-9]|8[0-4])/.test(c)), cs.join(","));
    }
  );

  await runCase(
    "U-K3 — negated wound infection never codes",
    "No signs of wound infection. Incision is clean and dry. Presents for medication refill.",
    (r) => {
      const cs = allCodes(r);
      check("no T80-T88 complication code", !cs.some((c) => /^T8[0-8]\./.test(c)), cs.join(","));
    }
  );

  await runCase(
    "U-K4 — future surgery is not a complication",
    "Scheduled for hip replacement next week; pre-operative clearance visit only.",
    (r) => {
      const cs = allCodes(r);
      check("no T80-T88 complication code", !cs.some((c) => /^T8[0-8]\./.test(c)), cs.join(","));
    }
  );

  // ---- synthetic validation checks ----
  {
    console.log("\n▶ U-K5 — PROC_COMPLICATION_EXT_MISSING (LLM path)");
    const issues = validateResponse(resp("T81.40XA"), "Postoperative wound infection.");
    check("warning fires", issues.some((i) => i.rule === "PROC_COMPLICATION_EXT_MISSING" && i.level === "warning"), JSON.stringify(rulesOf(issues)));
  }
  {
    console.log("\n▶ U-K6 — PROC_COMPLICATION_ORDER (complication behind another dx)");
    const issues = validateResponse(resp("M25.531", ["T81.40XA"]), "Wound infection after surgery.");
    check("warning fires", issues.some((i) => i.rule === "PROC_COMPLICATION_ORDER" && i.level === "warning"), JSON.stringify(rulesOf(issues)));
  }
  {
    console.log("\n▶ U-K7 — correctly paired complication raises no warnings");
    const r = resp("T81.40XA");
    r.tertiary_icd10 = [detail("Y83.9")];
    const issues = validateResponse(r, "Postoperative wound infection.");
    check(
      "no EXT_MISSING / ORDER warnings",
      !issues.some((i) => i.rule === "PROC_COMPLICATION_EXT_MISSING" || i.rule === "PROC_COMPLICATION_ORDER"),
      JSON.stringify(rulesOf(issues))
    );
    emittedCodes.add("T81.40XA");
    emittedCodes.add("Y83.9");
  }

  // ============ 2. Idea L — severe-sepsis ladder ============
  console.log("\n================ idea L — severe sepsis ladder (I.C.1.d.7/.8) ================");

  await runCase(
    "L1 — urosepsis + acute kidney injury -> R65.20 + N17.9",
    "Admitted with urosepsis secondary to a urinary tract infection. Acute kidney injury with creatinine 3.1.",
    (r, issues) => {
      const cs = allCodes(r);
      check("R65.20 present (no shock)", has(cs, "R65.20"), cs.join(","));
      check("N17.9 acute kidney failure present", has(cs, "N17.9"), cs.join(","));
      check("R65.20 NOT primary", r.primary_icd10.code !== "R65.20", r.primary_icd10.code);
      check("no error-level issues", !issues.some((i) => i.level === "error"));
    }
  );

  await runCase(
    "L2 — septic shock on vasopressors -> R65.21",
    "Septic shock from a foot ulcer infection, on norepinephrine drip. Acute renal failure.",
    (r) => {
      const cs = allCodes(r);
      check("R65.21 present (septic shock)", has(cs, "R65.21"), cs.join(","));
      check("N17.9 organ dysfunction present", has(cs, "N17.9"), cs.join(","));
      check("R65.20 absent", !has(cs, "R65.20"), cs.join(","));
      check("R65.21 not primary", r.primary_icd10.code !== "R65.21", r.primary_icd10.code);
      check("A41.9 primary (sepsis code-first)", r.primary_icd10.code === "A41.9", r.primary_icd10.code);
      check("L97.4 demoted to secondary (source sideline)", r.secondary_icd10.some((c) => c.code === "L97.4"), cs.join(","));
    }
  );

  await runCase(
    "L3 — lactate elevation counts as organ dysfunction",
    "Sepsis due to pneumonia. Lactate 4.2, hypoxic, started on antibiotics.",
    (r) => {
      const cs = allCodes(r);
      check("R65.20 present", has(cs, "R65.20"), cs.join(","));
      check("R65.20 secondary, never primary", r.primary_icd10.code !== "R65.20", r.primary_icd10.code);
    }
  );

  await runCase(
    "L4 — post-op wound infection source with ARDS + DIC",
    "Sepsis with ARDS and DIC, secondary to a post-operative wound infection.",
    (r) => {
      const cs = allCodes(r);
      check("T81.4- complication coded first", r.primary_icd10.code.startsWith("T81.4"), r.primary_icd10.code);
      check("R65.20 present", has(cs, "R65.20"), cs.join(","));
      check("J80 ARDS present", has(cs, "J80"), cs.join(","));
      check("D65 DIC present", has(cs, "D65"), cs.join(","));
    }
  );

  await runCase(
    "L5 — SIRS without organ dysfunction stays plain sepsis",
    "SIRS noted after surgery; no organ dysfunction, no hypotension. Afebrile, stable.",
    (r) => {
      const cs = allCodes(r);
      check("no R65.2- code", !cs.some((c) => c.startsWith("R65.2")), cs.join(","));
    }
  );

  await runCase(
    "L6 — plain urosepsis regression guard (sprint2 case unchanged)",
    "88-year-old woman admitted with urosepsis. Blood cultures positive. Urinalysis consistent with urinary tract infection. Afebrile now.",
    (r) => {
      const cs = allCodes(r);
      check("no R65.2- (no organ dysfunction documented)", !cs.some((c) => c.startsWith("R65.2")), cs.join(","));
      check("A41.9 still present", has(cs, "A41.9"), cs.join(","));
      check("N39.0 still present", has(cs, "N39.0"), cs.join(","));
    }
  );

  // ---- Sprint-5 issue V6 regression: RAG context must NOT let a chronic
  // skin-ulcer rule (L97) outrank an acute sepsis / septic-shock presentation.
  // Found in live acceptance smoke — the harness previously exercised only the
  // empty-ragContext path (runCase), missing the /api/code integration path
  // that feeds ragSearch() hits. ----
  console.log("\n============ issue V6 — RAG-dependent sepsis primary ============");

  const V6_NOTE =
    "Septic shock from a foot ulcer infection, on norepinephrine drip. Acute renal failure.";
  const V6_SIM_RAG = [
    { code: "L97.402", description: "Non-pressure chronic ulcer of left heel and midfoot with fat layer exposed", score: 0.9, source: "vector_db" as const },
    { code: "L89.152", description: "Pressure ulcer of left sacral region, stage 2", score: 0.85, source: "vector_db" as const },
    { code: "L97.912", description: "Non-pressure chronic ulcer of unspecified part of lower leg with fat layer exposed", score: 0.8, source: "vector_db" as const },
  ];

  {
    console.log("\n▶ V6-1 — simulated L89/L97 RAG hits (deterministic repro of the live failure)");
    const { parsed } = await mockProvider.generateCoding(V6_NOTE, V6_SIM_RAG);
    const issues = validateResponse(parsed, V6_NOTE);
    const cs = allCodes(parsed);
    for (const c of cs) emittedCodes.add(c.toUpperCase());
    console.log(`   primary=${parsed.primary_icd10.code} secondary=[${parsed.secondary_icd10.map((c) => c.code).join(", ")}]`);
    check("primary A41.9 (sepsis, NOT L97.4)", parsed.primary_icd10.code === "A41.9", parsed.primary_icd10.code);
    check("R65.21 present (septic shock)", has(cs, "R65.21"), cs.join(","));
    check("N17.9 organ dysfunction present", has(cs, "N17.9"), cs.join(","));
    check("L97.4 demoted to secondary (source sideline)", parsed.secondary_icd10.some((c) => c.code === "L97.4"), cs.join(","));
    check("no error-level issues", !issues.some((i) => i.level === "error"), JSON.stringify(issues));
  }

  {
    console.log("\n▶ V6-2 — real ragSearch() hits (mirrors the live /api/code path)");
    const outcome = await ragSearch(V6_NOTE);
    const ctx = outcome.results.map((r) => ({ code: r.code, description: r.description, score: r.score, source: r.source }));
    const { parsed } = await mockProvider.generateCoding(V6_NOTE, ctx);
    const issues = validateResponse(parsed, V6_NOTE);
    const cs = allCodes(parsed);
    for (const c of cs) emittedCodes.add(c.toUpperCase());
    console.log(`   rag hits=${ctx.length} primary=${parsed.primary_icd10.code}`);
    check("primary A41.9 with real RAG context", parsed.primary_icd10.code === "A41.9", parsed.primary_icd10.code);
    check("R65.21 present", has(cs, "R65.21"), cs.join(","));
    check("N17.9 present", has(cs, "N17.9"), cs.join(","));
    check("R65.21 never primary", parsed.primary_icd10.code !== "R65.21", parsed.primary_icd10.code);
    check("no error-level issues", !issues.some((i) => i.level === "error"), JSON.stringify(issues));
  }

  {
    console.log("\n▶ V6-3 — ulcer-only negative: no sepsis, ulcer stays primary even under RAG");
    const note = "Chronic non-healing ulcer on the lateral aspect of the left ankle present for 3 months.";
    const { parsed } = await mockProvider.generateCoding(note, V6_SIM_RAG);
    const issues = validateResponse(parsed, note);
    const cs = allCodes(parsed);
    for (const c of cs) emittedCodes.add(c.toUpperCase());
    console.log(`   primary=${parsed.primary_icd10.code} secondary=[${parsed.secondary_icd10.map((c) => c.code).join(", ")}]`);
    check("primary L97.4 (ulcer keeps primary without sepsis)", parsed.primary_icd10.code === "L97.4", parsed.primary_icd10.code);
    check("no R65.2- code", !cs.some((c) => c.startsWith("R65.2")), cs.join(","));
    check("no A41.9", !has(cs, "A41.9"), cs.join(","));
    check("no error-level issues", !issues.some((i) => i.level === "error"), JSON.stringify(issues));
  }

  // ---- synthetic validation checks ----
  {
    console.log("\n▶ U-L6 — SEPSIS_R65_PRIMARY (error)");
    const issues = validateResponse(resp("R65.20"), "Sepsis.");
    check("error fires", issues.some((i) => i.rule === "SEPSIS_R65_PRIMARY" && i.level === "error"), JSON.stringify(rulesOf(issues)));
    emittedCodes.add("R65.20");
  }
  {
    console.log("\n▶ U-L7 — SEPSIS_ORGAN_MISSING");
    const issues = validateResponse(resp("A41.9", ["R65.20"]), "Sepsis with organ dysfunction.");
    check("warning fires", issues.some((i) => i.rule === "SEPSIS_ORGAN_MISSING" && i.level === "warning"), JSON.stringify(rulesOf(issues)));
  }
  {
    console.log("\n▶ U-L8 — SEPSIS_SEVERE_MISSING (note has organ cues, coder missed R65.2-)");
    const issues = validateResponse(resp("A41.9"), "Sepsis with acute kidney injury.");
    check("warning fires", issues.some((i) => i.rule === "SEPSIS_SEVERE_MISSING" && i.level === "warning"), JSON.stringify(rulesOf(issues)));
  }
  {
    console.log("\n▶ U-L9 — SEPSIS_SIRS_CONFLICT (R65.2- on SIRS-only note)");
    const issues = validateResponse(resp("A41.9", ["R65.20"]), "SIRS, no organ dysfunction documented.");
    check("warning fires", issues.some((i) => i.rule === "SEPSIS_SIRS_CONFLICT" && i.level === "warning"), JSON.stringify(rulesOf(issues)));
  }
  {
    console.log("\n▶ U-L10 — correct ladder raises no sepsis warnings");
    const issues = validateResponse(resp("N39.0", ["A41.9", "R65.20", "N17.9"]), "Urosepsis with acute kidney injury from a urinary tract infection.");
    const bad = issues.filter((i) =>
      ["SEPSIS_R65_PRIMARY", "SEPSIS_ORGAN_MISSING", "SEPSIS_R65_ORDER", "SEPSIS_SIRS_CONFLICT"].includes(i.rule)
    );
    check("no SEPSIS_* warnings", bad.length === 0, JSON.stringify(bad.map((i) => i.rule)));
    for (const c of ["N39.0", "A41.9", "R65.20", "N17.9"]) emittedCodes.add(c);
  }

  // ============ 3. DB-presence sweep ============
  console.log("\n================ DB-presence sweep (bundled FY2026 extract) ================");
  const dbCodes = new Set<string>();
  const dir = join(process.cwd(), "public", "icd10cm");
  for (const f of readdirSync(dir)) {
    if (!/^chunk-\d+\.json$/.test(f)) continue; // skip manifest.json etc.
    const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const row of d.codes) dbCodes.add(row[0]);
  }
  const missing = [...emittedCodes].filter((c) => !dbCodes.has(c));
  check(`all ${emittedCodes.size} emitted codes exist in the ${dbCodes.size}-row extract`, missing.length === 0, missing.join(", "));

  console.log(`\n==================================================`);
  console.log(`PASS: ${pass}  FAIL: ${fail}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main();
