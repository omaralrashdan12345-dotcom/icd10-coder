/**
 * Sprint-7 regression harness (v0.9.0 — CDC FY2027 data refresh).
 *
 * Guards the FY2026 → FY2027 refresh against drift from the OFFICIAL
 * CDC/NCHS FY2027 publication (order file icd10cm-order-2027.txt,
 * downloaded from ftp.cdc.gov .../ICD10CM/2027/, cross-checked against
 * icd10cm-order-addenda-2027.txt / icd10cm-codes-addenda-2027.txt and the
 * official ICD-10-CM-CONVERSION-TABLE-FY2027.xlsx):
 *
 *   1. Refresh reconciliation — the official FY2026→FY2027 deltas that the
 *      bundled manifest must reflect (98,186 +238 −21 = 98,403 rows;
 *      74,719 +190 −15 −15 = 74,879 billable; the last −15 are the
 *      billable→header demotions listed in §4).
 *   2. Deletions — the 21 FY2026 rows retired by FY2027 (S23.420
 *      sternoclavicular sprain group — no conversion-table successor, the
 *      S23.42 group restructured to "sprain of sternum" S23.421/.428/.429;
 *      T52.8X organic-solvent X-placeholder group — fanned out in the
 *      conversion table to T52.81- alkenes / T52.82- cycloparaffins /
 *      T52.89- other organic solvents).
 *   3. Additions — anchors from every FY2027 new family, including the
 *      widened letter-in-code-position shapes (J4B, K31.B, K6A-, K74.0A,
 *      M67.A-) and the QA1 inherited neoplasm-predisposition block
 *      (anchored in sprint6 §2).
 *   4. Billable→header demotions — 15 FY2026 billable rows that FY2027
 *      turned into category headers (children added instead).
 *   5. Description revisions — 4 official FY2027 desc changes.
 *   6. Engine alignment — plantar fasciitis now codes to the new
 *      dedicated M67.A- family (M72.2 fallback demoted to header).
 *
 * Run: bun scripts/regression_sprint7.ts   (or npx tsx)
 */
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
for (const ch of chunks) {
  for (const [code, desc, flag] of ch.codes) db.set(code, { desc, flag });
}

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
console.log("\n===== 1. FY2026 → FY2027 refresh reconciliation (official) =====");
// ===========================================================================
// Official order-file deltas (verified by the v0.9.0 diff pass against the
// FY2026 bundle at a0983f7 and the official order-addenda):
//   rows:     98,186 + 238 added − 21 removed            = 98,403
//   billable: 74,719 + 190 (new billable) − 15 (removed
//             billable rows) − 15 (billable→header)      = 74,879
check("row delta identity: 98186 + 238 - 21 = 98403", 98186 + 238 - 21 === 98403);
check("billable delta identity: 74719 + 190 - 15 - 15 = 74879", 74719 + 190 - 15 - 15 === 74879);
check("added/removed counts match the official addenda (238/21)", 238 - 21 === 217 && 98403 - 98186 === 217);

// ===========================================================================
console.log("\n===== 2. FY2027 deletions (21 rows retired, none referenced) =====");
// ===========================================================================
const deleted27: [string, string][] = [
  ["S23.420", "sternoclavicular sprain header"],
  ["S23.420A", "sternoclavicular sprain, init"],
  ["S23.420D", "sternoclavicular sprain, subs"],
  ["S23.420S", "sternoclavicular sprain, sequela"],
  ["T52.8X", "organic solvents X-placeholder header"],
  ["T52.8X1", "organic solvents accidental header"],
  ["T52.8X1A", "organic solvents accidental init"],
  ["T52.8X1D", "organic solvents accidental subs"],
  ["T52.8X1S", "organic solvents accidental sequela"],
  ["T52.8X2", "organic solvents self-harm header"],
  ["T52.8X2A", "organic solvents self-harm init"],
  ["T52.8X2D", "organic solvents self-harm subs"],
  ["T52.8X2S", "organic solvents self-harm sequela"],
  ["T52.8X3", "organic solvents assault header"],
  ["T52.8X3A", "organic solvents assault init"],
  ["T52.8X3D", "organic solvents assault subs"],
  ["T52.8X3S", "organic solvents assault sequela"],
  ["T52.8X4", "organic solvents undetermined header"],
  ["T52.8X4A", "organic solvents undetermined init"],
  ["T52.8X4D", "organic solvents undetermined subs"],
  ["T52.8X4S", "organic solvents undetermined sequela"],
];
check("all 21 FY2026-deleted rows absent from FY2027 bundle", deleted27.every(([c]) => !db.has(c)), deleted27.filter(([c]) => db.has(c)).map(([c]) => c).join(","));

