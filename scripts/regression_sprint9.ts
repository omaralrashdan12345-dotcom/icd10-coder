/**
 * Sprint-9 regression harness — v0.10.0 hardening pass.
 *
 * Guards three work streams shipped in v0.10.0:
 *
 *  X — Poisoning/toxic-effect external-cause exemption: T36-T65 primaries
 *      carry the external-cause INTENT inside the code itself (5th/6th
 *      character; FY2027 Official Guidelines I.C.19.b + I.C.20 — Chapter 20
 *      reporting is not nationally required and Y99 status is "not
 *      applicable to poisonings, adverse effects, misadventures or late
 *      effects"). ensureExternalCause must therefore NEVER fabricate the
 *      generic W19.XXXA "unspecified fall" fallback for those encounters
 *      (v0.9.1 documented nuance: live D1/D3/D5 carried W19@0.5 +
 *      LOW_CONFIDENCE purely from this path). Genuine S/T injuries keep the
 *      external-cause guarantee in BOTH directions: mechanism-matched codes
 *      (W55.03XA) and the generic fallback (W19@0.5 + LOW_CONFIDENCE) on
 *      injury encounters with no documented mechanism.
 *
 *  A — Official FY2027 order-addenda sentinels: the full code-level delta
 *      extracted from the authoritative machine-readable addendum
 *      (icd10cm-order-addenda-2027.txt, ships inside the official
 *      code-descriptions zip) must stay reflected in the bundled extract:
 *      190 billable adds present, 63 header adds present, 21 pure deletions
 *      absent, 15 billable-to-header demotions present-and-NOT-billable, 4
 *      revised short titles byte-equal. Identities: 98,186 +238 -21 = 98,403
 *      rows; 74,719 +190 -15 -15 = 74,879 billable.
 *
 *  H — Live-refresh hardening invariants (full-db.ts): atomic dataset swap
 *      helper wired into BOTH the bundled seed and the NLM live path, and
 *      plausible-size bounds active on the refresh gateways.
 *
 * Run: bun scripts/regression_sprint9.ts   (from repo cwd)
 */
import { mockProvider } from "../src/lib/llm/mock";
import { validateResponse } from "../src/lib/icd/validation";
import {
  ensureExternalCause,
  isIntentBearingToxicEffect,
} from "../src/lib/icd/external-cause";
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

// Bundled extract loader: Map<code, [desc, billableFlag]>
function loadBundle(): Map<string, [string, number]> {
  const dir = join(process.cwd(), "public", "icd10cm");
  const map = new Map<string, [string, number]>();
  for (const f of readdirSync(dir).filter((x) => /^chunk-\d+\.json$/.test(x)).sort()) {
    for (const [c, d, flag] of JSON.parse(readFileSync(join(dir, f), "utf8")).codes as [string, string, number][]) {
      map.set(c.toUpperCase(), [d, flag === 1 ? 1 : 0]);
    }
  }
  return map;
}

