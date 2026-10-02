import { readFileSync, writeFileSync } from "node:fs";

const OURS = "src/data/snomed-subset.json";
const THEIRS = process.argv[2];
if (!THEIRS) {
  console.error("usage: node scripts/merge_v2_subset.mjs <path-to-v2-snomed-subset.json>");
  process.exit(1);
}

const ours = JSON.parse(readFileSync(OURS, "utf8"));
const theirs = JSON.parse(readFileSync(THEIRS, "utf8"));

const byId = new Map();
const stats = { ours: 0, incoming: 0, added: [], dupsSkipped: 0, malformed: 0 };
const ID_RE = /^\d{5,18}$/;
const ICD_RE = /^[A-Z][0-9][0-9][0-9]?(\.[0-9A-Z]{1,4})?$/;

const normalize = (c) => {
  if (!c || typeof c !== "object") return null;
  const id = String(c.id ?? "").trim();
  const pt = typeof c.pt === "string" ? c.pt.trim() : "";
  if (!ID_RE.test(id) || !pt) return null;
  const out = { ...c, id, pt };
  if (typeof out.fsn === "string") out.fsn = out.fsn.trim() || undefined;
  else if (Array.isArray(out.fsn)) out.fsn = out.fsn.filter((s) => typeof s === "string").join(" ").trim() || undefined;
  else delete out.fsn;
  if (typeof out.synonyms === "string") out.synonyms = out.synonyms.trim() ? [out.synonyms.trim()] : [];
  if (Array.isArray(out.synonyms)) out.synonyms = out.synonyms.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
  else out.synonyms = [];
  if (typeof out.tag !== "string" || !out.tag.trim()) return null;
  if (!["primary", "secondary", "supplemental"].includes(out.role)) out.role = "secondary";
  const rawTargets = Array.isArray(out.icd10cm) ? out.icd10cm : out.icd10cm ? [out.icd10cm] : [];
  out.icd10cm = rawTargets
    .filter((t) => t && typeof t === "object" && ICD_RE.test(String(t.code ?? "").toUpperCase()))
    .map((t) => ({ code: String(t.code).toUpperCase(), name: String(t.name ?? "").trim() }));
  if (typeof out.resolvedBy !== "string" || !out.resolvedBy.trim()) out.resolvedBy = "v2-merge";
  return out;
};

for (const raw of ours.concepts ?? []) {
  const c = normalize(raw);
  if (c) { byId.set(c.id, c); stats.ours++; } else stats.malformed++;
}
for (const raw of theirs.concepts ?? []) {
  stats.incoming++;
  const c = normalize(raw);
  if (!c) { stats.malformed++; continue; }
  if (byId.has(c.id)) { stats.dupsSkipped++; continue; }
  c.resolvedBy = `${c.resolvedBy ?? "v2"}+v2-merge-20261002`;
  byId.set(c.id, c);
  stats.added.push(`${c.id} ${c.pt}`);
}

const concepts = [...byId.values()];
const withIcdMap = concepts.filter((c) => c.icd10cm.length > 0).length;
const merged = {
  meta: {
    ...ours.meta,
    conceptCount: concepts.length,
    withIcdMap,
    mergedFrom: "v2-workspace-export (icd10-coder-full-source.zip)",
    mergedOn: "2026-10-02",
    note: `${ours.meta.note ?? ""} | v1 authoritative on ID collisions; v2 additions shape-validated + OLS4 spot-checked`.trim(),
  },
  concepts,
};
writeFileSync(OURS, JSON.stringify(merged, null, 1) + "\n");

console.log(`final=${concepts.length} (ours=${stats.ours}, added=${stats.added.length}, dups_skipped=${stats.dupsSkipped}, malformed=${stats.malformed})`);
console.log("sample added (for OLS4 spot-check):");
stats.added.slice(0, 10).forEach((a) => console.log(`  ${a}`));
