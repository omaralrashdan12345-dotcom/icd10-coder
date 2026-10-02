import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SUBSET = "src/data/snomed-subset.json";
const BDIR = join(process.cwd(), "public", "icd10cm");

const subset = JSON.parse(readFileSync(SUBSET, "utf8"));
const rows = [];
for (const f of readdirSync(BDIR).filter((x) => /^chunk-\d+\.json$/.test(x)).sort()) {
  rows.push(...JSON.parse(readFileSync(join(BDIR, f), "utf8")).codes);
}
const bundle = new Map(rows.map((r) => [r[0], r]));

const OFF_DOMAIN_TAGS = new Set(["physical object"]);
const before = { concepts: subset.concepts.length, maps: 0 };
for (const c of subset.concepts) before.maps += c.icd10cm.length;

const droppedConcepts = [];
const strippedMaps = [];
const out = [];
for (const c of subset.concepts) {
  if (OFF_DOMAIN_TAGS.has(c.tag)) { droppedConcepts.push(`${c.id} ${c.pt} [${c.tag}]`); continue; }
  const kept = [];
  for (const t of c.icd10cm) {
    const b = bundle.get(t.code);
    if (!b) { strippedMaps.push(`${c.id} ${c.pt} -> ${t.code} (absent)`); continue; }
    if (b[2] !== 1) { strippedMaps.push(`${c.id} ${c.pt} -> ${t.code} (header/non-billable)`); continue; }
    kept.push({ code: t.code, name: b[1] });
  }
  out.push({ ...c, icd10cm: kept });
}

const withIcdMap = out.filter((c) => c.icd10cm.length > 0).length;
const next = {
  meta: {
    ...subset.meta,
    conceptCount: out.length,
    withIcdMap,
    note: `${subset.meta.note ?? ""} | FY2027 bundle reconciliation: 1 off-domain concept (463796001) + 3 header-target maps stripped; target names normalized to CDC short titles`.trim(),
  },
  concepts: out,
};
writeFileSync(SUBSET, JSON.stringify(next, null, 1) + "\n");

console.log(`concepts ${before.concepts} -> ${out.length} (dropped ${droppedConcepts.length}), withIcdMap=${withIcdMap}`);
console.log(`maps ${before.maps} -> ${out.filter((c) => true).reduce((n, c) => n + c.icd10cm.length, 0)} (stripped ${strippedMaps.length})`);
console.log("dropped concepts:"); droppedConcepts.forEach((d) => console.log("  " + d));
console.log("stripped maps:"); strippedMaps.forEach((d) => console.log("  " + d));
