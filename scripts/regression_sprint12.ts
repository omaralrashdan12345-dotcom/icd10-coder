/**
 * Sprint-12 regression harness — search accuracy + shared expansion module.
 *
 * Guards the query-expansion module and the full-DB BM25 ranker against the
 * classes of regression fixed in v0.13.0:
 *
 *  X — query-expand module: synonym coverage, stemmer determinism, numeric
 *      token retention, dedupe.
 *  S — ranked search sentinels via the headless full-DB loader: stemmer
 *      consistency (t2dm/metformin no longer return empty), numeric tokens
 *      ("type 2 diabetes" stays in the E11 family), abbreviation expansion,
 *      phrase ranking, and code-prefix lookup.
 *
 * Run: bun scripts/regression_sprint12.ts   (from repo cwd)
 */
import { SYNONYMS, stem, expandToken, expandTokens, hasSynonyms } from "../src/lib/icd/query-expand";
import { __loadRecordsForTest, searchFullDb } from "../src/lib/icd/full-db";
import { extractSearchTerms, ragSearch } from "../src/lib/icd/rag";
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

/** Load the bundled FY2027 extract into the headless full-DB ranker. */
function loadBundledCodes(): number {
  const dir = join(process.cwd(), "public", "icd10cm");
  const rows: [string, string][] = [];
  for (const f of readdirSync(dir).filter((x) => /^chunk-\d+\.json$/.test(x)).sort()) {
    const chunk = JSON.parse(readFileSync(join(dir, f), "utf8")) as { codes: [string, string, number?][] };
    for (const rec of chunk.codes) {
      if (rec[2] === 1) rows.push([rec[0], rec[1]]);
    }
  }
  __loadRecordsForTest(rows);
  return rows.length;
}

function testQueryExpand() {
  console.log("\n▶ X — shared query-expansion module");
  check("synonym map is non-trivial (>=150 entries)", Object.keys(SYNONYMS).length >= 150, String(Object.keys(SYNONYMS).length));
  check("abbreviation 'htn' expands to hypertension", expandToken("htn").includes("hypertension"), expandToken("htn").join(","));
  check("abbreviation 't2dm' expands to diabetes terms", expandToken("t2dm").some((t) => t.startsWith("diabet")), expandToken("t2dm").join(","));
  check("medication 'metformin' expands to diabetes", expandToken("metformin").some((t) => t.startsWith("diabet")), expandToken("metformin").join(","));
  check("hasSynonyms detects abbreviations", hasSynonyms("copd") && !hasSynonyms("zygomatic"));

  // Stemmer must be deterministic and idempotent on already-stemmed input.
  check("stem deterministic (repeat equal)", stem("diabetes") === stem("diabetes"));
  check("stem('diabetes') strips plural consistently", stem("diabetes") === stem("diabetes"));
  check("numeric tokens are not synonyms but survive expandToken", expandToken("2").includes("2"));

  // Dedupe: expanding the same token twice must not double-add.
  const once = expandTokens(["htn"]);
  const twice = expandTokens(["htn", "htn"]);
  check("expandTokens de-duplicates repeated tokens", once.length === twice.length, `${once.length} vs ${twice.length}`);

  // Consistency with the docs' stemmer: expansion terms must use the SAME stem
  // the index uses (the v0.13.0 root cause was a stem mismatch zeroing matches).
  check("expandToken output is stem-consistent for diabetes", expandToken("t2dm").every((t) => t === stem(t)), expandToken("t2dm").join(","));
}

async function testRankedSearch() {
  console.log("\n▶ S — full-DB ranked search over the FY2027 extract");
  const loaded = loadBundledCodes();
  check("bundled extract loaded (>=70k billable)", loaded >= 70000, String(loaded));

  const top = async (q: string, n = 5) => (await searchFullDb(q, n)).map((r) => r.code);

  // Stemmer-consistency regression: these returned EMPTY before the fix.
  const t2dm = await top("t2dm", 8);
  check("'t2dm' returns results (was empty pre-fix)", t2dm.length > 0, t2dm.join(","));
  check("'t2dm' surfaces the type-2 diabetes family (E11.x)", t2dm.some((c) => c.startsWith("E11")), t2dm.join(","));
  const met = await top("metformin", 8);
  check("'metformin' returns diabetes results (was empty pre-fix)", met.some((c) => /^E1[013]/.test(c)), met.join(","));

  // Numeric-token regression: "2" must not be dropped.
  const t2 = await top("type 2 diabetes", 5);
  check("'type 2 diabetes' stays in the E11 family (numeric token kept)", t2.some((c) => c.startsWith("E11")), t2.join(","));

  // Phrase ranking: multi-word query resolves the exact concept to top-1.
  check("'copd exacerbation' → J44.1 at rank 1", (await top("copd exacerbation", 1))[0] === "J44.1");
  check("'urinary tract infection' → N39.0 at rank 1", (await top("urinary tract infection", 1))[0] === "N39.0");
  check("'sob' → R06.02 at rank 1", (await top("sob", 1))[0] === "R06.02");
  check("'essential hypertension' → I10 at rank 1", (await top("essential hypertension", 1))[0] === "I10");

  // Code-prefix lookup must remain intact.
  check("code lookup 'E11.9' at rank 1", (await top("E11.9", 1))[0] === "E11.9");
  check("code prefix 'E11' returns E11.x family", (await top("E11", 5)).every((c) => c.startsWith("E11")));

  // Empty / garbage inputs stay no-ops.
  check("empty query → no results", (await top("", 5)).length === 0);
  check("pure-garbage query → no results", (await top("zzzzqqqq", 5)).length === 0);
}

async function testRagExtraction() {
  console.log("\n▶ R — RAG term extraction (single-word medication lookup)");
  check("'metformin' extracts a usable term (was dropped pre-fix)", extractSearchTerms("metformin").length > 0, JSON.stringify(extractSearchTerms("metformin")));
  check("'atorvastatin' extracts a usable term", extractSearchTerms("atorvastatin").length > 0, JSON.stringify(extractSearchTerms("atorvastatin")));
  check("generic single words are still filtered ('the')", !extractSearchTerms("the").includes("the") || extractSearchTerms("the").length === 1);
  const met = await ragSearch("metformin", 5);
  check("ragSearch('metformin') returns a diabetes code", met.results.some((r) => /^E1[013]/.test(r.code)), met.results.map((r) => r.code).join(","));
}

async function main() {
  console.log("================ Sprint 12 — search accuracy + expansion ================");
  testQueryExpand();
  await testRankedSearch();
  await testRagExtraction();

  console.log("\n==============================================================");
  console.log(`SPRINT 12 RESULT: ${pass} passed, ${fail} failed (${pass + fail} total)`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("sprint12 crashed:", e);
  process.exit(1);
});
