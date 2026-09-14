/**
 * Sprint-10 regression harness — v0.11.0 SNOMED CT coder add-on.
 *
 * Guards the embedded SNOMED CT terminology layer (integration add-on,
 * DOC · SNOMED-ICD-01) against data rot and wiring regressions. Every
 * identifier the app can ever emit must trace to this validated artifact,
 * so the artifact itself is guarded end-to-end:
 *
 *  D — Subset integrity: meta counts (273 / 226 / 0), unique concept IDs,
 *      required fields, semantic-tag and role enums, provenance (resolvedBy),
 *      license field kept intact (SNOMED CT is licensed material).
 *  B — Bundle cross-check (the strong gate): all 226 ICD-10-CM map targets
 *      EXIST and are BILLABLE in the canonical bundled FY2027 extract —
 *      stronger than the build-time NLM check, anchored to our
 *      addenda-reconciled frozen copy. Name split 206 exact / 20 NLM-long-
 *      title vs CDC-short-title variants (both official) is pinned so a
 *      future refresh that silently changes either side trips here.
 *      FY2027 sentinels re-anchored: G35 header (0), G35.C2 billable (1),
 *      M81.8 billable, M81.80 absent; curated map sentinels
 *      10001005→A41.9, 44054006→E11.9, 42343007→I50.9.
 *  M — Offline matcher determinism: BM25-flavoured ranker must keep
 *      resolving the sentinel queries to the same concept IDs via the same
 *      fields (PT, synonym, prefix tolerance), with bounded confidence and
 *      byte-identical repeat runs.
 *  R — Reverse lookup: ICD-10-CM → SNOMED both dotted and dotless forms,
 *      empty-input no-op, limit clamp, allIcdTargets sortedness.
 *  G — Gate + server wiring tripwires: CONF_MIN 0.50 / GAP_MIN 0.12 stay
 *      the disambiguation economics; pipeline (LLM side) is imported only
 *      by its API route, never client-side; matcher stays dependency-free;
 *      route guards (runtime, 8000-char cap, k clamp).
 *  A — Attribution: visible bilingual SNOMED CT license attribution in the
 *      app footer + intact license provenance in the subset metadata +
 *      build script (refset 60206000) shipped for regeneration.
 *
 * Run: bun scripts/regression_sprint10.ts   (from repo cwd)
 */
import { search, reverseLookup, allIcdTargets, subset } from "../src/lib/snomed/matcher";
import { translations } from "../src/lib/i18n/translations";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

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

const ROOT = process.cwd();
const readRepo = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