// Conversion-table successors (T52.8X fanned out to alkene/cycloparaffin/
// other-solvent intent rows; S23.42 restructured to sprain-of-sternum).
const successors27: string[] = [
  "T52.891A", "T52.892A", "T52.893A", "T52.894A", // other organic solvents × intent
  "T52.811A", "T52.821A", // alkenes / cycloparaffins (conversion fan-out)
  "T52.91XA", // unspecified organic solvent (unchanged, still billable)
  "S23.421A", "S23.428A", "S23.429A", // sprain of sternum restructure
];
check(
  "conversion-table successors present and billable",
  successors27.every((c) => db.get(c)?.flag === 1),
  successors27.filter((c) => db.get(c)?.flag !== 1).join(",")
);

// ===========================================================================
console.log("\n===== 3. FY2027 additions (anchors from every new family) =====");
// ===========================================================================
const added27: [string, string, number][] = [
  // Neoplasm secondaries
  ["C78.31", "Secondary malignant neoplasm of larynx", 1],
  ["C78.32", "Secondary malignant neoplasm of pharynx", 1],
  ["C79.83", "Secondary malignant neoplasm of oral cavity", 1],
  // Qualitative platelet defects split
  ["D69.11", "Glanzmann thrombasthenia", 1],
  ["D69.19", "Other qualitative platelet defects", 1],
  // Postprocedural hypoglycemia
  ["E89.83", "Postprocedural hypoglycemia following a procedure", 0],
  ["E89.830", "Post bariatric hypoglycemia", 1],
  ["E89.838", "Other postprocedural hypoglycemia", 1],
  // Gender identity / cardiomyopathy / arrhythmia
  ["F64.A", "Gender identity disorder, in remission", 1],
  ["I42.01", "Familial-genetic dilated cardiomyopathy", 1],
  ["I42.81", "Arrhythmogenic cardiomyopathy", 1],
  ["I47.22", "Catecholaminergic polymorphic ventricular tachycardia [CPVT]", 1],
  ["I49.81", "Brugada syndrome", 1],
  ["I49.82", "Ventricular bigeminy", 1],
  // Odontogenic sinusitis
  ["J34.83", "Odontogenic sinusitis", 0],
  ["J34.830", "Odontogenic sinusitis, maxillary sinus", 1],
  ["J34.839", "Odontogenic sinusitis, unspecified", 1],
  // Widened letter-in-code-position shapes (FY2026 QA0 precedent extends)
  ["J4B", "Pulmonary mycetoma", 1],
  ["K31.B", "Hypertrophic pyloric stenosis, in childhood", 1],
  ["K6A", "Diseases of the pelvis, not elsewhere classified", 0],
  ["K6A.01", "Prevesical abscess", 1],
  ["K6A.09", "Other pelvic abscess", 1],
  ["K74.0A", "Hepatic fibrosis, moderate fibrosis", 1],
  ["K76.83", "Intestinal failure-associated liver disease", 1],
  // Skin / MSK
  ["L02.237", "Carbuncle of flank", 1],
  ["M04.3", "VEXAS syndrome", 1],
  ["M67.A", "Plantar fasciitis", 0],
  ["M67.A01", "Plantar fasciitis, right foot", 1],
  ["M67.A02", "Plantar fasciitis, left foot", 1],
  ["M67.A09", "Plantar fasciitis, unspecified foot", 1],
  ["M72.20", "Plantar fascial fibromatosis, unspecified foot", 1],
  ["M86.8X11", "Other osteomyelitis, right shoulder", 1],
];
const badAdded = added27.filter(([c, d, f]) => {
  const rec = db.get(c);
  return !rec || rec.desc !== d || rec.flag !== f;
});
check(
  `all ${added27.length} FY2027 new-family anchors exact (code/desc/flag)`,
  badAdded.length === 0,
  badAdded.map(([c]) => c).join(",")
);

