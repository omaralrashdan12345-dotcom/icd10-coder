/**
 * Sprint-4 regression harness: CVA late-effect coding (S) and poisoning
 * intent disambiguation (P).
 * Run: bun scripts/regression_sprint4.ts
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
  console.log(
    `   primary=${parsed.primary_icd10.code} secondary=[${parsed.secondary_icd10
      .map((c) => c.code)
      .join(", ")}] tertiary=[${parsed.tertiary_icd10.map((c) => c.code).join(", ")}]`
  );
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
function resp(
  primary: string,
  secondary: string[] = [],
  tertiary: string[] = []
): ClinicalCodingResponse {
  return {
    primary_icd10: detail(primary),
    secondary_icd10: secondary.map(detail),
    tertiary_icd10: tertiary.map(detail),
    entities_extracted: [],
  };
}

async function main() {
  // ============ 1. Idea S — CVA late-effect coding (I69) ============
  console.log("================ idea S — CVA late effects (I69) ================");

  let sawI69Case = false;

  await runCase(
    "S1 — ischemic stroke + left hemiparesis (right-hand default)",
    "Follow-up of left-sided hemiparesis after an ischemic stroke last year. Patient is right-handed.",
    (r, issues) => {
      sawI69Case = true;
      check("primary I63.9 (underlying stroke FIRST)", r.primary_icd10.code === "I63.9", r.primary_icd10.code);
      check("I69.354 (left side, right-hand dominant -> left non-dominant)", r.secondary_icd10.some((c) => c.code === "I69.354"), r.secondary_icd10.map((c) => c.code).join(","));
      check("Z86.73 suppressed", !has(allCodes(r), "Z86.73"), allCodes(r).join(","));
      check("no error-level validation", !issues.some((i) => i.level === "error"));
    }
  );

  await runCase(
    "S2 — infarction documented + aphasia",
    "Sequela of stroke with aphasia; imaging at the time showed a cerebral infarction.",
    (r) => {
      check("primary I63.9", r.primary_icd10.code === "I63.9", r.primary_icd10.code);
      check("I69.320 aphasia present", r.secondary_icd10.some((c) => c.code === "I69.320"), r.secondary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "S3 — brain bleed + dysphagia + facial droop (two residuals)",
    "Facial droop and trouble swallowing since his brain bleed six months ago.",
    (r) => {
      check("primary I61.9 (intracerebral hemorrhage)", r.primary_icd10.code === "I61.9", r.primary_icd10.code);
      check("I69.192 facial weakness present", r.secondary_icd10.some((c) => c.code === "I69.192"), r.secondary_icd10.map((c) => c.code).join(","));
      check("I69.191 dysphagia present", r.secondary_icd10.some((c) => c.code === "I69.191"), r.secondary_icd10.map((c) => c.code).join(","));
    }
  );

  await runCase(
    "S4 — type-unspecified stroke -> I69.9 family (I69.4- retired in FY2026)",
    "History of stroke 2 years ago with memory problems.",
    (r) => {
      check("primary I64.9 (stroke NOS)", r.primary_icd10.code === "I64.9", r.primary_icd10.code);
      check("I69.911 memory deficit present", r.secondary_icd10.some((c) => c.code === "I69.911"), r.secondary_icd10.map((c) => c.code).join(","));
      check("NO I69.4- code emitted (family absent from FY2026 DB)", !allCodes(r).some((c) => c.startsWith("I69.4")), allCodes(r).join(","));
    }
  );

  await runCase("S5 — post-stroke ataxia", "Post-stroke ataxia, evaluated in clinic.", (r) => {
    check("primary I64.9", r.primary_icd10.code === "I64.9", r.primary_icd10.code);
    check("I69.993 ataxia present", r.secondary_icd10.some((c) => c.code === "I69.993"), r.secondary_icd10.map((c) => c.code).join(","));
    sawI69Case = true;
  });

  await runCase(
    "S6 — pure stroke history WITHOUT deficits keeps Z86.73",
    "History of stroke, no residual deficits. Here for annual physical.",
    (r) => {
      check("Z86.73 still reported", has(allCodes(r), "Z86.73"), allCodes(r).join(","));
      check("no I69- code emitted", !allCodes(r).some((c) => c.startsWith("I69")), allCodes(r).join(","));
    }
  );

  {
    console.log("\n▶ U-S1 — I69_UNDERLYING_MISSING (LLM path)");
    const issues = validateResponse(resp("I69.320"), "Aphasia after an old stroke.");
    check("warning fires", issues.some((i) => i.rule === "I69_UNDERLYING_MISSING" && i.level === "warning"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ U-S2 — HISTORY_STROKE_CONFLICT (Z86.73 alongside I69.-)");
    const issues = validateResponse(resp("I63.9", ["Z86.73", "I69.320"]), "History of stroke with aphasia.");
    check("HISTORY_STROKE_CONFLICT fires", issues.some((i) => i.rule === "HISTORY_STROKE_CONFLICT"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ U-S2b — Z86_73_RESIDUAL_CONFLICT (Z86.73 but note documents deficits)");
    const issues = validateResponse(resp("I63.9", ["Z86.73"]), "History of stroke with aphasia.");
    check("Z86_73_RESIDUAL_CONFLICT fires", issues.some((i) => i.rule === "Z86_73_RESIDUAL_CONFLICT"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ U-S3 — I69_ORDER (underlying listed after I69)");
    const issues = validateResponse(resp("I69.320", ["I63.9"]), "Aphasia following cerebral infarction.");
    check("warning fires", issues.some((i) => i.rule === "I69_ORDER" && i.level === "warning"), JSON.stringify(issues.map((i) => i.rule)));
  }

  // ============ 2. Idea P — poisoning intent disambiguation ============
  console.log("\n================ idea P — poisoning intent (I.C.19.e) ================");

  await runCase("P1 — accidental acetaminophen overdose", "Admitted after accidental overdose of Tylenol.", (r, issues) => {
    check("primary T39.1X1A (accidental)", r.primary_icd10.code === "T39.1X1A", r.primary_icd10.code);
    check("external cause X44.XXXA matches intent", r.tertiary_icd10.some((c) => c.code === "X44.XXXA"), r.tertiary_icd10.map((c) => c.code).join(","));
    check("no POISONING_INTENT_MISMATCH", !issues.some((i) => i.rule === "POISONING_INTENT_MISMATCH"), JSON.stringify(issues.map((i) => i.rule)));
  });

  await runCase("P2 — aspirin suicide attempt", "Suicide attempt: ingested an unknown quantity of aspirin.", (r) => {
    check("primary T39.012A (self-harm, 3rd-digit style)", r.primary_icd10.code === "T39.012A", r.primary_icd10.code);
    check("external cause X64.XXXA", r.tertiary_icd10.some((c) => c.code === "X64.XXXA"), r.tertiary_icd10.map((c) => c.code).join(","));
  });

  await runCase("P3 — assault", "Patient was assaulted and forced to take ibuprofen.", (r) => {
    check("primary T39.313A (assault)", r.primary_icd10.code === "T39.313A", r.primary_icd10.code);
    check("external cause X85.XXXA", r.tertiary_icd10.some((c) => c.code === "X85.XXXA"), r.tertiary_icd10.map((c) => c.code).join(","));
  });

  await runCase("P4 — unknown pills, intent unclear", "Overdose of unknown pills, intent unclear.", (r) => {
    check("primary T50.904A (unspecified drugs, undetermined)", r.primary_icd10.code === "T50.904A", r.primary_icd10.code);
    check("external cause Y13.XXXA (undetermined)", r.tertiary_icd10.some((c) => c.code === "Y13.XXXA"), r.tertiary_icd10.map((c) => c.code).join(","));
  });

  await runCase("P5 — bare heroin overdose defaults to UNDETERMINED", "Heroin overdose.", (r, issues) => {
    check("primary T40.1X4A (undetermined, NOT accidental)", r.primary_icd10.code === "T40.1X4A", r.primary_icd10.code);
    check("external cause Y11.XXXA (narcotics, undetermined)", r.tertiary_icd10.some((c) => c.code === "Y11.XXXA"), r.tertiary_icd10.map((c) => c.code).join(","));
    check("POISONING_INTENT_UNDETERMINED info fires", issues.some((i) => i.rule === "POISONING_INTENT_UNDETERMINED" && i.level === "info"), JSON.stringify(issues.map((i) => i.rule)));
  });

  await runCase("P6 — weak cues with agent (accidentally ingested extra naproxen)", "Accidentally ingested extra doses of naproxen.", (r) => {
    check("primary T39.311A (accidental)", r.primary_icd10.code === "T39.311A", r.primary_icd10.code);
    check("external cause X44.XXXA", r.tertiary_icd10.some((c) => c.code === "X44.XXXA"), r.tertiary_icd10.map((c) => c.code).join(","));
  });

  await runCase("P7 — negated overdose never codes", "Patient denies overdose or poisoning. Presents for routine care.", (r) => {
    const cs = allCodes(r);
    check("no T36-T50 poisoning code", !cs.some((c) => /^T(3[6-9]|4[0-9]|50)/.test(c)), cs.join(","));
    check("no X44 external cause", !cs.some((c) => c.startsWith("X44")), cs.join(","));
  });

  {
    console.log("\n▶ U-P1 — POISONING_INTENT_UNDETERMINED info (LLM path)");
    const issues = validateResponse(resp("T39.1X4A"), "Overdose.");
    check("info fires", issues.some((i) => i.rule === "POISONING_INTENT_UNDETERMINED" && i.level === "info"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ U-P2 — POISONING_INTENT_MISMATCH (accidental T vs self-harm ext)");
    const issues = validateResponse(resp("T39.1X1A", [], ["X64.XXXA"]), "Overdose of acetaminophen.");
    check("warning fires", issues.some((i) => i.rule === "POISONING_INTENT_MISMATCH" && i.level === "warning"), JSON.stringify(issues.map((i) => i.rule)));
  }
  {
    console.log("\n▶ U-P3 — 3rd-digit style parsed, matching intent -> no mismatch");
    const issues = validateResponse(resp("T39.011A", [], ["X44.XXXA"]), "Accidental aspirin overdose.");
    check("no POISONING_INTENT_MISMATCH", !issues.some((i) => i.rule === "POISONING_INTENT_MISMATCH"), JSON.stringify(issues.map((i) => i.rule)));
  }

  // Guard: any I69 case emitted must never produce an I69.4- code.
  if (!sawI69Case) {
    fail++;
    failures.push("no I69 case executed — harness misconfigured");
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
