// scripts/expand_snomed_subset.mjs
// Expands the embedded SNOMED CT subset with a curated high-yield pack,
// following the original build methodology recorded in subset meta:
//   1. term -> authoritative concept id/pt/fsn (public SNOMED browser API, fallback EBI OLS4)
//   2. curated ICD-10-CM target validated against NLM Clinical Tables (icd10cm v3, free, no key)
//   3. merge into src/data/snomed-subset.json (dedup by concept id) + update meta
// Run: node scripts/expand_snomed_subset.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SUBSET = new URL("../src/data/snomed-subset.json", import.meta.url);
const SNOMED_DESC = "https://browser.ihtsdotools.org/snowstorm/snomed-ct/browser/MAIN/descriptions";
const OLS4 = "https://www.ebi.ac.uk/ols4/api/search";
const NLM_ICD = "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search";

// Curated high-yield pack (disorder/finding focus; external causes stay with the ICD engine).
// icd = the expected ICD-10-CM stem; the script validates code+name against NLM and keeps what it proves.
const PACK = [
  { term: "asthma", synonyms: ["bronchial asthma", "reactive airway disease"], icd: "J45.909" },
  { term: "cerebral infarction", synonyms: ["stroke", "cvd", "brain infarct"], icd: "I63.9" },
  { term: "pneumonia", synonyms: ["bronchopneumonia", "lung infection"], icd: "J18.9" },
  { term: "heart failure", synonyms: ["chf", "congestive heart failure"], icd: "I50.9" },
  { term: "atrial fibrillation", synonyms: ["afib", "af"], icd: "I48.91" },
  { term: "hypertensive disorder", synonyms: ["hypertension", "htn", "high blood pressure"], icd: "I10" },
  { term: "urinary tract infection", synonyms: ["uti", "cystitis"], icd: "N39.0" },
  { term: "acute kidney failure", synonyms: ["aki", "acute renal failure", "ar"], icd: "N17.9" },
  { term: "pulmonary embolism", synonyms: ["pe", "pulmonary thromboembolism"], icd: "I26.99" },
  { term: "gastrointestinal hemorrhage", synonyms: ["gi bleed", "gi bleeding"], icd: "K92.2" },
  { term: "acute appendicitis", synonyms: ["appendicitis"], icd: "K35.80" },
  { term: "cholecystitis", synonyms: ["gallbladder infection"], icd: "K81.9" },
  { term: "acute pancreatitis", synonyms: ["pancreatitis"], icd: "K85.9" },
  { term: "cellulitis", synonyms: ["skin infection"], icd: "L03.90" },
  { term: "headache", synonyms: ["cephalalgia", "h/a"], icd: "R51.9" },
  { term: "fever", synonyms: ["pyrexia", "febrile"], icd: "R50.9" },
  { term: "chest pain", synonyms: ["cp"], icd: "R07.9" },
  { term: "dyspnea", synonyms: ["shortness of breath", "sob"], icd: "R06.02" },
  { term: "vomiting", synonyms: ["emesis", "nausea and vomiting"], icd: "R11.2" },
  { term: "hypoglycemia", synonyms: ["low blood sugar"], icd: "E16.2" },
  { term: "otitis media", synonyms: ["middle ear infection"], icd: "H66.90" },
  { term: "pharyngitis", synonyms: ["sore throat"], icd: "J02.9" },
  { term: "influenza", synonyms: ["flu"], icd: "J11.1" },
  { term: "COVID-19", synonyms: ["covid", "coronavirus disease 19"], icd: "U07.1" },
  { term: "rash", synonyms: ["eruption", "skin rash"], tag: "finding", icd: "R21" },
  { term: "abdominal pain", synonyms: ["stomach pain", "abd pain"], icd: "R10.9" },
  { term: "low back pain", synonyms: ["lbp", "lumbar pain"], icd: "M54.50" },
  { term: "syncope", synonyms: ["fainting", "passed out"], icd: "R55" },
  { term: "seizure", synonyms: ["convulsion", "fit"], icd: "R56.9" },
  { term: "hypokalemia", synonyms: ["low potassium"], icd: "E87.6" },
  { term: "hyperkalemia", synonyms: ["high potassium"], icd: "E87.5" },
  { term: "dehydration", synonyms: ["volume depletion"], icd: "E86.0" },
  { term: "ankle sprain", match: ["sprain of ankle", "sprain of ankle joint"], synonyms: ["sprained ankle"], icd: "S93.409A" },
  { term: "epigastric pain", synonyms: ["epigastric discomfort", "upper abdominal pain"], tag: "finding", icd: "R10.13" },
  { term: "colicky pain", match: ["colic", "intestinal colic"], synonyms: ["colicky abdominal pain", "crampy abdominal pain"], tag: "finding", icd: "R10.84" },
  { term: "nausea", synonyms: ["feeling sick", "queasy"], tag: "finding", icd: "R11.0" },
  { term: "dysarthria", match: ["dysarthria"], synonyms: ["slurred speech"], tag: "finding", icd: "R47.1" },
  { term: "hemiparesis", match: ["hemiparesis"], synonyms: ["one sided weakness", "right sided weakness"], tag: "finding", icd: "G81.9" },
];

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