async function main() {
  /* ================= D — subset integrity ================= */
  console.log("================ D — subset artifact integrity ================");

  {
    console.log("\n▶ D1 — meta counts self-consistent");
    check("meta.conceptCount == concepts.length == 273", subset.meta.conceptCount === 273 && subset.concepts.length === 273, `${subset.meta.conceptCount}/${subset.concepts.length}`);
    const withMap = subset.concepts.filter((c) => c.icd10cm.length > 0).length;
    check("meta.withIcdMap == concepts with >=1 map == 226", subset.meta.withIcdMap === 226 && withMap === 226, String(withMap));
    check("meta.droppedCount == 0 (nothing accepted without verification)", subset.meta.droppedCount === 0, String(subset.meta.droppedCount));
    const ids = subset.concepts.map((c) => c.id);
    check("concept IDs unique (no fallback duplicates)", new Set(ids).size === ids.length, `unique=${new Set(ids).size}/${ids.length}`);
  }

  {
    console.log("\n▶ D2 — required fields + enums");
    const shapeOk = subset.concepts.every(
      (c) =>
        typeof c.id === "string" && c.id.length > 0 &&
        typeof c.pt === "string" && c.pt.length > 0 &&
        Array.isArray(c.synonyms) &&
        typeof c.tag === "string" && c.tag.length > 0 &&
        (c.role === "primary" || c.role === "secondary" || c.role === "supplemental") &&
        Array.isArray(c.icd10cm) &&
        typeof c.resolvedBy === "string" && c.resolvedBy.length > 0
    );
    check("every concept carries id/pt/synonyms/tag/valid role/maps/provenance", shapeOk);
    const TARGET_TAGS = ["body structure", "disorder", "finding", "morphologic abnormality", "observable entity", "organism", "procedure", "product", "situation"];
    const tags = [...new Set(subset.concepts.map((c) => c.tag))].sort();
    check("semantic tag set pinned (9 tags, international release)", JSON.stringify(tags) === JSON.stringify(TARGET_TAGS), tags.join(","));
    const mapShapeOk = subset.concepts.every((c) => c.icd10cm.every((t) => /^[A-Z][0-9A-Z]/.test(t.code) && typeof t.name === "string" && t.name.length > 0));
    check("every ICD-10-CM target has a plausible code + official name", mapShapeOk);
  }

  {
    console.log("\n▶ D3 — license provenance kept intact");
    check("meta.license declares SNOMED CT as licensed material", /licensed material/.test(subset.meta.license) && /SNOMED CT/.test(subset.meta.license), subset.meta.license.slice(0, 60));
    check("meta.mapRefsetProduction references official refset 60206000", subset.meta.mapRefsetProduction.includes("60206000"));
    check("meta.snomedEdition names the International Edition", /International Edition/.test(subset.meta.snomedEdition));
    check("meta.icdTarget names ICD-10-CM validation source", subset.meta.icdTarget.includes("ICD-10-CM"));
    check("meta.builtAt is a parseable timestamp", !Number.isNaN(Date.parse(subset.meta.builtAt)));
  }

  /* ================= B — bundle cross-check ================= */
  console.log("================ B — canonical FY2027 bundle cross-check ================");

  {
    console.log("\n▶ B1 — all map targets exist and are billable in FY2027 extract");
    const dir = join(ROOT, "public", "icd10cm");
    const rows: [string, string, number][] = [];
    for (const f of readdirSync(dir).filter((x) => /^chunk-\d+\.json$/.test(x)).sort()) {
      rows.push(...JSON.parse(readFileSync(join(dir, f), "utf8")).codes);
    }
    const bundle = new Map(rows.map((r) => [r[0], r]));
    check("bundle loaded to FY2027 identity (98,403 rows / 74,879 billable)", rows.length === 98403 && rows.filter((r) => r[2] === 1).length === 74879, `${rows.length}/${rows.filter((r) => r[2] === 1).length}`);

    let exist = 0, billable = 0, nameExact = 0;
    const nameDiffs: string[] = [];
    for (const c of subset.concepts) {
      for (const t of c.icd10cm) {
        const b = bundle.get(t.code);
        if (b) {
          exist++;
          if (b[2] === 1) billable++;
          if (b[1] === t.name) nameExact++;
          else nameDiffs.push(t.code);
        }
      }
    }
    check("226/226 map targets EXIST in the canonical bundle", exist === 226, String(exist));
    check("226/226 map targets are BILLABLE in the canonical bundle", billable === 226, String(billable));
    check("name agreement pinned: 206 exact (CDC short title)", nameExact === 206, String(nameExact));
    check("name variant budget pinned: 20 NLM-long-title diffs", nameDiffs.length === 20, nameDiffs.join(","));
    check("no subset target maps to a header (flag=0) row", billable === exist, `${billable}/${exist}`);

    console.log("\n▶ B2 — FY2027 data-quality sentinels re-anchored");
    check("G35 demoted to header in FY2027 (flag=0)", bundle.get("G35")?.[2] === 0);
    check("G35.C2 billable successor present (flag=1)", bundle.get("G35.C2")?.[2] === 1);
    check("M81.8 billable (M81.80 never existed)", bundle.get("M81.8")?.[2] === 1 && !bundle.has("M81.80"));

    console.log("\n▶ B3 — curated map sentinels (guide §5.3 response shape)");
    const mapOf = (id: string) => subset.concepts.find((c) => c.id === id)?.icd10cm.map((t) => t.code) ?? [];
    check("10001005 Bacterial sepsis → A41.9", mapOf("10001005").includes("A41.9"), mapOf("10001005").join(","));
    check("44054006 Diabetes mellitus type 2 → E11.9", mapOf("44054006").includes("E11.9"), mapOf("44054006").join(","));
    check("42343007 Congestive heart failure → I50.9", mapOf("42343007").includes("I50.9"), mapOf("42343007").join(","));
  }

  /* ================= M — offline matcher determinism ================= */
  console.log("================ M — offline matcher determinism ================");

  {
    console.log("\n▶ M1 — sentinel queries resolve to pinned concepts");
    const top = (q: string) => search(q, 6)[0];
    const t1 = top("bacterial sepsis");
    check("exact PT hit: 'bacterial sepsis' → 10001005 (PT field)", t1?.conceptId === "10001005" && t1.matchedField === "pt", t1 ? `${t1.conceptId}/${t1.matchedField}` : "[]");
    const t2 = top("septicemia");
    check("synonym hit: 'septicemia' → 10001005 (synonym field)", t2?.conceptId === "10001005" && t2.matchedField === "synonym", t2 ? `${t2.conceptId}/${t2.matchedField}` : "[]");
    const t3 = top("type 2 diabetes mellitus");
    check("curated synonym: 'type 2 diabetes mellitus' → 44054006", t3?.conceptId === "44054006", t3?.conceptId ?? "[]");
    const t4 = top("congestive heart failure");
    check("exact PT hit: 'congestive heart failure' → 42343007", t4?.conceptId === "42343007", t4?.conceptId ?? "[]");
    const t5 = top("diabet");
    check("prefix tolerance: 'diabet' still → 44054006", t5?.conceptId === "44054006", t5?.conceptId ?? "[]");
    const t6 = top("hypertension");
    check("curated synonym: 'hypertension' → 38341003 Hypertensive disorder", t6?.conceptId === "38341003", t6?.conceptId ?? "[]");
    check("garbage query resolves to nothing", search("zzzz qqqq", 6).length === 0);
    check("empty query resolves to nothing", search("", 6).length === 0);
  }

  {
    console.log("\n▶ M2 — confidence bounds + determinism");
    const pool = ["sepsis", "fracture", "infection", "pneumonia", "pregnancy", "asthma"].flatMap((q) => search(q, 30));
    check("all confidences within [0.05, 0.99]", pool.every((c) => c.confidence >= 0.05 && c.confidence <= 0.99), `${Math.min(...pool.map((c) => c.confidence))}..${Math.max(...pool.map((c) => c.confidence))}`);
    check("calibration band intact: exact PT phrase lands >= 0.9", search("bacterial sepsis", 1)[0].confidence >= 0.9);
    check("repeat run byte-identical (deterministic ranker)", JSON.stringify(search("fracture", 8)) === JSON.stringify(search("fracture", 8)));
    check("top-k respected", search("infection", 3).length <= 3);
  }

  /* ================= R — reverse lookup ================= */
  console.log("================ R — ICD-10-CM → SNOMED reverse lookup ================");

  {
    console.log("\n▶ R1 — dotted, dotless, empty, limit");
    check("'E11.9' → includes 44054006", reverseLookup("E11.9", 20).some((h) => h.concept.id === "44054006"));
    check("'A41.9' → 10001005 with official target name", reverseLookup("A41.9", 20)[0]?.concept.id === "10001005" && reverseLookup("A41.9", 20)[0]?.target.code === "A41.9");
    check("'J45.909' → 195967001 Asthma", reverseLookup("J45.909", 20)[0]?.concept.id === "195967001");
    check("dotless 'J45909' finds the same concept (normalized prefix pass)", reverseLookup("J45909", 20)[0]?.concept.id === "195967001");
    check("empty code → no hits, no throw", reverseLookup("", 20).length === 0);
    check("limit respected", reverseLookup("E11", 1).length <= 1);
    const at = allIcdTargets();
    check("allIcdTargets covers 226 targets, sorted ascending", at.length === 226 && at.every((x, i) => i === 0 || at[i - 1].code.localeCompare(x.code) <= 0), String(at.length));
  }

  /* ================= G — gate + server wiring tripwires ================= */
  console.log("================ G — disambiguation gate + server wiring ================");

  {
    console.log("\n▶ G1 — pipeline gate economics pinned");
    const pipelineSrc = readRepo("src/lib/snomed/pipeline.ts");
    check("CONF_MIN stays 0.5 (guide §5.1 tuning anchor)", /const CONF_MIN = 0\.5;/.test(pipelineSrc));
    check("GAP_MIN stays 0.12", /const GAP_MIN = 0\.12;/.test(pipelineSrc));
    check("LLM side imports z-ai-web-dev-sdk (server-side only)", pipelineSrc.includes('from \'z-ai-web-dev-sdk\''));
    check("model pinned", /const MODEL = /.test(pipelineSrc));
    check("extraction capped at 12 terms", /\.slice\(0, 12\)/.test(pipelineSrc));
    check("note input capped at 4000 chars for extraction", /text\.slice\(0, 4000\)/.test(pipelineSrc));

    console.log("\n▶ G2 — offline purity + route guards");
    const matcherSrc = readRepo("src/lib/snomed/matcher.ts");
    check("matcher has zero SDK/network imports (offline deterministic)", !matcherSrc.includes("z-ai-web-dev-sdk") && !/fetch\(/.test(matcherSrc));
    for (const r of ["coding", "meta", "reverse", "search"]) {
      const p = join(ROOT, "src", "app", "api", "snomed", r, "route.ts");
      check(`route /api/snomed/${r} exists`, existsSync(p));
    }
    const coding = readRepo("src/app/api/snomed/coding/route.ts");
    check("coding route: nodejs runtime + maxDuration 60", coding.includes("nodejs") && coding.includes("maxDuration = 60"));
    check("coding route: 8000-char cap with 413", coding.includes("8000") && coding.includes("413"));
    check("coding route: empty-text 400 guard", coding.includes("400"));
    const searchRoute = readRepo("src/app/api/snomed/search/route.ts");
    check("search route: k clamped to [1, 30]", searchRoute.includes("Math.min(30") && searchRoute.includes("Math.max(1"));

    console.log("\n▶ G3 — pipeline stays server-side (no client import)");
    let clientImports = 0;
    const scan = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(ts|tsx)$/.test(f)) {
          const s = readFileSync(p, "utf8");
          if (s.includes("snomed/pipeline")) clientImports++;
        }
      }
    };
    scan(join(ROOT, "src", "components"));
    scan(join(ROOT, "src", "hooks"));
    const pageSrc = readRepo("src/app/page.tsx");
    if (pageSrc.includes("snomed/pipeline")) clientImports++;
    check("no client module imports the LLM pipeline", clientImports === 0, `${clientImports} hits`);
  }

  /* ================= A — attribution + regeneration path ================= */
  console.log("================ A — license attribution + regeneration ================");

  {
    console.log("\n▶ A1 — visible bilingual attribution");
    check("en.snomed_attribution present and declares licensed material", /licensed material/.test(translations.en.snomed_attribution) && /SNOMED CT/.test(translations.en.snomed_attribution));
    check("ar.snomed_attribution present (بالعربية)", translations.ar.snomed_attribution.includes("SNOMED CT") && translations.ar.snomed_attribution.includes("مرخ"));
    const pageSrc = readRepo("src/app/page.tsx");
    check("footer renders the attribution (t(\"snomed_attribution\"))", pageSrc.includes('t("snomed_attribution")'));
    check("en/ar locale objects both carry the same key set size", Object.keys(translations.en).length === Object.keys(translations.ar).length);

    console.log("\n▶ A2 — regeneration path shipped");
    const bs = join(ROOT, "scripts", "build_snomed_subset.mjs");
    check("scripts/build_snomed_subset.mjs shipped", existsSync(bs) && statSync(bs).size > 10000);
    check("build script targets official refset 60206000", readRepo("scripts/build_snomed_subset.mjs").includes("60206000"));
  }

  /* ================= summary ================= */
  console.log("\n==============================================================");
  console.log(`SPRINT 10 RESULT: ${pass} passed, ${fail} failed (${pass + fail} total)`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("sprint10 crashed:", e);
  process.exit(1);
});
