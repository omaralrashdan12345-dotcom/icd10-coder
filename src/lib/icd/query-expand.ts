/**
 * Dependency-free clinical query expansion + stemming shared by the ICD
 * search layers (full-db inverted index and the curated vector DB).
 *
 * Kept free of any runtime import so it can run in the browser (offline PWA)
 * and on the server without pulling in a library. The synonym map is the
 * single source of truth for abbreviation, layman-term, and medication-name
 * expansion; the stemmer is a deliberately light suffix stripper (retrieval,
 * not linguistics).
 */

export type SynonymMap = Record<string, string[]>;

export const SYNONYMS: SynonymMap = {
  // ---- Cardiovascular abbreviations
  htn: ["hypertension"],
  hypertension: ["hypertensive"],
  bp: ["hypertension"],
  dm: ["diabetes", "mellitus"],
  dm2: ["diabetes", "mellitus", "type"],
  dm1: ["diabetes", "mellitus", "type"],
  t2dm: ["diabetes", "mellitus", "type"],
  t1dm: ["diabetes", "mellitus", "type"],
  niddm: ["diabetes", "mellitus", "type"],
  iddm: ["diabetes", "mellitus", "type"],
  diabetes: ["mellitus"],
  diabetic: ["diabetes"],
  ckd: ["chronic", "kidney", "disease"],
  aki: ["acute", "kidney", "injury"],
  esrd: ["end", "stage", "renal", "disease"],
  chf: ["heart", "failure"],
  hf: ["heart", "failure"],
  af: ["atrial", "fibrillation"],
  afib: ["atrial", "fibrillation"],
  cad: ["atherosclerotic", "coronary", "artery", "disease"],
  mi: ["myocardial", "infarction"],
  nstemi: ["myocardial", "infarction"],
  stemi: ["myocardial", "infarction"],
  copd: ["chronic", "obstructive", "pulmonary", "disease"],
  uti: ["urinary", "tract", "infection"],
  gerd: ["gastro", "esophageal", "reflux"],
  pud: ["peptic", "ulcer"],
  tia: ["transient", "ischemic", "attack"],
  cva: ["cerebral", "infarction", "stroke"],
  mva: ["motor", "vehicle", "accident"],
  sob: ["shortness", "breath", "dyspnea"],
  doe: ["dyspnea", "exertion"],
  pnd: ["paroxysmal", "nocturnal", "dyspnea"],
  gi: ["gastrointestinal"],
  bph: ["benign", "prostatic", "hyperplasia"],
  oa: ["osteoarthritis"],
  ra: ["rheumatoid", "arthritis"],
  ptsd: ["post", "traumatic", "stress"],
  mdd: ["depressive", "disorder"],
  gad: ["anxiety", "generalized"],
  osa: ["sleep", "apnea", "obstructive"],
  bmi: ["body", "mass", "index"],
  nka: ["allergy"],
  nkda: ["allergy"],
  cx: ["contusion"],
  lac: ["laceration"],
  fx: ["fracture"],
  er: ["emergency"],
  ed: ["emergency"],
  abd: ["abdominal"],
  uri: ["upper", "respiratory", "infection"],
  aaa: ["aortic"],
  pe: ["pulmonary", "embolism"],
  dvt: ["thrombosis", "deep", "vein"],
  pcos: ["polycystic", "ovary"],
  gout: ["gouty"],
  etoh: ["alcohol"],
  tender: ["pain"],
  tenderness: ["pain"],
  erythema: ["cellulitis", "skin"],
  high: ["elevated"],
  elevated: ["high"],

  // ---- Layman / colloquial terms
  sugar: ["glucose", "diabetes"],
  bruise: ["contusion"],
  bruis: ["contusion"],
  piles: ["hemorrhoids"],
  pinkeye: ["conjunctivitis"],
  hurt: ["pain"],
  ache: ["pain"],
  sore: ["pain"],
  dizzy: ["dizziness", "vertigo"],
  lightheaded: ["dizziness"],
  syncope: ["fainted"],
  tired: ["fatigue"],
  exhausted: ["fatigue"],
  weak: ["weakness"],
  swollen: ["swelling"],
  swell: ["swelling"],
  vomit: ["vomiting"],
  puking: ["vomiting"],
  itchy: ["pruritus", "itching"],
  itching: ["pruritus"],
  rash: ["eruption", "dermatitis"],
  rashes: ["eruption", "dermatitis"],
  wheeze: ["wheezing", "asthma"],
  wheezing: ["wheeze", "asthma"],
  phlegm: ["sputum"],
  sputum: ["phlegm"],
  runny: ["rhinorrhea"],
  nose: ["nasal"],
  indigestion: ["dyspepsia", "epigastric"],
  bloating: ["distension", "abdominal"],
  urinating: ["urination"],
  pee: ["urination", "urinary"],
  peeing: ["urination"],
  gallbladder: ["biliary"],
  cholesterol: ["hyperlipidemia", "lipid"],
  triglycerides: ["hyperlipidemia", "lipid"],
  triglyceride: ["hyperlipidemia", "lipid"],
  sciatic: ["sciatica"],
  herniated: ["hernia", "disc", "displacement"],
  slipped: ["displacement", "disc"],
  disc: ["displacement"],
  arthritis: ["osteoarthritis", "arthropathy"],
  arthralgia: ["joint", "pain"],
  cpap: ["sleep", "apnea"],
  dialysis: ["renal"],
  smoker: ["smoking", "tobacco"],
  cigarettes: ["smoking", "tobacco"],
  smoking: ["tobacco"],
  alcoholic: ["alcohol"],
  overweight: ["obesity"],
  obese: ["obesity"],
  fit: ["seizure", "convulsion"],
  fits: ["seizure", "convulsion"],
  numb: ["numbness"],

  // ---- Medications -> conditions (retrieval aid when notes list meds only)
  lisinopril: ["hypertension"],
  zestril: ["hypertension"],
  amlodipine: ["hypertension"],
  norvasc: ["hypertension"],
  losartan: ["hypertension"],
  valsartan: ["hypertension"],
  telmisartan: ["hypertension"],
  irbesartan: ["hypertension"],
  metoprolol: ["hypertension"],
  atenolol: ["hypertension"],
  carvedilol: ["hypertension"],
  bisoprolol: ["hypertension"],
  doxazosin: ["hypertension"],
  hydralazine: ["hypertension"],
  hydrochlorothiazide: ["hypertension"],
  hctz: ["hypertension"],
  metformin: ["diabetes", "mellitus"],
  glucophage: ["diabetes", "mellitus"],
  glipizide: ["diabetes", "mellitus"],
  glyburide: ["diabetes", "mellitus"],
  sitagliptin: ["diabetes", "mellitus"],
  empagliflozin: ["diabetes", "mellitus"],
  jardiance: ["diabetes", "mellitus"],
  insulin: ["diabetes", "mellitus"],
  lantus: ["diabetes", "mellitus"],
  humalog: ["diabetes", "mellitus"],
  semaglutide: ["diabetes", "mellitus"],
  ozempic: ["diabetes", "mellitus"],
  liraglutide: ["diabetes", "mellitus"],
  trulicity: ["diabetes", "mellitus"],
  atorvastatin: ["hyperlipidemia", "cholesterol"],
  lipitor: ["hyperlipidemia", "cholesterol"],
  simvastatin: ["hyperlipidemia", "cholesterol"],
  zocor: ["hyperlipidemia", "cholesterol"],
  rosuvastatin: ["hyperlipidemia", "cholesterol"],
  crestor: ["hyperlipidemia", "cholesterol"],
  pravastatin: ["hyperlipidemia", "cholesterol"],
  ezetimibe: ["hyperlipidemia", "cholesterol"],
  zetia: ["hyperlipidemia", "cholesterol"],
  warfarin: ["anticoagulant", "therapy"],
  coumadin: ["anticoagulant", "therapy"],
  apixaban: ["anticoagulant", "therapy"],
  eliquis: ["anticoagulant", "therapy"],
  rivaroxaban: ["anticoagulant", "therapy"],
  xarelto: ["anticoagulant", "therapy"],
  dabigatran: ["anticoagulant", "therapy"],
  pradaxa: ["anticoagulant", "therapy"],
  enoxaparin: ["anticoagulant", "therapy"],
  lovenox: ["anticoagulant", "therapy"],
  heparin: ["anticoagulant", "therapy"],
  clopidogrel: ["antiplatelet", "therapy"],
  plavix: ["antiplatelet", "therapy"],
  albuterol: ["asthma", "copd"],
  salbutamol: ["asthma", "copd"],
  ventolin: ["asthma", "copd"],
  symbicort: ["asthma", "copd"],
  advair: ["asthma", "copd"],
  spiriva: ["asthma", "copd"],
  tiotropium: ["asthma", "copd"],
  ipratropium: ["asthma", "copd"],
  montelukast: ["asthma", "allergy"],
  singulair: ["asthma", "allergy"],
  levothyroxine: ["hypothyroid", "thyroid"],
  synthroid: ["hypothyroid", "thyroid"],
  methimazole: ["hyperthyroid", "thyroid"],
  gabapentin: ["neuropathy", "nerve"],
  neurontin: ["neuropathy", "nerve"],
  pregabalin: ["neuropathy", "nerve"],
  lyrica: ["neuropathy", "nerve"],
  sertraline: ["depression", "antidepressant"],
  zoloft: ["depression", "antidepressant"],
  fluoxetine: ["depression", "antidepressant"],
  prozac: ["depression", "antidepressant"],
  citalopram: ["depression", "antidepressant"],
  escitalopram: ["depression", "antidepressant"],
  lexapro: ["depression", "antidepressant"],
  paroxetine: ["depression", "antidepressant"],
  venlafaxine: ["depression", "antidepressant"],
  duloxetine: ["depression", "antidepressant"],
  bupropion: ["depression", "antidepressant"],
  omeprazole: ["reflux", "gerd", "dyspepsia"],
  prilosec: ["reflux", "gerd", "dyspepsia"],
  esomeprazole: ["reflux", "gerd", "dyspepsia"],
  nexium: ["reflux", "gerd", "dyspepsia"],
  pantoprazole: ["reflux", "gerd", "dyspepsia"],
  protonix: ["reflux", "gerd", "dyspepsia"],
  lansoprazole: ["reflux", "gerd", "dyspepsia"],
  famotidine: ["reflux", "gerd", "dyspepsia"],
  pepcid: ["reflux", "gerd", "dyspepsia"],
  metronidazole: ["infection", "antibiotic"],
  flagyl: ["infection", "antibiotic"],
  ciprofloxacin: ["infection", "antibiotic"],
  cipro: ["infection", "antibiotic"],
  levofloxacin: ["infection", "antibiotic"],
  azithromycin: ["infection", "antibiotic"],
  zithromax: ["infection", "antibiotic"],
  amoxicillin: ["infection", "antibiotic"],
  augmentin: ["infection", "antibiotic"],
  doxycycline: ["infection", "antibiotic"],
  nitrofurantoin: ["infection", "antibiotic"],
  macrobid: ["infection", "antibiotic"],
  bactrim: ["infection", "antibiotic"],
  cephalexin: ["infection", "antibiotic"],
  keflex: ["infection", "antibiotic"],
  clindamycin: ["infection", "antibiotic"],
  oseltamivir: ["influenza"],
  tamiflu: ["influenza"],
  ibuprofen: ["pain", "inflammation"],
  motrin: ["pain", "inflammation"],
  naproxen: ["pain", "inflammation"],
  aleve: ["pain", "inflammation"],
  diclofenac: ["pain", "inflammation"],
  celecoxib: ["pain", "inflammation"],
  meloxicam: ["pain", "inflammation"],
  acetaminophen: ["pain", "fever"],
  tylenol: ["pain", "fever"],
  paracetamol: ["pain", "fever"],
  tramadol: ["pain", "opioid"],
  oxycodone: ["pain", "opioid"],
  hydrocodone: ["pain", "opioid"],
  norco: ["pain", "opioid"],
  percocet: ["pain", "opioid"],
  morphine: ["pain", "opioid"],
  hydromorphone: ["pain", "opioid"],
  allopurinol: ["gout", "uric"],
  colchicine: ["gout", "uric"],
  febuxostat: ["gout", "uric"],
  methotrexate: ["rheumatoid", "arthritis"],
  hydroxychloroquine: ["rheumatoid", "arthritis"],
  plaquenil: ["rheumatoid", "arthritis"],
  alendronate: ["osteoporosis"],
  fosamax: ["osteoporosis"],
  denosumab: ["osteoporosis"],
  prolia: ["osteoporosis"],
  donepezil: ["dementia", "alzheimer"],
  aricept: ["dementia", "alzheimer"],
  memantine: ["dementia", "alzheimer"],
  levodopa: ["parkinson"],
  sinemet: ["parkinson"],
  ropinirole: ["parkinson"],
  sumatriptan: ["migraine"],
  imitrex: ["migraine"],
  rizatriptan: ["migraine"],
  ondansetron: ["nausea", "vomiting"],
  zofran: ["nausea", "vomiting"],
  promethazine: ["nausea"],
  phenergan: ["nausea"],
  loperamide: ["diarrhea"],
  imodium: ["diarrhea"],
  miralax: ["constipation"],
  senna: ["constipation"],
  docusate: ["constipation"],
  colace: ["constipation"],
  zolpidem: ["insomnia"],
  ambien: ["insomnia"],
  tamsulosin: ["prostatic", "urinary"],
  flomax: ["prostatic", "urinary"],
  finasteride: ["prostatic"],
  acyclovir: ["herpes", "shingles"],
  valacyclovir: ["herpes", "shingles"],
  valtrex: ["herpes", "shingles"],
  ferrous: ["anemia", "iron"],
};

