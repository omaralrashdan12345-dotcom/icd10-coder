/**
 * Medication status Z-codes (Sprint 3, Idea G).
 *
 * Long-term medications and documented drug allergies affect patient care
 * and MUST be reported (ICD-10-CM Official Guidelines I.C.21.c):
 *
 *   - Z79.-  Long term (current) drug therapy — assigned for the drug
 *            classes that most commonly influence treatment decisions:
 *            anticoagulants, antiplatelets/NSAIDs, insulin, oral/injectable
 *            hypoglycemics, systemic & inhaled steroids, long-term
 *            antibiotics, immunosuppressants, bisphosphonates, hormonal
 *            contraceptives.
 *            (Drugs that do not usually affect care — statins, antihypertensives,
 *            SSRIs — intentionally do NOT generate Z79 codes here.)
 *   - Z88.-  Personal history of allergy to a drug (status code, Secondary).
 *   - Z51.81 Encounter for therapeutic drug level monitoring (e.g. INR
 *            checks, tacrolimus / vancomycin / digoxin levels).
 *
 * All codes verified against the bundled FY2026 dataset (public/icd10cm/).
 *
 * Safety guards before a Z79 code fires:
 *   1. negation / stop cues      — "metformin was discontinued last month",
 *      "no longer on warfarin", "given prednisone in the ER" (single dose,
 *      not long-term), "allergic to aspirin" (allergy, NOT long-term use)
 *      do NOT generate long-term-use codes.
 *   2. allergy phrase polarity   — Z88 codes fire only on explicit allergy
 *      phrasing ("allergic to X", "X allergy", "allergy to X").
 */

export type MedicationZKind = "long_term" | "allergy" | "monitoring";

export interface MedicationZFinding {
  code: string;
  description: string;
  label_en: string;
  label_ar: string;
  /** The matched drug/phrase text. */
  drug: string;
  kind: MedicationZKind;
}

interface MedicationZRule {
  id: string;
  label_en: string;
  label_ar: string;
  code: string;
  description: string;
  /** Lowercase drug aliases; multi-word or single-word. */
  drugs: string[];
}