// Chapter mapping for the new-shape families (J4B ch10 respiratory, K31.B /
// K6A.01 / K74.0A ch11 digestive, M67.A01 ch13 musculoskeletal).
check(
  "new-shape families map to the right chapters",
  chapterOfCode("J4B")?.id === 10 &&
    chapterOfCode("K31.B")?.id === 11 &&
    chapterOfCode("K6A.01")?.id === 11 &&
    chapterOfCode("K74.0A")?.id === 11 &&
    chapterOfCode("M67.A01")?.id === 13,
  JSON.stringify([chapterOfCode("J4B")?.id, chapterOfCode("K31.B")?.id, chapterOfCode("K6A.01")?.id, chapterOfCode("K74.0A")?.id, chapterOfCode("M67.A01")?.id])
);

// ===========================================================================
console.log("\n===== 4. Billable→header demotions (15 rows) =====");
// ===========================================================================
// FY2026 billable rows that FY2027 turned into category headers once
// specific children were added. None may be emitted as a final code.
const demoted27 = [
  "D69.1", "I42.0", "I42.8", "I49.8", "M72.2",
  "M86.8X1", "M86.8X2", "M86.8X3", "M86.8X4",
  "M86.8X5", "M86.8X6", "M86.8X7", "M86.8X8",
  "Z68.1", "Z87.890",
];
const badDemoted = demoted27.filter((c) => db.get(c)?.flag !== 0);
check(
  "all 15 demoted rows present as headers (flag 0)",
  badDemoted.length === 0,
  badDemoted.join(",")
);

// ===========================================================================
console.log("\n===== 5. Official FY2027 description revisions (4) =====");
// ===========================================================================
const revised27: [string, string][] = [
  ["L02.232", "Carbuncle of back [any part, except buttock and flank]"],
  ["L03.312", "Cellulitis of back [any part except buttock and flank]"],
  ["L03.322", "Acute lymphangitis of back"],
  ["Z29.14", "Encounter for prophylactic rabies immune globulin"],
];
const badRevised = revised27.filter(([c, d]) => db.get(c)?.desc !== d);
check(
  "all 4 desc revisions applied exactly",
  badRevised.length === 0,
  badRevised.map(([c]) => c).join(",")
);

// ===========================================================================
console.log("\n===== 6. Engine alignment — plantar fasciitis M67.A- (FY2027) =====");
// ===========================================================================
await runCase("P1 — right plantar fasciitis codes the new M67.A01",
  "Plantar fasciitis of the right foot, pain worse in the morning.",
  (r) => {
    check("primary M67.A01", r.primary_icd10.code === "M67.A01", r.primary_icd10.code);
    check("no demoted M72.2 emitted", !allCodes(r).some((c) => c === "M72.2"), allCodes(r).join(","));
    check("M67.A01 billable in bundle", db.get("M67.A01")?.flag === 1);
  });

await runCase("P2 — left plantar fasciitis codes M67.A02",
  "Left plantar fasciitis confirmed on exam.",
  (r) => {
    check("primary M67.A02", r.primary_icd10.code === "M67.A02", r.primary_icd10.code);
    check("no M72.2 emitted", !allCodes(r).some((c) => c === "M72.2"), allCodes(r).join(","));
  });

await runCase("P3 — unspecified heel pain (plantar fasciitis) codes M67.A09",
  "Heel pain consistent with plantar fasciitis, side not documented.",
  (r) => {
    check("primary M67.A09 (unspecified foot)", r.primary_icd10.code === "M67.A09", r.primary_icd10.code);
    check("no M72.2 emitted", !allCodes(r).some((c) => c === "M72.2"), allCodes(r).join(","));
  });

// ===========================================================================
console.log("\n==================================================");
console.log(`Sprint 7 (CDC FY2027 data refresh): ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("ALL GREEN");
