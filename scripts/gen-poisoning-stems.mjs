/**
 * Generate src/lib/icd/poisoning-stems.ts from the bundled CDC/NCHS extract.
 *
 * The validator's POISONING_PLACEHOLDER_X check flags T36-T50 codes that put
 * two digits at positions 5-6 (e.g. T39.12A instead of T39.1X1A). That shape
 * heuristic is WRONG for the official families whose substance subdivision
 * itself occupies the 5th character — FY2024+ restructures like T40.41-
 * (synthetic narcotics), T40.42- (tramadol), T43.21-, T50.90- (unspecified
 * drugs) — where codes such as T40.411A / T50.901A are the OFFICIAL shapes.
 *
 * This script walks every T36-T50 row of the bundled extract whose code has
 * digits at positions 5-6 and records the 5-character stem (category + 5th
 * character, e.g. "T40.41", "T50.90"). The validator skips the placeholder
 * advisory for codes whose 5-char prefix is in that set.
 *
 * Re-run at every fiscal-year data refresh (after fetch-icd10cm):
 *   node scripts/gen-poisoning-stems.mjs
 *
 * Output is deterministic (sorted stems, no timestamp) so the diff at each
 * FY refresh contains exactly the stem additions/deletions.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "public", "icd10cm");
const chunkFiles = readdirSync(dir)
  .filter((f) => /^chunk-\d+\.json$/.test(f))
  .sort();

if (chunkFiles.length === 0) {
  console.error("no chunk files found in public/icd10cm — run fetch-icd10cm first");
  process.exit(1);
}

const rows = [];
for (const f of chunkFiles) {
  rows.push(...JSON.parse(readFileSync(join(dir, f), "utf8")).codes);
}

// T36-T50 poisoning codes with DIGITS at positions 5-6 (the shape the
// placeholder heuristic would flag). Record the 6-char prefix "Txx.xD"
// (category + 5th character), e.g. T50.901A -> "T50.90".
const STEM_RE = /^T(?:3[6-9]|4[0-9]|50)\.\d{2}/;
const stems = new Set();
for (const [code] of rows) {
  if (STEM_RE.test(code)) stems.add(code.slice(0, 6));
}

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const fy = manifest.fiscalYear ?? "unknown";
const sorted = [...stems].sort();

const out = `/**
 * OFFICIAL T36-T50 poisoning stems whose 5th character is a REAL subdivision
 * digit (not a placeholder X). GENERATED from the bundled CDC/NCHS FY${fy}
 * extract (public/icd10cm) — do not hand-edit; regenerate at each fiscal
 * year refresh with:
 *
 *   node scripts/gen-poisoning-stems.mjs
 *
 * Purpose (v0.9.1): the POISONING_PLACEHOLDER_X format check flags codes
 * shaped "Txx.dd" (two digits at positions 5-6) as missing the placeholder
 * X. That is correct for typos (T39.12A should be T39.1X1A) but WRONG for
 * the official families whose substance subdivision occupies the 5th
 * character — FY2024+ restructures such as T40.41- (synthetic narcotics),
 * T40.42- (tramadol), T43.21- (SSRI + intent), T50.90- (unspecified
 * drugs) — where T40.411A / T50.901A / T43.211A are the official shapes.
 * The validator consults this set and skips the advisory when the code's
 * 5-character prefix is an official digit stem.
 *
 * Regeneration identity guarded by regression sprint8: the embedded set
 * must always equal the set recomputed from the bundled extract.
 */

export const POISONING_STEMS_SOURCE_FY = ${fy};

export const OFFICIAL_POISONING_DIGIT_STEMS: ReadonlySet<string> = new Set([
${sorted.map((s) => `  "${s}",`).join("\n")}
]);
`;

const target = join(process.cwd(), "src", "lib", "icd", "poisoning-stems.ts");
writeFileSync(target, out);
console.log(`wrote ${target}: ${sorted.length} official digit stems (FY${fy})`);
console.log(sorted.join(" "));