export const MEDICATION_Z_RULES: MedicationZRule[] = [
  {
    id: "anticoagulant",
    label_en: "Long-term anticoagulant use",
    label_ar: "استخدام طويل الأمد لمضادات التخثر",
    code: "Z79.01",
    description: "Long term (current) use of anticoagulants",
    drugs: [
      "warfarin", "coumadin", "jantoven", "rivaroxaban", "xarelto", "apixaban",
      "eliquis", "dabigatran", "pradaxa", "edoxaban", "savaysa", "enoxaparin",
      "lovenox", "heparin", "acenocoumarol", "sintron",
    ],
  },
  {
    id: "antiplatelet",
    label_en: "Long-term antiplatelet use",
    label_ar: "استخدام طويل الأمد لمضادات الصفائح",
    code: "Z79.02",
    description: "Long term (current) use of antithrombotics / antiplatelets",
    drugs: [
      "aspirin", "asa", "plavix", "clopidogrel", "brilinta", "ticagrelor",
      "effient", "prasugrel", "cilostazol", "dipyridamole", "ecosprin",
    ],
  },
  {
    id: "nsaid",
    label_en: "Long-term NSAID use",
    label_ar: "استخدام طويل الأمد لمضادات الالتهاب غير الستيرويدية",
    code: "Z79.1",
    description: "Long term (current) use of non-steroidal anti-inflammatories (NSAID)",
    drugs: [
      "ibuprofen", "advil", "motrin", "naproxen", "aleve", "naprosyn",
      "meloxicam", "mobic", "celecoxib", "celebrex", "diclofenac", "voltaren",
      "indomethacin", "ketoprofen", "ketorolac", "etodolac", "piroxicam",
      "fenoprofen", "nabumetone", "nsaid",
    ],
  },
  {
    id: "insulin",
    label_en: "Long-term insulin use",
    label_ar: "استخدام الإنسولين طويل الأمد",
    code: "Z79.4",
    description: "Long term (current) use of insulin",
    drugs: [
      "insulin", "lantus", "basaglar", "toujeo", "levemir", "humalog",
      "novolog", "apidra", "humulin", "novolin", "tresiba", "fiasp",
    ],
  },
  {
    id: "oral-hypoglycemic",
    label_en: "Long-term oral hypoglycemic use",
    label_ar: "استخدام خافضات سكر الفموية طويل الأمد",
    code: "Z79.84",
    description: "Long term (current) use of oral hypoglycemic drugs",
    drugs: [
      "metformin", "glucophage", "glipizide", "glucotrol", "glyburide",
      "diabeta", "glimepiride", "amaryl", "januvia", "sitagliptin",
      "galvus", "vildagliptin", "jardiance", "empagliflozin", "farxiga",
      "dapagliflozin", "invokana", "canagliflozin", "actos", "pioglitazone",
      "avandia", "rosiglitazone", "repaglinide", "prandin", "nateglinide",
      "starlix", "gliclazide", "acarbose", "precose", "miglitol",
    ],
  },
  {
    id: "injectable-antidiabetic",
    label_en: "Long-term injectable non-insulin antidiabetic use",
    label_ar: "استخدام حقن السكر غير الإنسولينية طويل الأمد",
    code: "Z79.85",
    description: "Long term (current) use of injectable non-insulin antidiabetic drugs",
    drugs: [
      "ozempic", "semaglutide", "wegovy", "trulicity", "dulaglutide",
      "victoza", "liraglutide", "byetta", "exenatide", "bydureon",
      "saxenda", "rybelsus", "mounjaro", "tirzepatide",
    ],
  },
  {
    id: "systemic-steroid",
    label_en: "Long-term systemic steroid use",
    label_ar: "استخدام الكورتيزون الفموي طويل الأمد",
    code: "Z79.52",
    description: "Long term (current) use of systemic steroids",
    drugs: [
      "prednisone", "prednisolone", "deltasone", "methylprednisolone",
      "medrol", "dexamethasone", "decadron", "hydrocortisone", "cortisone",
      "deflazacort", "budesonide oral", "betamethasone",
    ],
  },
  {
    id: "inhaled-steroid",
    label_en: "Long-term inhaled steroid use",
    label_ar: "استخدام بخاخات الكورتيزون طويل الأمد",
    code: "Z79.51",
    description: "Long term (current) use of inhaled steroids",
    drugs: [
      "fluticasone", "flovent", "advair", "symbicort", "budesonide inhaler",
      "pulmicort", "qvar", "beclomethasone inhaler", "asmanex",
      "mometasone inhaler", "breo",
    ],
  },
  {
    id: "long-term-antibiotic",
    label_en: "Long-term antibiotic use",
    label_ar: "استخدام المضادات الحيوية طويل الأمد",
    code: "Z79.2",
    description: "Long term (current) use of antibiotics",
    drugs: [
      "nitrofurantoin", "macrobid", "macrodantin", "doxycycline", "vibramycin",
      "minocycline", "dapsone", "methenamine", "hiprex",
    ],
  },
  {
    id: "immunosuppressive-biologic",
    label_en: "Long-term immunosuppressive biologic use",
    label_ar: "استخدام الأدوية الحيوية المثبطة للمناعة طويل الأمد",
    code: "Z79.620",
    description: "Long term (current) use of immunosuppressive biologic",
    drugs: [
      "humira", "adalimumab", "enbrel", "etanercept", "remicade",
      "infliximab", "simponi", "golimumab", "cimzia", "certolizumab",
      "rituxan", "rituximab", "stelara", "ustekinumab", "cosentyx",
      "secukinumab", "taltz", "ixekizumab", "orencia", "abatacept",
      "xeljanz", "tofacitinib",
    ],
  },
  {
    id: "calcineurin-inhibitor",
    label_en: "Long-term calcineurin inhibitor use",
    label_ar: "استخدام مثبطات الكالسينيورين طويل الأمد",
    code: "Z79.621",
    description: "Long term (current) use of calcineurin inhibitor",
    drugs: ["tacrolimus", "prograf", "cyclosporine", "neoral", "gengraf", "pimecrolimus"],
  },
  {
    id: "antimetabolite",
    label_en: "Long-term antimetabolite / immunomodulator use",
    label_ar: "استخدام مضادات الاستقلاب الطويل الأمد",
    code: "Z79.631",
    description: "Long term (current) use of antimetabolite agent",
    drugs: [
      "methotrexate", "trexall", "azathioprine", "imuran", "mycophenolate",
      "cellcept", "myfortic", "leflunomide", "arava", "6-mercaptopurine",
    ],
  },
  {
    id: "bisphosphonate",
    label_en: "Long-term bisphosphonate use",
    label_ar: "استخدام بيفوسفونات طويل الأمد",
    code: "Z79.83",
    description: "Long term (current) use of bisphosphonates",
    drugs: [
      "alendronate", "fosamax", "risedronate", "actonel", "ibandronate",
      "boniva", "zoledronic acid", "reclast", "etidronate", "didronel",
    ],
  },
  {
    id: "hormonal-contraceptive",
    label_en: "Long-term hormonal contraceptive use",
    label_ar: "استخدام منظمات الحمل الهرمونية",
    code: "Z79.3",
    description: "Long term (current) use of hormonal contraceptives",
    drugs: [
      "birth control", "oral contraceptive", "contraceptive pill",
      "contraceptive implant", "depo-provera", "depo provera", "medroxyprogesterone",
      "nuvaring", "nexplanon", "implanon", "yasmin", "yasminelle", "yaz",
      "microgynon", "contraceptive patch",
    ],
  },
];

