/**
 * Sprint-8 regression harness — v0.9.1 validator polish.
 *
 * Guards the three advisory false-positive families that v0.8.2/v0.9.0
 * shipped with as "known pre-existing" advisories, now fixed:
 *
 *  P — POISONING_PLACEHOLDER_X is now data-driven: T36-T50 codes whose
 *      5-character prefix is an OFFICIAL digit stem (FY2024+ substance
 *      subdivisions: T40.41- synthetic narcotics, T40.42- tramadol,
 *      T43.21-, T50.90- unspecified drugs, ...) no longer fire the
 *      placeholder advisory; true X-less typos (T39.12A) still do.
 *      The embedded stem set must always equal the set recomputed from
 *      the bundled FY2027 extract (regeneration identity).
 *  S — T81.4- postprocedural infection/sepsis joins SEPSIS_UNDERLYING_
 *      INFECTION companions: postoperative sepsis (T81.44XA + A41.9)
 *      no longer triggers the missing-underlying-infection warning.
 *  E — T80-T88 complication codes are judged by the complication episode
 *      grammar (complicationEpisode), matching the engine: ACTIVE
 *      postprocedural sepsis on post-op day 3 is initial (A), not a
 *      SEVENTH_CHAR_EPISODE violation. True follow-up/sequela notes
 *      still warn.
 *  L — LOW_CONFIDENCE noise trim: the R69 fallback keeps its review
 *      flag only when NOTHING matched; when a specific mechanism
 *      external cause is attached (W10.8XXA stairs), the pair is a
 *      deterministic engine output and the flag is suppressed. All
 *      other low-confidence codes still warn.
 *
 * Run: bun scripts/regression_sprint8.ts   (from repo cwd)
 */