export function stem(token: string): string {
  if (token.length <= 3) return token;
  let t = token;
  if (t.endsWith("ies") && t.length > 4) return t.slice(0, -3) + "y";
  if (t.endsWith("sses")) return t.slice(0, -2);
  if (t.endsWith("ses") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) return t.slice(0, -1);
  if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3);
  if (t.endsWith("ed") && t.length > 4) return t.slice(0, -2);
  return t;
}

/**
 * Expand a raw query token into itself plus any synonym/abbreviation terms,
 * all stemmed. Returns a stable, de-duplicated list. Used to enrich a search
 * query so that "htn" also matches "hypertension" and "t2dm" matches
 * "diabetes mellitus", without any runtime dependency.
 */
export function expandToken(token: string): string[] {
  const base = stem(token);
  const out = new Set<string>([base]);
  const syn = SYNONYMS[token] ?? SYNONYMS[base];
  if (syn) {
    for (const s of syn) out.add(s.length > 2 ? stem(s) : s);
  }
  return [...out];
}

/**
 * Given a list of normalized query tokens (already lowercased, punctuation
 * stripped), return the expanded token set with duplicates removed, preserving
 * first-seen order so callers can still reason about the original tokens.
 */
export function expandTokens(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    for (const e of expandToken(t)) {
      if (!seen.has(e)) {
        seen.add(e);
        out.push(e);
      }
    }
  }
  return out;
}

/** True when a token maps to at least one additional synonym term. */
export function hasSynonyms(token: string): boolean {
  const base = stem(token);
  const syn = SYNONYMS[token] ?? SYNONYMS[base];
  return Array.isArray(syn) && syn.length > 0;
}