interface DrugAllergyRule {
  id: string;
  code: string;
  description: string;
  label_en: string;
  label_ar: string;
  drugs: string[];
}

export const DRUG_ALLERGY_RULES: DrugAllergyRule[] = [
  {
    id: "penicillin-allergy",
    code: "Z88.0",
    description: "Allergy status to penicillin",
    label_en: "Penicillin allergy",
    label_ar: "حساسية البنسلين",
    drugs: ["penicillin", "amoxicillin", "augmentin", "ampicillin", "pen-vee", "veetids"],
  },
  {
    id: "antibiotic-allergy",
    code: "Z88.1",
    description: "Allergy status to other antibiotic agents",
    label_en: "Other antibiotic allergy",
    label_ar: "حساسية مضاد حيوي آخر",
    drugs: [
      "cephalosporin", "keflex", "cephalexin", "cipro", "ciprofloxacin",
      "levaquin", "levofloxacin", "azithromycin", "zithromax", "erythromycin",
      "clindamycin", "cleocin", "tetracycline", "clindamycin", "macrolide", "quinolone",
    ],
  },
  {
    id: "sulfa-allergy",
    code: "Z88.2",
    description: "Allergy status to sulfonamides",
    label_en: "Sulfonamide allergy",
    label_ar: "حساسية السلفا",
    drugs: ["sulfa", "sulfonamide", "sulfamethoxazole", "bactrim", "septra", "smz-tmp", "sulfasalazine"],
  },
  {
    id: "narcotic-allergy",
    code: "Z88.4",
    description: "Allergy status to anesthetic agent",
    label_en: "Narcotic / anesthetic allergy",
    label_ar: "حساسية المخدرات",
    drugs: [
      "codeine", "morphine", "oxycodone", "hydrocodone", "hydromorphone",
      "fentanyl", "tramadol", "percocet", "vicodin", "opioid", "narcotic",
      "lidocaine", "novocain", "bupivacaine", "anesthetic",
    ],
  },
  {
    id: "analgesic-allergy",
    code: "Z88.6",
    description: "Allergy status to analgesic agent",
    label_en: "Analgesic (NSAID/aspirin) allergy",
    label_ar: "حساسية المسكنات",
    drugs: [
      "aspirin", "ibuprofen", "naproxen", "aleve", "advil", "motrin",
      "nsaid", "celecoxib", "celebrex", "meloxicam", "mobic", "ketorolac",
      "diclofenac", "analgesic",
    ],
  },
];

/** Encounter-level keywords for Z51.81 (therapeutic drug level monitoring). */
const MONITORING_KEYWORDS = [
  "drug level",
  "drug levels",
  "therapeutic drug monitoring",
  "tacrolimus level",
  "vancomycin level",
  "vancomycin trough",
  "digoxin level",
  "lithium level",
  "inr check",
  "inr monitoring",
  "anticoagulation monitoring",
  "coumadin clinic",
  "warfarin clinic",
];

/**
 * Cues that indicate the medication mention is NOT current long-term
 * therapy: stopped/discontinued, single/acute administration, or the
 * mention being part of an allergy/intolerance statement.
 */
const STOP_CUES = [
  "no longer", "stopped", "stopping", "discontinued", "d/c", "dc'd",
  "completed", "off the", "off of", "never took", "never taking",
  "never used", "denies", "allergic", "allergy", "intoleran", "hypersensitivit",
  "given", "received", "administered", "infused", "bolus", "dose of",
  "taper", "burst", "single dose", "stat dose",
  // acute ingestion / poisoning context is NOT long-term therapy
  "ingested", "ingestion", "swallowed", "overdose", "poisoning", "accidental",
];