import { mockProvider } from "../src/lib/llm/mock";
import { validateResponse } from "../src/lib/icd/validation";
import { CODE_FIRST_RULES } from "../src/lib/icd/data";
import {
  OFFICIAL_POISONING_DIGIT_STEMS,
  POISONING_STEMS_SOURCE_FY,
} from "../src/lib/icd/poisoning-stems";
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
  return [r.primary_icd10.code, ...r.secondary_icd10.map((c) => c.code), ...r.tertiary_icd10.map((c) => c.code)];
}
function rulesOf(issues: ReturnType<typeof validateResponse>): string[] {
  return issues.map((i) => i.rule);
}
function hasWarning(issues: ReturnType<typeof validateResponse>): boolean {
  return issues.some((i) => i.level === "warning" || i.level === "error");
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
function resp(
  primary: string,
  secondary: string[] = [],
  tertiary: string[] = [],
  conf?: number
): ClinicalCodingResponse {
  return {
    primary_icd10: detail(primary, conf !== undefined ? { confidence: conf } : {}),
    secondary_icd10: secondary.map((c) => detail(c)),
    tertiary_icd10: tertiary.map((c) => detail(c)),
    entities_extracted: [],
  };
}

async function main() {
  // ============ P — poisoning placeholder, data-driven ============
  console.log("================ P — POISONING_PLACEHOLDER_X data-driven fix ================");

  {
    console.log("\n▶ P1 — embedded stems == recomputed stems from bundled extract");
    const dir = join(process.cwd(), "public", "icd10cm");
    const rows: [string, string, number][] = [];
    for (const f of readdirSync(dir).filter((x) => /^chunk-\d+\.json$/.test(x)).sort()) {
      rows.push(...JSON.parse(readFileSync(join(dir, f), "utf8")).codes);
    }
    const STEM_RE = /^T(?:3[6-9]|4[0-9]|50)\.\d{2}/;
    const recomputed = new Set(rows.filter(([c]) => STEM_RE.test(c)).map(([c]) => c.slice(0, 6)));
    const embedded = new Set(OFFICIAL_POISONING_DIGIT_STEMS);
    check(
      "set identity with bundled FY" + POISONING_STEMS_SOURCE_FY + " extract",
      recomputed.size === embedded.size && [...recomputed].every((s) => embedded.has(s)),
      `embedded=${embedded.size} recomputed=${recomputed.size}`
    );
    check("non-trivial set (>50 stems)", embedded.size > 50, String(embedded.size));
    for (const anchor of ["T40.41", "T40.42", "T43.21", "T50.90", "T39.01"]) {
      check(`anchor stem ${anchor} present`, embedded.has(anchor));
    }
    for (const absent of ["T39.11", "T39.12", "T39.1X"]) {
      check(`non-official stem ${absent} absent`, !embedded.has(absent));
    }
  }

  {
    console.log("\n▶ P2 — official digit shapes no longer fire the advisory");
    for (const code of ["T50.901A", "T40.411A", "T43.211A", "T36.91A", "T39.011A"]) {
      const issues = validateResponse(resp(code), "Accidental ingestion/poisoning.");
      check(
        `no POISONING_PLACEHOLDER_X for ${code}`,
        !issues.some((i) => i.rule === "POISONING_PLACEHOLDER_X"),
        JSON.stringify(rulesOf(issues))
      );
    }
  }

  {
    console.log("\n▶ P3 — X-less typos still fire the advisory (controls)");
    for (const code of ["T39.12A", "T50.921A", "T40.43A"]) {
      const issues = validateResponse(resp(code), "Ingested unknown quantity of aspirin.");
      check(
        `POISONING_PLACEHOLDER_X fires for ${code}`,
        issues.some((i) => i.rule === "POISONING_PLACEHOLDER_X"),
        JSON.stringify(rulesOf(issues))
      );
    }
  }

  {
    console.log("\n▶ P4 — X-placeholder shapes unaffected (sprint1 V6 parity)");
    const issues = validateResponse(resp("T39.1X1A"), "Ingested unknown quantity of aspirin.");
    check("no POISONING_PLACEHOLDER_X for T39.1X1A", !issues.some((i) => i.rule === "POISONING_PLACEHOLDER_X"));
  }

  // ============ S — T81.4- sepsis companion ============
  console.log("\n================ S — T81.4- joins SEPSIS_UNDERLYING_INFECTION ================");

  {
    console.log("\n▶ S1 — postprocedural sepsis pairs satisfy the rule (info, not warning)");
    for (const t of ["T81.44XA", "T81.40XA", "T81.41XS", "T81.49XD"]) {
      const issues = validateResponse(resp(t, ["A41.9"]), "Postoperative sepsis identified on post-op day 3.");
      const rule = issues.find((i) => i.rule === "SEPSIS_UNDERLYING_INFECTION");
      check(
        `${t} + A41.9 -> no SEPSIS warning`,
        !issues.some((i) => i.rule === "SEPSIS_UNDERLYING_INFECTION" && i.level === "warning"),
        JSON.stringify(rulesOf(issues))
      );
      check(`${t} + A41.9 -> rule satisfied (info present)`, !!rule && rule.level === "info");
    }
  }

  {
    console.log("\n▶ S2 — controls: missing companion still warns, present still infos");
    const issues = validateResponse(resp("A41.9"), "Sepsis, organism unspecified.");
    check(
      "A41.9 alone -> SEPSIS warning fires",
      issues.some((i) => i.rule === "SEPSIS_UNDERLYING_INFECTION" && i.level === "warning"),
      JSON.stringify(rulesOf(issues))
    );
    const ok = validateResponse(resp("J18.9", ["A41.9"]), "Sepsis due to pneumonia.");
    check(
      "J18.9 + A41.9 -> info (parity with sprint2)",
      ok.some((i) => i.rule === "SEPSIS_UNDERLYING_INFECTION" && i.level === "info")
    );
  }

  {
    console.log("\n▶ S3 — data conformance of the SEPSIS rule");
    const rule = CODE_FIRST_RULES.find((r) => r.rule_id === "SEPSIS_UNDERLYING_INFECTION");
    check("rule exists", !!rule);
    check("companion_codes include T81.4", !!rule && rule.companion_codes.includes("T81.4"), JSON.stringify(rule?.companion_codes));
    check("code_first_codes include T81.4", !!rule && !!rule.code_first_codes?.includes("T81.4"));
    check(
      "triggers unchanged (A41/A40/R65.2)",
      !!rule && JSON.stringify(rule.trigger_codes) === JSON.stringify(["A41", "A40", "R65.2"])
    );
    check(
      "existing companions preserved",
      !!rule && ["J18", "N39.0", "L03", "M86", "L97", "L89", "L98"].every((c) => rule.companion_codes.includes(c))
    );
  }

  // ============ E — complication episode grammar (7th char) ============
  console.log("\n================ E — complication-aware SEVENTH_CHAR_EPISODE ================");

  await runCase("E1 — engine K5: postoperative sepsis on post-op day 3", "Postoperative sepsis identified on post-op day 3.", (r, issues) => {
    check("primary T81.44XA (initial = active treatment)", r.primary_icd10.code === "T81.44XA", r.primary_icd10.code);
    check(
      "no SEVENTH_CHAR_EPISODE warning",
      !issues.some((i) => i.rule === "SEVENTH_CHAR_EPISODE"),
      JSON.stringify(rulesOf(issues))
    );
    check(
      "no SEPSIS_UNDERLYING_INFECTION warning (T81.4 companion)",
      !issues.some((i) => i.rule === "SEPSIS_UNDERLYING_INFECTION" && i.level === "warning"),
      JSON.stringify(rulesOf(issues))
    );
    check("no error-level issues", !issues.some((i) => i.level === "error"));
  });

  {
    console.log("\n▶ E2 — true follow-up of a complication still warns on A-coded T81.4-");
    const issues = validateResponse(resp("T81.40XA"), "Follow-up of the post-op wound infection; wound check, healing.");
    check(
      "SEVENTH_CHAR_EPISODE fires (D expected)",
      issues.some((i) => i.rule === "SEVENTH_CHAR_EPISODE" && i.level === "warning"),
      JSON.stringify(rulesOf(issues))
    );
  }

  await runCase("E3 — engine K6: follow-up emits D, exemption does not mask it", "Follow-up of the post-op wound infection; on oral antibiotics, wound improving.", (r, issues) => {
    check("primary T81.40XD (subsequent)", r.primary_icd10.code === "T81.40XD", r.primary_icd10.code);
    check(
      "no SEVENTH_CHAR_EPISODE (code carries D)",
      !issues.some((i) => i.rule === "SEVENTH_CHAR_EPISODE"),
      JSON.stringify(rulesOf(issues))
    );
  });

  {
    console.log("\n▶ E4 — sequela grammar still enforced on complication codes");
    const issues = validateResponse(resp("T81.40XA"), "Sequela of a postoperative infection, late effect.");
    check(
      "SEVENTH_CHAR_EPISODE fires (S expected)",
      issues.some((i) => i.rule === "SEVENTH_CHAR_EPISODE" && i.level === "warning"),
      JSON.stringify(rulesOf(issues))
    );
  }

  {
    console.log("\n▶ E5 — non-complication injury codes unaffected (sprint3 U-B1 parity)");
    const issues = validateResponse(resp("S82.201A"), "Cast check follow-up for tibia fracture, routine healing.");
    check(
      "SEVENTH_CHAR_EPISODE fires for S82.201A on follow-up",
      issues.some((i) => i.rule === "SEVENTH_CHAR_EPISODE" && i.level === "warning"),
      JSON.stringify(rulesOf(issues))
    );
  }

  // ============ L — LOW_CONFIDENCE noise trim ============
  console.log("\n================ L — LOW_CONFIDENCE trim ================");

  {
    console.log("\n▶ L1 — R69 alone (nothing matched) keeps the review flag");
    const issues = validateResponse(resp("R69", [], [], 0.3), "xyzzy blorptastic quuxification noted.");
    check(
      "LOW_CONFIDENCE fires for bare R69",
      issues.some((i) => i.rule === "LOW_CONFIDENCE" && i.code === "R69"),
      JSON.stringify(rulesOf(issues))
    );
  }

  {
    console.log("\n▶ L2 — R69 + specific mechanism external cause: flag suppressed");
    const issues = validateResponse(resp("R69", [], ["W10.8XXA"], 0.3), "Patient fell down the stairs at home.");
    check(
      "no LOW_CONFIDENCE for R69 + W10.8XXA",
      !issues.some((i) => i.rule === "LOW_CONFIDENCE"),
      JSON.stringify(rulesOf(issues))
    );
  }

  {
    console.log("\n▶ L3 — non-R69 low-confidence codes still flag");
    const issues = validateResponse(resp("M25.569", [], [], 0.4), "Knee pain, unclear.");
    check(
      "LOW_CONFIDENCE fires for 0.4-confidence code",
      issues.some((i) => i.rule === "LOW_CONFIDENCE" && i.code === "M25.569"),
      JSON.stringify(rulesOf(issues))
    );
  }

  await runCase("L4 — engine stairs case (live D4 noise) is clean", "Patient fell down the stairs at home.", (r, issues) => {
    check("W10.8XXA mechanism captured", r.tertiary_icd10.some((c) => c.code === "W10.8XXA"), r.tertiary_icd10.map((c) => c.code).join(","));
    check(
      "no LOW_CONFIDENCE (mechanism documented)",
      !issues.some((i) => i.rule === "LOW_CONFIDENCE"),
      JSON.stringify(rulesOf(issues))
    );
  });

  // ============ D — D-case engine sweep (advisory-free) ============
  console.log("\n================ D — D-case engine sweep ================");

  await runCase("D1 — venomous snake bite", "Patient was bitten by a venomous snake on the left hand while hiking, brought to the ER.", (r, issues) => {
    check("primary T63.001A", r.primary_icd10.code === "T63.001A", r.primary_icd10.code);
    check("zero warning/error advisories", !hasWarning(issues), JSON.stringify(rulesOf(issues)));
  });

  await runCase("D3 — unspecified drug poisoning", "Child accidentally ingested an unknown quantity of unidentified pills at home.", (r, issues) => {
    check("primary T50.901A", r.primary_icd10.code === "T50.901A", r.primary_icd10.code);
    check(
      "zero warning-level advisories (POISONING_EXTERNAL_CAUSE info tolerated)",
      !issues.some((i) => i.level === "warning" || i.level === "error"),
      JSON.stringify(rulesOf(issues))
    );
  });

  await runCase("D5 — fentanyl poisoning", "Accidental fentanyl overdose, naloxone administered by EMS, brought to the ER.", (r, issues) => {
    check("primary T40.411A", r.primary_icd10.code === "T40.411A", r.primary_icd10.code);
    check(
      "zero warning-level advisories",
      !issues.some((i) => i.level === "warning" || i.level === "error"),
      JSON.stringify(rulesOf(issues))
    );
  });

  // ============ DB-presence sweep ============
  console.log("\n================ DB presence sweep (bundled FY2027 extract) ================");
  {
    const dir = join(process.cwd(), "public", "icd10cm");
    const bundle = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /^chunk-\d+\.json$/.test(x)).sort()) {
      for (const [c] of JSON.parse(readFileSync(join(dir, f), "utf8")).codes) bundle.add(c);
    }
    const missing = [...emittedCodes].filter((c) => !bundle.has(c));
    check(
      `all ${emittedCodes.size} emitted codes are bundled rows`,
      missing.length === 0,
      missing.join(",")
    );
    check("T81.44XA is a bundled FY2027 row", bundle.has("T81.44XA"));
  }

  // ============ summary ============
  console.log(`\n================ sprint8 summary ================`);
  console.log(`pass=${pass} fail=${fail} total=${pass + fail}`);
  if (failures.length) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main();