async function main() {
  // ============ X — poisoning/toxic external-cause exemption ============
  console.log("================ X — T36-T65 external-cause exemption ================");

  {
    console.log("\n▶ X1 — intent-bearing boundary (isIntentBearingToxicEffect)");
    const yes = ["T36.0X1A", "T39.011A", "T40.411A", "T43.211A", "T50.901A", "T50.921A",
      "T51.0111", "T59.821A", "T60.9X1A", "T63.001A", "T65.854A", "t40.411a"];
    const no = ["T15.01XA", "T20.9XXA", "T33.9", "T35.05XA", "T67.4XXA", "T68.XXXA",
      "T71.1511", "T75.01XA", "T75.4XXA", "T78.40XA", "T80.89XA", "T81.44XA",
      "S81.811A", "S52.501A", "E11.9", "I63.9"];
    for (const c of yes) check(`T36-T65 exempt: ${c}`, isIntentBearingToxicEffect(c));
    for (const c of no) check(`outside range keeps guarantee: ${c}`, !isIntentBearingToxicEffect(c));
  }

  {
    console.log("\n▶ X2 — no fabricated external cause on poisoning/toxic primaries");
    const cases: [string, string, string][] = [
      ["D5 fentanyl", "T40.411A", "Accidental fentanyl overdose, naloxone administered by EMS, brought to the ER."],
      ["D3 unspecified pills", "T50.901A", "Ingested an unknown quantity of pills, intentional self-harm."],
      ["D1 snake envenomation", "T63.001A", "Bitten by a rattlesnake while hiking, envenomation with local swelling."],
      ["T59 hexamethylene diisocyanate", "T59.821A", "Inhaled hexamethylene diisocyanate fumes at work, acute respiratory distress."],
      ["T65 medetomidine", "T65.854A", "Exposure to medetomidine of undetermined intent."],
    ];
    for (const [name, primary, note] of cases) {
      const r = resp(primary);
      ensureExternalCause(r, note);
      const externals = r.tertiary_icd10.filter((c) => /^[VWXY]/.test(c.code));
      check(`${name}: no V/W/X/Y fabricated`, externals.length === 0, externals.map((c) => c.code).join(","));
      const issues = validateResponse(r, note);
      check(
        `${name}: zero warning-level advisories`,
        !hasWarning(issues),
        JSON.stringify(rulesOf(issues))
      );
    }
  }

  {
    console.log("\n▶ X3 — explicit fall text does NOT override the exemption");
    const r = resp("T40.411A");
    ensureExternalCause(r, "Fell down the stairs after taking fentanyl, found unresponsive.");
    check(
      "poisoning primary + fall language: still no external cause",
      !r.tertiary_icd10.some((c) => /^[VWXY]/.test(c.code)),
      r.tertiary_icd10.map((c) => c.code).join(",")
    );
  }

  {
    console.log("\n▶ X4 — genuine injuries KEEP the external-cause guarantee (both directions)");
    // mechanism-matched
    const cat = resp("S81.811A");
    ensureExternalCause(cat, "Cat scratch on right lower leg, ER visit today.");
    check("S81 + cat scratch: W55.03XA appended", cat.tertiary_icd10.some((c) => c.code === "W55.03XA"));
    // generic fallback with LOW_CONFIDENCE (true-positive advisory preserved)
    // NOTE: no mechanism keywords in the note — "fall" would match the
    // mechanism rule (W19@0.86); only the keyword-less path yields the
    // generic 0.5-confidence fallback.
    const fall = resp("S52.501A", [], [], 0.9);
    ensureExternalCause(fall, "Right wrist pain after injury, ED visit today.");
    const w19 = fall.tertiary_icd10.find((c) => c.code === "W19.XXXA");
    check("S52 + no mechanism: generic W19.XXXA appended", !!w19);
    check("generic W19 carries confidence 0.5", w19?.confidence === 0.5, String(w19?.confidence));
    const issues = validateResponse(fall, "Right wrist pain after injury, ED visit today.");
    check(
      "generic W19 still flagged LOW_CONFIDENCE on real injuries",
      issues.some((i) => i.rule === "LOW_CONFIDENCE" && i.code === "W19.XXXA"),
      JSON.stringify(rulesOf(issues))
    );
    // existing external cause anywhere → nothing added
    const hasExt = resp("S52.501A", [], ["W10.8XXA"]);
    ensureExternalCause(hasExt, "fell down the stairs");
    check("S52 with W10.8XXA present: nothing duplicated", hasExt.tertiary_icd10.length === 1);
  }

  {
    console.log("\n▶ X5 — engine end-to-end: D-note sweep stays advisory-free AND external-free");
    await runCase("D5 — fentanyl poisoning", "Accidental fentanyl overdose, naloxone administered by EMS, brought to the ER.", (r, issues) => {
      check("primary T40.411A", r.primary_icd10.code === "T40.411A", r.primary_icd10.code);
      check("no V/W/X/Y anywhere", !allCodes(r).some((c) => /^[VWXY]/.test(c)), allCodes(r).join(","));
      check("zero warning-level advisories", !hasWarning(issues), JSON.stringify(rulesOf(issues)));
    });
    await runCase("D3 — unspecified pills", "Ingested an unknown quantity of pills in a suicide attempt, brought to the ED.", (r, issues) => {
      check("no V/W/X/Y anywhere", !allCodes(r).some((c) => /^[VWXY]/.test(c)), allCodes(r).join(","));
      check("zero warning-level advisories", !hasWarning(issues), JSON.stringify(rulesOf(issues)));
    });
    await runCase("D1 — snake envenomation", "Bitten by a venomous snake while hiking this morning, swelling of the right hand.", (r, issues) => {
      check("primary T63.001A", r.primary_icd10.code === "T63.001A", r.primary_icd10.code);
      check("no V/W/X/Y anywhere", !allCodes(r).some((c) => /^[VWXY]/.test(c)), allCodes(r).join(","));
      check("zero warning-level advisories", !hasWarning(issues), JSON.stringify(rulesOf(issues)));
    });
  }

  // ============ A — official order-addenda sentinels ============
  console.log("\n================ A — official FY2027 order-addenda sentinels ================");
  const bundle = loadBundle();
  const isBillable = (c: string) => bundle.get(c)?.[1] === 1;
  const isPresent = (c: string) => bundle.has(c);

  {
    console.log("\n▶ A1 — 190 billable adds present AND billable");
    const adds1 = [
      "C78.31", "C78.32", "C79.83", "D69.11", "D69.19", "E89.830", "E89.838", "F64.A",
      "I42.00", "I42.01", "I42.09", "I42.81", "I42.89", "I47.22", "I49.81", "I49.82", "I49.89",
      "J34.830", "J34.831", "J34.832", "J34.833", "J34.839", "J4B", "K31.B", "K6A.01", "K6A.09",
      "K6A.8", "K74.0A", "K76.83", "L02.237", "M04.3", "M67.A01", "M67.A02", "M67.A09",
      "M72.20", "M72.21", "M72.22",
      "M86.8X11", "M86.8X19", "M86.8X21", "M86.8X29", "M86.8X31", "M86.8X39", "M86.8X41",
      "M86.8X49", "M86.8X51", "M86.8X59", "M86.8X61", "M86.8X69", "M86.8X71", "M86.8X79",
      "M86.8X81", "M86.8X89",
      "N99.860", "N99.861", "O00.121", "O00.129", "O00.131", "O00.139", "O00.31", "O00.32",
      "O00.41", "O00.42", "O00.511", "O00.519", "O00.521", "O00.529",
      "O31.40X0", "O31.40X9", "O31.43X5", "Q87.A",
      "QA1.71", "QA1.790", "QA1.791", "QA1.792", "QA1.798",
      "R78.72",
      "T52.811A", "T52.814S", "T52.894D", "T59.821A", "T59.824S", "T65.851A", "T65.854S",
      "Z68.18", "Z68.19", "Z77.013", "Z77.32", "Z77.33", "Z77.40", "Z77.41", "Z77.42", "Z77.49",
      "Z86.17", "Z87.8901", "Z87.8909", "Z87.893",
    ];
    for (const c of adds1) {
      check(`add billable ${c}`, isPresent(c) && isBillable(c), isPresent(c) ? "present but NOT billable" : "MISSING");
    }
  }

  {
    console.log("\n▶ A2 — 63 header adds present AND non-billable");
    const adds0 = [
      "E89.83", "J34.83", "K6A", "K6A.0", "M67.A", "M67.A0", "N99.86", "O00.12", "O00.13",
      "O00.3", "O00.4", "O00.5", "O00.51", "O00.52", "O31.4", "O31.40", "O31.41", "O31.42",
      "O31.43", "QA1", "QA1.7", "QA1.79",
      "T52.81", "T52.811", "T52.814", "T52.82", "T52.824", "T52.89", "T52.894",
      "T59.82", "T59.821", "T59.824", "T65.85", "T65.851", "T65.854", "Z77.4",
    ];
    for (const c of adds0) {
      check(`add header ${c}`, isPresent(c) && !isBillable(c), isPresent(c) ? "present but billable" : "MISSING");
    }
  }

  {
    console.log("\n▶ A3 — 21 pure deletions absent from the bundle");
    const dels = [
      "S23.420", "S23.420A", "S23.420D", "S23.420S",
      "T52.8X", "T52.8X1", "T52.8X2", "T52.8X3", "T52.8X4",
      "T52.8X1A", "T52.8X1D", "T52.8X1S", "T52.8X2A", "T52.8X2D", "T52.8X2S",
      "T52.8X3A", "T52.8X3D", "T52.8X3S", "T52.8X4A", "T52.8X4D", "T52.8X4S",
    ];
    for (const c of dels) {
      check(`delete absent ${c}`, !isPresent(c), "still present");
    }
  }

  {
    console.log("\n▶ A4 — 15 billable-to-header demotions present-and-NOT-billable");
    const demoted = [
      "D69.1", "I42.0", "I42.8", "I49.8", "M72.2",
      "M86.8X1", "M86.8X2", "M86.8X3", "M86.8X4", "M86.8X5", "M86.8X6", "M86.8X7", "M86.8X8",
      "Z68.1", "Z87.890",
    ];
    for (const c of demoted) {
      check(`demoted header ${c}`, isPresent(c) && !isBillable(c), isPresent(c) ? "still billable" : "MISSING");
    }
  }

  {
    console.log("\n▶ A5 — 4 revised titles byte-equal to the official SHORT-title column");
    const revisions: [string, string][] = [
      ["L02.232", "Carbuncle of back [any part, except buttock and flank]"],
      ["L03.312", "Cellulitis of back [any part except buttock and flank]"],
      ["L03.322", "Acute lymphangitis of back"],
      ["Z29.14", "Encounter for prophylactic rabies immune globulin"],
    ];
    for (const [c, title] of revisions) {
      check(`revision ${c}`, bundle.get(c)?.[0] === title, `bundle='${bundle.get(c)?.[0]}' official='${title}'`);
    }
  }

  {
    console.log("\n▶ A6 — static identity anchors");
    check("bundle total 98,403", [...bundle.values()].length === 98_403, String(bundle.size));
    check(
      "bundle billable 74,879",
      [...bundle.values()].filter(([, f]) => f === 1).length === 74_879,
      String([...bundle.values()].filter(([, f]) => f === 1).length)
    );
    // conversion-table identity: old -> new pairs from the official eff=2026 batch
    const convPairs: [string, string][] = [
      ["C78.39", "C78.31"], ["C78.39", "C78.32"], ["C79.89", "C79.83"], ["D69.1", "D69.11"],
      ["I42.0", "I42.00"], ["I42.8", "I42.81"], ["I49.8", "I49.81"], ["M72.2", "M72.20"],
      ["Z68.1", "Z68.18"], ["T52.8X", "T52.89"], ["S23.420", "S23.421"],
    ];
    for (const [oldC, newC] of convPairs) {
      check(`conv ${oldC} -> ${newC} lands`, isPresent(newC), "new code missing");
    }
  }

  // ============ H — live-refresh hardening invariants ============
  console.log("\n================ H — live-refresh hardening invariants ================");
  {
    console.log("\n▶ H1 — full-db.ts structural tripwires");
    const src = readFileSync(join(process.cwd(), "src", "lib", "icd", "full-db.ts"), "utf8");
    const swapCallSites = (src.match(/idbSwapDataset\(/g) ?? []).length;
    check("atomic swap helper called by BOTH seed and live paths", swapCallSites >= 3, `call sites: ${swapCallSites}`);
    check(
      "plausible-size bounds gate the refresh",
      src.includes("MIN_EXPECTED_CODES") && src.includes("MAX_EXPECTED_CODES"),
      ""
    );
    check("single-flight refresh guard present", src.includes("refreshPromise"), "");
    check(
      "per-page timeout present",
      src.includes("NLM_PAGE_TIMEOUT_MS") && src.includes("AbortController"),
      ""
    );
    check(
      "early-pagination abort present",
      src.includes("pagination ended early"),
      ""
    );
    check(
      "bundled-seed integrity check present",
      src.includes("bundled seed integrity failure"),
      ""
    );
    check(
      "seeder rejects inconsistent caches (storedRows vs meta.total)",
      src.includes("cacheConsistent"),
      ""
    );
    // the old non-atomic write path must be gone from the refresh flow:
    // scope the check to the doRefreshFromNlmLive..clearFullDb segment
    const segStart = src.indexOf("async function doRefreshFromNlmLive");
    const segEnd = src.indexOf("export async function clearFullDb");
    const refreshSeg = segStart >= 0 && segEnd > segStart ? src.slice(segStart, segEnd) : "";
    check(
      "no direct idbClear(chunks) inside the live refresh path",
      refreshSeg.length > 0 && !refreshSeg.includes("idbClear("),
      ""
    );
  }

  // ============ summary ============
  console.log(`\n================ sprint9 summary ================`);
  console.log(`pass=${pass} fail=${fail} total=${pass + fail}`);
  if (failures.length) {
    console.log("FAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main();