/** Resolve term -> {id, pt, fsn} via public SNOMED browser, fallback EBI OLS4. */
async function resolveConcept(term) {
  try {
    const hits = await fetchJson(`${SNOMED_DESC}?term=${encodeURIComponent(term)}&active=true&limit=8`);
    for (const d of hits) {
      const c = d.concept ?? d;
      const id = String(c.conceptId ?? c.concept?.conceptId ?? "");
      if (!/^\d{6,18}$/.test(id)) continue;
      const pt = c.pt?.term ?? c.defaultTerm ?? d.term ?? term;
      const fsn = c.fsn?.term ?? c.fsn ?? null;
      return { id, pt: typeof pt === "string" ? pt : term, fsn: typeof fsn === "string" ? fsn : null };
    }
  } catch (e) {
    console.log(`  snowstorm miss for "${term}" (${e.message}), trying OLS4`);
  }
  const o = await fetchJson(`${OLS4}?q=${encodeURIComponent(term)}&ontology=snomed&size=10`);
  const norm = (s) => s.toLowerCase().replace(/\s*\(disorder\)\s*$/, "").replace(/\s*\(finding\)\s*$/, "").trim();
  const want = norm(term);
  for (const hit of o.response?.docs ?? []) {
    const label = String(hit.label ?? "");
    // STRICT: accept only the generic concept itself - never subtypes ("due to", "associated with")
    if (norm(label) !== want) continue;
    const id = String(hit.short_form ?? "").replace(/^SNOMEDCT:/, "").replace(/^SNOMED_/, "");
    if (/^\d{6,18}$/.test(id)) return { id, pt: label, fsn: hit.description ?? label };
  }
  return null;
}

/** Validate curated ICD-10-CM stem against NLM Clinical Tables (prove the code itself, then by term). */
async function validateIcd(icdStem, term) {
  const stem = icdStem.replace(/\./g, "");
  const pick = (rows) => {
    for (const [code, name] of rows) {
      if (code.replace(/\./g, "").startsWith(stem)) return { code: code.toUpperCase(), name };
    }
    return null;
  };
  try {
    const direct = await fetchJson(`${NLM_ICD}?terms=${encodeURIComponent(stem)}&maxList=5`);
    const byStem = pick(direct[3] ?? []);
    if (byStem) return byStem;
    const byTerm = await fetchJson(`${NLM_ICD}?terms=${encodeURIComponent(term)}&maxList=15`);
    return pick(byTerm[3] ?? []);
  } catch (e) {
    console.log(`  NLM validate failed for ${icdStem}: ${e.message}`);
  }
  return null;
}

const subset = JSON.parse(readFileSync(SUBSET, "utf8"));
// Rollback any previous pack additions so re-runs start from the clean seed (idempotent)
subset.concepts = subset.concepts.filter((c) => !String(c.resolvedBy ?? "").includes("curated-pack-v2"));
const existing = new Set(subset.concepts.map((c) => c.id));
const added = [];
const skipped = [];

for (const item of PACK) {
  const matchNames = [item.term, ...(item.match ?? [])];
  if (matchNames.some((m) => subset.concepts.some((c) => c.pt.toLowerCase() === m.toLowerCase()))) {
    skipped.push(`${item.term} (pt already in subset)`);
    continue;
  }
  let concept = null;
  for (const name of matchNames) {
    concept = await resolveConcept(name);
    if (concept) break;
  }
  if (!concept || existing.has(concept.id)) {
    skipped.push(`${item.term} (${concept ? `dup id ${concept.id}` : "no concept found"})`);
    continue;
  }
  const map = await validateIcd(item.icd, item.term);
  const entry = {
    id: concept.id,
    pt: concept.pt,
    fsn: typeof concept.fsn === "string" ? concept.fsn : concept.pt,
    synonyms: item.synonyms,
    tag: item.tag ?? "disorder",
    role: item.tag === "finding" ? "secondary" : "primary",
    icd10cm: map ? [map] : [],
    resolvedBy: map ? "curated-pack-v2 (snowstorm/ols4 + nlm-validated)" : "curated-pack-v2 (snowstorm/ols4, no icd map proven)",
  };
  subset.concepts.push(entry);
  existing.add(concept.id);
  added.push(`${item.term} -> ${concept.id} ${concept.pt}${map ? ` -> ${map.code} ${map.name}` : " (no map)"}`);
}

subset.meta.conceptCount = subset.concepts.length;
subset.meta.withIcdMap = subset.concepts.filter((c) => c.icd10cm?.length > 0).length;
subset.meta.builtAt = new Date().toISOString();
subset.meta.what = "Embedded SNOMED CT subset for offline coding (curated seed + v2 high-yield expansion pack, server-validated)";

writeFileSync(SUBSET, JSON.stringify(subset, null, 2) + "\n", "utf8");

console.log(`\n=== EXPANSION REPORT ===`);
console.log(`added:   ${added.length}  (subset now ${subset.meta.conceptCount} concepts, ${subset.meta.withIcdMap} with ICD map)`);
console.log(`skipped: ${skipped.length}`);
for (const a of added) console.log("  + " + a);
for (const s of skipped) console.log("  - " + s);