const NEGATION_RE = /\b(no|not|without|denies|negative for|never)\b/i;

function sentenceWindowOf(t: string, idx: number, aliasLen: number): string {
  const start = Math.max(0, idx - 55);
  const end = Math.min(t.length, idx + aliasLen + 35);
  const raw = t.slice(start, end);
  const relIdx = idx - start;
  // Keep only the current sentence so negation does not leak across "." / "\n" / ";".
  const before = raw.slice(0, relIdx);
  const breakBefore = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf(";"),
    before.lastIndexOf("\n")
  );
  const from = breakBefore === -1 ? 0 : breakBefore + 1;
  const after = raw.slice(relIdx);
  let breakAfter = after.length;
  for (let i = 0; i < after.length; i++) {
    if (".!?;\n".includes(after[i])) {
      breakAfter = i;
      break;
    }
  }
  return raw.slice(from, relIdx + breakAfter);
}

/** Long-term-use detection: alias present in a non-stopped, non-negated, non-allergy context. */
function longTermPresent(t: string, alias: string): string | null {
  let i = t.indexOf(alias);
  while (i !== -1) {
    const wordBefore = t.slice(Math.max(0, i - 1), i);
    const isWordBoundary = /[\s(;:,.]|^$/.test(wordBefore) || i === 0;
    if (isWordBoundary) {
      const window = sentenceWindowOf(t, i, alias.length);
      if (!NEGATION_RE.test(window) && !STOP_CUES.some((cue) => window.includes(cue))) {
        return alias;
      }
    }
    i = t.indexOf(alias, i + 1);
  }
  return null;
}

/** Allergy detection: explicit allergy phrasing around the drug alias. */
function allergyClauses(t: string): string[] {
  // "allergic to penicillin, sulfa drugs, and codeine" — capture the whole
  // clause after each "allergic to" so comma-separated lists are covered.
  const clauses: string[] = [];
  const spanRe = /allergic to ([^.;\n]{0,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(t)) !== null) clauses.push(m[1]);
  return clauses;
}

function allergyPresent(t: string, alias: string, clauses: string[]): string | null {
  if (clauses.some((c) => c.includes(alias))) return alias;
  const patterns = [
    `${alias} allergy`,
    `allergy to ${alias}`,
    `${alias} intoleran`,
    `${alias} hypersensitivit`,
    `history of ${alias} allergy`,
  ];
  for (const p of patterns) {
    if (t.includes(p)) return alias;
  }
  return null;
}

function monitoringPresent(t: string, keyword: string): string | null {
  let i = t.indexOf(keyword);
  while (i !== -1) {
    const window = t.slice(Math.max(0, i - 30), i);
    if (!NEGATION_RE.test(window)) return keyword;
    i = t.indexOf(keyword, i + 1);
  }
  return null;
}

/**
 * Detect medication-status Z-codes documented in a clinical note:
 * long-term drug therapy (Z79.-), drug allergy status (Z88.-), and
 * therapeutic drug level monitoring encounters (Z51.81).
 */
export function detectMedicationStatusCodes(note: string): MedicationZFinding[] {
  const t = (note ?? "").toLowerCase();
  if (!t) return [];
  const findings: MedicationZFinding[] = [];

  for (const rule of MEDICATION_Z_RULES) {
    for (const drug of rule.drugs) {
      const matched = longTermPresent(t, drug);
      if (matched) {
        findings.push({
          code: rule.code,
          description: rule.description,
          label_en: rule.label_en,
          label_ar: rule.label_ar,
          drug: matched,
          kind: "long_term",
        });
        break; // one finding per rule (class)
      }
    }
  }

  for (const rule of DRUG_ALLERGY_RULES) {
    const clauses = allergyClauses(t);
    for (const drug of rule.drugs) {
      const matched = allergyPresent(t, drug, clauses);
      if (matched) {
        findings.push({
          code: rule.code,
          description: rule.description,
          label_en: rule.label_en,
          label_ar: rule.label_ar,
          drug: matched,
          kind: "allergy",
        });
        break;
      }
    }
  }

  for (const keyword of MONITORING_KEYWORDS) {
    const matched = monitoringPresent(t, keyword);
    if (matched) {
      findings.push({
        code: "Z51.81",
        description: "Encounter for therapeutic drug level monitoring",
        label_en: "Therapeutic drug level monitoring",
        label_ar: "زيارة لمتابعة مستوى الدواء العلاجي",
        drug: matched,
        kind: "monitoring",
      });
      break;
    }
  }

  return findings;
}
