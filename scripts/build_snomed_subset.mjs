#!/usr/bin/env node
/**
 * build_snomed_subset.mjs
 * ---------------------------------------------------------------
 * Builds an EMBEDDED SNOMED CT SUBSET (JSON) for offline use in the
 * demo coder app. This mirrors the build step you would run inside
 * your own repo (see integration guide).
 *
 * Pipeline:
 *  1. Curated seed list (concept IDs + expected terms, semantic tags,
 *     curated ICD-10-CM map targets).
 *  2. Validate each seed against the SNOMED CT International release
 *     mirrored by EBI OLS4 (term API). Invalid/obsolete seeds are
 *     dropped, or re-resolved by search when only a term is given.
 *  3. Validate every unique ICD-10-CM code against the NLM Clinical
 *     Table Search Service (official names); unknown codes dropped.
 *  4. Emit src/data/snomed-subset.json with provenance metadata.
 *
 * Usage: node scripts/build_snomed_subset.mjs [--limit N] [--min-score 0.34]
 */

const OLS4_TERM = 'https://www.ebi.ac.uk/ols4/api/ontologies/snomed/terms/';
const OLS4_SEARCH = 'https://www.ebi.ac.uk/ols4/api/search';
const ONTO_EXPAND = 'https://r4.ontoserver.csiro.au/fhir/ValueSet/$expand';
const NLM = 'https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search';
const OUT = new URL('../src/data/snomed-subset.json', import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const LIMIT = parseInt(argOf('--limit', '0'), 10);
const MIN_SCORE = parseFloat(argOf('--min-score', '0.34'));
const STRONG_SCORE = parseFloat(argOf('--strong-score', '0.6'));

const TAG_RE = / \((disorder|finding|procedure|body structure|organism|substance|product|situation|regime\/therapy|qualifier value|observable entity|morphologic abnormality|environment|event|occupation|social concept|special concept|staging scale|attribute|cell|cell structure|physical object|specimen|physical force|linkage concept|namespace concept|core metadata concept|foundation metadata concept)\)$/i;
function splitTag(label) {
  const m = String(label).match(TAG_RE);
  if (m) return { pt: String(label).slice(0, m.index), tag: m[1].toLowerCase() };
  return { pt: label, tag: null };
}

/* ------------------------------------------------------------------ */
/* Seed list.                                                          */
/*  id    : SNOMED concept id (validated; dropped on 404/mismatch)     */
/*  expect: expected English label keywords (validation + fallback)    */
/*  tag   : SNOMED semantic tag                                        */
/*  icd   : curated ICD-10-CM target(s) (validated later against NLM)  */
/*  role  : default coding role hint                                   */
/*  syn   : extra curated synonyms used by the local matcher           */
/* ------------------------------------------------------------------ */
const SEEDS = [
  // ---- Cardiovascular / endocrine
  { id: '73211009', expect: 'diabetes mellitus', tag: 'disorder', icd: ['E11.9'], role: 'primary', syn: ['DM', 'sugar disease'] },
  { id: '44054006', expect: 'diabetes mellitus type 2', tag: 'disorder', icd: ['E11.9'], role: 'primary', syn: ['T2DM', 'type II diabetes'] },
  { id: '46635009', expect: 'diabetes mellitus type 1', tag: 'disorder', icd: ['E10.9'], role: 'primary', syn: ['T1DM', 'type I diabetes'] },
  { id: '38341003', expect: 'hypertensive disorder', tag: 'disorder', icd: ['I10'], role: 'primary', syn: ['HTN', 'high blood pressure', 'essential hypertension'] },
  { id: '56265001', expect: 'heart failure', tag: 'disorder', icd: ['I50.9'], role: 'primary', syn: ['cardiac failure'] },
  { id: '42343007', expect: 'congestive heart failure', tag: 'disorder', icd: ['I50.9'], role: 'primary', syn: ['CHF'] },
  { id: '22298006', expect: 'myocardial infarction', tag: 'disorder', icd: ['I21.9'], role: 'primary', syn: ['MI', 'heart attack'] },
  { id: '414545008', expect: 'ischemic heart disease', tag: 'disorder', icd: ['I25.10'], role: 'primary', syn: ['IHD', 'coronary artery disease', 'CAD'] },
  { id: '275526006', expect: 'atrial fibrillation', tag: 'disorder', icd: ['I48.91'], role: 'primary', syn: ['AFib', 'AF'] },
  { id: '59282003', expect: 'pulmonary embolism', tag: 'disorder', icd: ['I26.99'], role: 'primary', syn: ['PE'] },
  { id: '53741008', expect: 'coronary arteriosclerosis', tag: 'disorder', icd: ['I25.10'], role: 'primary' },
  { id: '230690007', expect: 'cerebrovascular accident', tag: 'disorder', icd: ['I63.9'], role: 'primary', syn: ['stroke', 'CVA'] },
  { id: '266257000', expect: 'transient ischemic attack', tag: 'disorder', icd: ['G45.9'], role: 'primary', syn: ['TIA', 'mini stroke'] },
  { id: '85898005', expect: 'cardiomyopathy', tag: 'disorder', icd: ['I42.9'], role: 'primary' },
  { id: '194958000', expect: 'unstable angina', tag: 'disorder', icd: ['I20.0'], role: 'primary' },
  { id: '233814008', expect: 'angina pectoris', tag: 'disorder', icd: ['I20.9'], role: 'primary' },
  { id: '128053000', expect: 'deep venous thrombosis', tag: 'disorder', icd: ['I82.90'], role: 'primary', syn: ['DVT'] },
  { id: '709044004', expect: 'chronic kidney disease', tag: 'disorder', icd: ['N18.9'], role: 'primary', syn: ['CKD', 'chronic renal failure'] },

  // ---- Respiratory
  { id: '195967001', expect: 'asthma', tag: 'disorder', icd: ['J45.909'], role: 'primary' },
  { id: '13645005', expect: 'chronic obstructive pulmonary disease', tag: 'disorder', icd: ['J44.9'], role: 'primary', syn: ['COPD'] },
  { id: '233604007', expect: 'pneumonia', tag: 'disorder', icd: ['J18.9'], role: 'primary' },
  { id: '53084003', expect: 'bacterial pneumonia', tag: 'disorder', icd: ['J15.9'], role: 'primary' },
  { id: '444814009', expect: 'viral pneumonia', tag: 'disorder', icd: ['J12.9'], role: 'primary' },
  { id: '10509002', expect: 'acute bronchitis', tag: 'disorder', icd: ['J20.9'], role: 'primary' },
  { id: '67782005', expect: 'acute respiratory distress syndrome', tag: 'disorder', icd: ['J80'], role: 'primary', syn: ['ARDS'] },
  { id: '6142004', expect: 'influenza', tag: 'disorder', icd: ['J11.1'], role: 'primary', syn: ['flu'] },
  { id: '840539006', expect: 'COVID-19', tag: 'disorder', icd: ['U07.1'], role: 'primary', syn: ['coronavirus disease', 'SARS-CoV-2 infection'] },
  { id: '36118008', expect: 'pneumothorax', tag: 'disorder', icd: ['J93.9'], role: 'primary' },
  { id: '263664006', expect: 'acute pharyngitis', tag: 'disorder', icd: ['J02.9'], role: 'primary', syn: ['sore throat'] },
  { id: '82272006', expect: 'common cold', tag: 'disorder', icd: ['J00'], role: 'primary', syn: ['acute nasopharyngitis', 'head cold'] },
  { id: '36218005', expect: 'sinusitis', tag: 'disorder', icd: ['J01.90'], role: 'primary' },
  { id: '56717001', expect: 'pulmonary tuberculosis', tag: 'disorder', icd: ['A15.0'], role: 'primary', syn: ['TB'] },
  { id: '59921004', expect: 'pulmonary emphysema', tag: 'disorder', icd: ['J43.9'], role: 'primary' },

  // ---- GI / hepatic
  { id: '235719002', expect: 'gastroesophageal reflux disease', tag: 'disorder', icd: ['K21.9'], role: 'primary', syn: ['GERD', 'acid reflux'] },
  { id: '13200003', expect: 'peptic ulcer', tag: 'disorder', icd: ['K25.9'], role: 'primary' },
  { id: '77592000', expect: 'acute appendicitis', tag: 'disorder', icd: ['K35.80'], role: 'primary' },
  { id: '55596003', expect: 'cholelithiasis', tag: 'disorder', icd: ['K80.20'], role: 'primary', syn: ['gallstones'] },
  { id: '55827005', expect: 'acute pancreatitis', tag: 'disorder', icd: ['K85.90'], role: 'primary' },
  { id: '13921004', expect: 'cirrhosis', tag: 'disorder', icd: ['K74.60'], role: 'primary' },
  { id: '64766004', expect: 'ulcerative colitis', tag: 'disorder', icd: ['K51.90'], role: 'primary', syn: ['UC'] },
  { id: '34000006', expect: 'crohn disease', tag: 'disorder', icd: ['K50.90'], role: 'primary', syn: ["Crohn's disease"] },
  { id: '10743008', expect: 'irritable bowel syndrome', tag: 'disorder', icd: ['K58.9'], role: 'primary', syn: ['IBS'] },
  { id: '54150009', expect: 'hiatal hernia', tag: 'disorder', icd: ['K44.9'], role: 'primary', syn: ['hiatus hernia'] },
  { id: '62315008', expect: 'diarrhea', tag: 'disorder', icd: ['R19.7'], role: 'secondary' },
  { id: '20196002', expect: 'constipation', tag: 'disorder', icd: ['K59.00'], role: 'secondary' },
  { id: '45560004', expect: 'gastritis', tag: 'disorder', icd: ['K29.70'], role: 'primary' },
  { id: '74627003', expect: 'gastroenteritis', tag: 'disorder', icd: ['A09'], role: 'primary', syn: ['stomach flu'] },

  // ---- Renal / urological
  { id: '68566005', expect: 'urinary tract infection', tag: 'disorder', icd: ['N39.0'], role: 'primary', syn: ['UTI'] },
  { id: '39910006', expect: 'renal calculus', tag: 'disorder', icd: ['N20.0'], role: 'primary', syn: ['kidney stone', 'nephrolithiasis'] },
  { id: '72681001', expect: 'acute kidney failure', tag: 'disorder', icd: ['N17.9'], role: 'primary', syn: ['acute kidney injury', 'AKI', 'acute renal failure'] },
  { id: '266569008', expect: 'benign prostatic hyperplasia', tag: 'disorder', icd: ['N40.1'], role: 'primary', syn: ['BPH', 'enlarged prostate'] },
  { id: '34422009', expect: 'hematuria', tag: 'finding', icd: ['R31.9'], role: 'secondary' },

  // ---- Neurological
  { id: '128613002', expect: 'seizure', tag: 'finding', icd: ['R56.9'], role: 'secondary' },
  { id: '37796009', expect: 'migraine', tag: 'disorder', icd: ['G43.909'], role: 'primary' },
  { id: '26929004', expect: 'alzheimer disease', tag: 'disorder', icd: ['G30.9'], role: 'primary' },
  { id: '89459001', expect: 'parkinson disease', tag: 'disorder', icd: ['G20.A1'], role: 'primary' },
  { id: '24700007', expect: 'multiple sclerosis', tag: 'disorder', icd: [], role: 'primary', syn: ['MS'] },
  { id: '14517004', expect: 'epilepsy', tag: 'disorder', icd: ['G40.909'], role: 'primary' },
  { id: '39913006', expect: 'vertigo', tag: 'disorder', icd: ['R42'], role: 'secondary' },
  { id: '230688007', expect: 'headache', tag: 'finding', icd: ['R51.9'], role: 'secondary' },

  // ---- Mental health
  { id: '370143000', expect: 'major depressive disorder', tag: 'disorder', icd: ['F32.9'], role: 'primary', syn: ['MDD', 'clinical depression'] },
  { id: '48694002', expect: 'anxiety disorder', tag: 'disorder', icd: ['F41.9'], role: 'primary' },
  { id: '193462001', expect: 'insomnia', tag: 'disorder', icd: ['G47.00'], role: 'primary' },
  { id: '58214004', expect: 'schizophrenia', tag: 'disorder', icd: ['F20.9'], role: 'primary' },
  { id: '13746004', expect: 'bipolar disorder', tag: 'disorder', icd: ['F31.9'], role: 'primary' },
  { id: '52448006', expect: 'dementia', tag: 'disorder', icd: ['F03.90'], role: 'primary' },
  { id: '66141009', expect: 'alcohol dependence', tag: 'disorder', icd: ['F10.20'], role: 'primary', syn: ['alcoholism'] },

  // ---- Musculoskeletal / rheum
  { id: '396275006', expect: 'osteoarthritis', tag: 'disorder', icd: ['M19.90'], role: 'primary', syn: ['degenerative joint disease'] },
  { id: '69896004', expect: 'rheumatoid arthritis', tag: 'disorder', icd: ['M06.9'], role: 'primary', syn: ['RA'] },
  { id: '64859006', expect: 'osteoporosis', tag: 'disorder', icd: ['M81.8'], role: 'primary' },
  { id: '278860007', expect: 'low back pain', tag: 'finding', icd: ['M54.50'], role: 'secondary', syn: ['lumbago'] },
  { id: '90566004', expect: 'gout', tag: 'disorder', icd: ['M10.9'], role: 'primary' },

  // ---- Infections / organisms
  { id: '10001005', expect: 'sepsis', tag: 'disorder', icd: ['A41.9'], role: 'primary', syn: ['septicemia'] },
  { id: '428573003', expect: 'methicillin resistant staphylococcus aureus infection', tag: 'disorder', icd: [], role: 'primary', syn: ['MRSA infection'] },
  { id: '3092008', expect: 'staphylococcus aureus', tag: 'organism', icd: [], role: 'supplemental' },
  { id: '112283007', expect: 'escherichia coli', tag: 'organism', icd: [], role: 'supplemental', syn: ['E. coli'] },
  { id: '9861002', expect: 'streptococcus pneumoniae', tag: 'organism', icd: [], role: 'supplemental', syn: ['pneumococcus'] },
  { id: '840533007', expect: 'SARS-CoV-2', tag: 'organism', icd: [], role: 'supplemental' },
  { id: '111880001', expect: 'influenza virus', tag: 'organism', icd: [], role: 'supplemental' },
  { id: '58281008', expect: 'candidiasis', tag: 'disorder', icd: ['B37.9'], role: 'primary', syn: ['thrush'] },
  { id: '61462000', expect: 'malaria', tag: 'disorder', icd: ['B54'], role: 'primary' },
  { id: '38907003', expect: 'chickenpox', tag: 'disorder', icd: ['B01.9'], role: 'primary', syn: ['varicella'] },
  { id: '14189004', expect: 'measles', tag: 'disorder', icd: ['B05.9'], role: 'primary', syn: ['rubeola'] },
  { id: '128018002', expect: 'cellulitis', tag: 'disorder', icd: ['L03.90'], role: 'primary' },
  { id: '32485007', expect: 'bacterial meningitis', tag: 'disorder', icd: ['G00.9'], role: 'primary' },
  { id: '86406008', expect: 'human immunodeficiency virus infection', tag: 'disorder', icd: ['B20'], role: 'primary', syn: ['HIV infection', 'HIV'] },
  { id: '4740000', expect: 'herpes zoster', tag: 'disorder', icd: ['B02.9'], role: 'primary', syn: ['shingles'] },

  // ---- Symptoms / findings
  { id: '386661006', expect: 'fever', tag: 'finding', icd: ['R50.9'], role: 'secondary', syn: ['pyrexia', 'high temperature'] },
  { id: '49727002', expect: 'cough', tag: 'finding', icd: ['R05.9'], role: 'secondary' },
  { id: '29857009', expect: 'chest pain', tag: 'finding', icd: ['R07.9'], role: 'secondary' },
  { id: '267036007', expect: 'dyspnea', tag: 'finding', icd: ['R06.02'], role: 'secondary', syn: ['shortness of breath', 'SOB', 'breathlessness'] },
  { id: '422587007', expect: 'nausea', tag: 'finding', icd: ['R11.0'], role: 'secondary' },
  { id: '422400008', expect: 'vomiting', tag: 'finding', icd: ['R11.2'], role: 'secondary' },
  { id: '21522001', expect: 'abdominal pain', tag: 'finding', icd: ['R10.9'], role: 'secondary', syn: ['belly pain', 'stomach ache'] },
  { id: '271807003', expect: 'eruption of skin', tag: 'finding', icd: ['R21'], role: 'secondary', syn: ['rash'] },
  { id: '404640003', expect: 'dizziness', tag: 'finding', icd: ['R42'], role: 'secondary', syn: ['lightheadedness'] },
  { id: '84229001', expect: 'fatigue', tag: 'finding', icd: ['R53.83'], role: 'secondary', syn: ['tiredness', 'exhaustion'] },
  { id: '44169009', expect: 'loss of weight', tag: 'finding', icd: ['R63.4'], role: 'secondary', syn: ['weight loss'] },
  { id: '79890006', expect: 'anorexia', tag: 'finding', icd: ['R63.0'], role: 'secondary', syn: ['loss of appetite'] },
  { id: '66857006', expect: 'hemoptysis', tag: 'finding', icd: ['R04.2'], role: 'secondary', syn: ['coughing up blood'] },
  { id: '90708001', expect: 'edema', tag: 'finding', icd: ['R60.9'], role: 'secondary', syn: ['swelling', 'oedema'] },
  { id: '36217005', expect: 'palpitations', tag: 'finding', icd: ['R00.2'], role: 'secondary' },
  { id: '271594007', expect: 'syncope', tag: 'finding', icd: ['R55'], role: 'secondary', syn: ['fainting', 'passed out'] },
  { id: '68962001', expect: 'muscle weakness', tag: 'finding', icd: ['M62.81'], role: 'secondary' },
  { id: '25064002', expect: 'headache', tag: 'finding', icd: ['R51.9'], role: 'secondary' },

  // ---- Metabolic / endocrine misc
  { id: '414916001', expect: 'obesity', tag: 'disorder', icd: ['E66.9'], role: 'primary' },
  { id: '55822004', expect: 'hyperlipidemia', tag: 'disorder', icd: ['E78.5'], role: 'primary', syn: ['high cholesterol', 'dyslipidemia'] },
  { id: '405747009', expect: 'hypothyroidism', tag: 'disorder', icd: ['E03.9'], role: 'primary' },
  { id: '353295001', expect: 'hyperthyroidism', tag: 'disorder', icd: ['E05.90'], role: 'primary', syn: ['overactive thyroid'] },
  { id: '271737000', expect: 'anemia', tag: 'disorder', icd: ['D64.9'], role: 'primary', syn: ['low hemoglobin'] },

  // ---- Pregnancy / obstetric
  { id: '289964001', expect: 'normal pregnancy', tag: 'situation', icd: ['Z34.90'], role: 'supplemental', syn: ['pregnancy'] },
  { id: '29857009', expect: 'chest pain', tag: 'finding', icd: ['R07.9'], role: 'secondary' },

  // ---- Procedures
  { id: '34173001', expect: 'appendectomy', tag: 'procedure', icd: [], role: 'supplemental', syn: ['appendicectomy'] },
  { id: '232717009', expect: 'coronary artery bypass grafting', tag: 'procedure', icd: [], role: 'supplemental', syn: ['CABG', 'bypass surgery'] },
  { id: '235152008', expect: 'colonoscopy', tag: 'procedure', icd: [], role: 'supplemental' },
  { id: '52765003', expect: 'endotracheal intubation', tag: 'procedure', icd: [], role: 'supplemental' },
  { id: '50697003', expect: 'general anesthesia', tag: 'procedure', icd: [], role: 'supplemental' },
  { id: '108066000', expect: 'hemodialysis', tag: 'procedure', icd: [], role: 'supplemental', syn: ['dialysis'] },
  { id: '33879002', expect: 'administration of vaccine', tag: 'procedure', icd: [], role: 'supplemental', syn: ['vaccination', 'immunization'] },
  { id: '308568006', expect: 'cesarean section', tag: 'procedure', icd: [], role: 'supplemental', syn: ['C-section'] },

  // ---- Body structures
  { id: '80248007', expect: 'heart structure', tag: 'body structure', icd: [], role: 'supplemental', syn: ['heart'] },
  { id: '39607008', expect: 'lung structure', tag: 'body structure', icd: [], role: 'supplemental', syn: ['lung', 'lungs'] },
  { id: '64033007', expect: 'kidney structure', tag: 'body structure', icd: [], role: 'supplemental', syn: ['kidney'] },
  { id: '12738006', expect: 'brain structure', tag: 'body structure', icd: [], role: 'supplemental', syn: ['brain'] },
  { id: '10200004', expect: 'liver structure', tag: 'body structure', icd: [], role: 'supplemental', syn: ['liver'] },
  { id: '69695003', expect: 'stomach structure', tag: 'body structure', icd: [], role: 'supplemental', syn: ['stomach'] },

  // ---- Products (medications)
  { id: '372567009', expect: 'metformin', tag: 'product', icd: [], role: 'supplemental' },
  { id: '119650008', expect: 'aspirin', tag: 'product', icd: [], role: 'supplemental' },
  { id: '67866001', expect: 'insulin', tag: 'product', icd: [], role: 'supplemental' },
  { id: '59714001', expect: 'warfarin', tag: 'product', icd: [], role: 'supplemental' },
  { id: '37604009', expect: 'amoxicillin', tag: 'product', icd: [], role: 'supplemental' },

  // ---- Term-only seeds (resolved by OLS4 search, validated by tokens)
  { expect: 'acute tonsillitis', tag: 'disorder', icd: ['J03.90'], role: 'primary' },
  { expect: 'otitis media', tag: 'disorder', icd: ['H66.90'], role: 'primary', syn: ['ear infection'] },
  { expect: 'conjunctivitis', tag: 'disorder', icd: ['H10.9'], role: 'primary', syn: ['pink eye'] },
  { expect: 'cataract', tag: 'disorder', icd: ['H26.9'], role: 'primary' },
  { expect: 'glaucoma', tag: 'disorder', icd: ['H40.9'], role: 'primary' },
  { expect: 'hearing loss', tag: 'disorder', icd: ['H91.90'], role: 'primary', syn: ['deafness'] },
  { expect: 'epistaxis', tag: 'finding', icd: ['R04.0'], role: 'secondary', syn: ['nosebleed'] },
  { expect: 'dysphagia', tag: 'finding', icd: ['R13.10'], role: 'secondary', syn: ['difficulty swallowing'] },
  { expect: 'diverticulitis', tag: 'disorder', icd: ['K57.32'], role: 'primary' },
  { expect: 'inguinal hernia', tag: 'disorder', icd: ['K40.90'], role: 'primary' },
  { expect: 'hemorrhoids', tag: 'disorder', icd: ['K64.9'], role: 'primary', syn: ['piles'] },
  { expect: 'prostatitis', tag: 'disorder', icd: ['N41.9'], role: 'primary' },
  { expect: 'erectile dysfunction', tag: 'disorder', icd: ['N52.9'], role: 'primary', syn: ['impotence'] },
  { expect: 'dysmenorrhea', tag: 'finding', icd: ['N94.6'], role: 'secondary', syn: ['painful menstruation'] },
  { expect: 'menorrhagia', tag: 'finding', icd: ['N92.0'], role: 'secondary', syn: ['heavy menstrual bleeding'] },
  { expect: 'breast cancer', tag: 'disorder', icd: ['C50.919'], role: 'primary', syn: ['carcinoma of breast'] },
  { expect: 'prostate cancer', tag: 'disorder', icd: ['C61'], role: 'primary' },
  { expect: 'lung cancer', tag: 'disorder', icd: ['C34.90'], role: 'primary', syn: ['malignant neoplasm of lung'] },
  { expect: 'colorectal cancer', tag: 'disorder', icd: ['C18.9'], role: 'primary' },
  { expect: 'melanoma', tag: 'disorder', icd: ['C43.9'], role: 'primary' },
  { expect: 'lymphoma', tag: 'disorder', icd: ['C85.90'], role: 'primary' },
  { expect: 'leukemia', tag: 'disorder', icd: ['C95.90'], role: 'primary' },
  { expect: 'iron deficiency anemia', tag: 'disorder', icd: ['D50.9'], role: 'primary' },
  { expect: 'sickle cell disorder', tag: 'disorder', icd: ['D57.00'], role: 'primary', syn: ['sickle cell anemia'] },
  { expect: 'thrombocytopenia', tag: 'disorder', icd: ['D69.6'], role: 'primary', syn: ['low platelets'] },
  { expect: 'varicose veins', tag: 'disorder', icd: [], role: 'primary' },
  { expect: 'aortic aneurysm', tag: 'disorder', icd: ['I71.9'], role: 'primary' },
  { expect: 'peripheral artery disease', tag: 'disorder', icd: ['I70.90'], role: 'primary', syn: ['PAD'] },
  { expect: 'pericarditis', tag: 'disorder', icd: ['I30.9'], role: 'primary' },
  { expect: 'endocarditis', tag: 'disorder', icd: ['I33.0'], role: 'primary' },
  { expect: 'mitral valve prolapse', tag: 'disorder', icd: ['I34.1'], role: 'primary' },
  { expect: 'pleural effusion', tag: 'disorder', icd: ['J90'], role: 'primary' },
  { expect: 'pulmonary fibrosis', tag: 'disorder', icd: ['J84.10'], role: 'primary' },
  { expect: 'sarcoidosis', tag: 'disorder', icd: ['D86.9'], role: 'primary' },
  { expect: 'sleep apnea', tag: 'disorder', icd: ['G47.33'], role: 'primary', syn: ['OSA'] },
  { expect: 'respiratory failure', tag: 'disorder', icd: ['J96.90'], role: 'primary' },
  { expect: 'cystic fibrosis', tag: 'disorder', icd: ['E84.9'], role: 'primary', syn: ['CF'] },
  { expect: 'bronchiectasis', tag: 'disorder', icd: ['J47.9'], role: 'primary' },
  { expect: 'systemic lupus erythematosus', tag: 'disorder', icd: ['M32.9'], role: 'primary', syn: ['lupus', 'SLE'] },
  { expect: 'psoriasis', tag: 'disorder', icd: ['L40.0'], role: 'primary' },
  { expect: 'atopic dermatitis', tag: 'disorder', icd: ['L20.9'], role: 'primary', syn: ['eczema'] },
  { expect: 'urticaria', tag: 'disorder', icd: ['L50.9'], role: 'primary', syn: ['hives'] },
  { expect: 'osteomyelitis', tag: 'disorder', icd: ['M86.9'], role: 'primary' },
  { expect: 'scoliosis', tag: 'disorder', icd: ['M41.9'], role: 'primary' },
  { expect: 'sciatica', tag: 'disorder', icd: ['M54.30'], role: 'primary' },
  { expect: 'diabetic neuropathy', tag: 'disorder', icd: ['E11.40'], role: 'primary' },
  { expect: 'diabetic nephropathy', tag: 'disorder', icd: ['E11.21'], role: 'primary' },
  { expect: 'diabetic foot ulcer', tag: 'disorder', icd: ['E11.621'], role: 'primary' },
  { expect: 'hypoglycemia', tag: 'finding', icd: ['E16.2'], role: 'secondary', syn: ['low blood sugar'] },
  { expect: 'dehydration', tag: 'finding', icd: ['E86.0'], role: 'secondary' },
  { expect: 'hyponatremia', tag: 'finding', icd: ['E87.1'], role: 'secondary' },
  { expect: 'hyperkalemia', tag: 'finding', icd: ['E87.5'], role: 'secondary' },
  { expect: 'malnutrition', tag: 'disorder', icd: [], role: 'primary' },
  { expect: 'laryngitis', tag: 'disorder', icd: ['J04.0'], role: 'primary' },
  { expect: 'scarlet fever', tag: 'disorder', icd: ['A38.9'], role: 'primary' },
  { expect: 'dengue', tag: 'disorder', icd: ['A90'], role: 'primary' },
  { expect: 'tetanus', tag: 'disorder', icd: ['A35'], role: 'primary' },
  { expect: 'pertussis', tag: 'disorder', icd: ['A37.90'], role: 'primary', syn: ['whooping cough'] },
  { expect: 'herpes simplex', tag: 'disorder', icd: ['B00.9'], role: 'primary' },
  { expect: 'gonorrhea', tag: 'disorder', icd: ['A54.9'], role: 'primary' },
  { expect: 'syphilis', tag: 'disorder', icd: ['A53.9'], role: 'primary' },
  { expect: 'Pre-eclampsia', tag: 'disorder', icd: ['O14.90'], role: 'primary', syn: ['preeclampsia'] },
  { expect: 'gestational diabetes', tag: 'disorder', icd: ['O24.410'], role: 'primary' },
  { expect: 'preterm labor', tag: 'disorder', icd: ['O60.00'], role: 'primary' },
  { expect: 'polycystic ovary syndrome', tag: 'disorder', icd: ['E28.2'], role: 'primary', syn: ['PCOS'] },
  { expect: 'post-traumatic stress disorder', tag: 'disorder', icd: ['F43.10'], role: 'primary', syn: ['PTSD'] },
  { expect: 'obsessive compulsive disorder', tag: 'disorder', icd: ['F42.9'], role: 'primary', syn: ['OCD'] },
  { expect: 'panic attack', tag: 'finding', icd: ['F41.0'], role: 'primary' },
  { expect: 'delirium', tag: 'disorder', icd: ['F05'], role: 'primary' },
  { expect: 'attention deficit hyperactivity disorder', tag: 'disorder', icd: ['F90.9'], role: 'primary', syn: ['ADHD'] },
  { expect: 'hypertensive crisis', tag: 'disorder', icd: ['I16.9'], role: 'primary' },
  { expect: 'hypotension', tag: 'finding', icd: ['I95.9'], role: 'secondary', syn: ['low blood pressure'] },
  { expect: 'bradycardia', tag: 'finding', icd: ['R00.1'], role: 'secondary' },
  { expect: 'tachycardia', tag: 'finding', icd: ['R00.0'], role: 'secondary' },
  { expect: 'atrial flutter', tag: 'disorder', icd: ['I48.92'], role: 'primary' },
  { expect: 'heart valve disease', tag: 'disorder', icd: [], role: 'primary', syn: ['valvular heart disease', 'heart valve disorder'] },
  { expect: 'aortic stenosis', tag: 'disorder', icd: ['I35.0'], role: 'primary' },
  { expect: 'esophagitis', tag: 'disorder', icd: ['K20.90'], role: 'primary', syn: ['reflux esophagitis'] },
  { expect: 'gastric cancer', tag: 'disorder', icd: ['C16.9'], role: 'primary', syn: ['stomach cancer'] },
  { expect: 'malignant neoplasm of pancreas', tag: 'disorder', icd: ['C25.9'], role: 'primary', syn: ['pancreatic cancer'] },
  { expect: 'liver cancer', tag: 'disorder', icd: ['C22.0'], role: 'primary', syn: ['hepatocellular carcinoma'] },
  { expect: 'acute leukemia', tag: 'disorder', icd: ['C95.00'], role: 'primary' },
  { expect: 'kidney transplant rejection', tag: 'disorder', icd: ['T86.19'], role: 'primary' },
  { expect: 'hypertensive heart disease', tag: 'disorder', icd: ['I11.9'], role: 'primary' },
  { expect: 'atrioventricular block', tag: 'disorder', icd: ['I44.30'], role: 'primary' },
  { expect: 'cardiac arrest', tag: 'disorder', icd: ['I46.9'], role: 'primary' },
  { expect: 'thrombophlebitis', tag: 'disorder', icd: ['I80.9'], role: 'primary' },
  { expect: 'aortic dissection', tag: 'disorder', icd: ['I71.00'], role: 'primary' },
  { expect: 'metabolic syndrome', tag: 'disorder', icd: ['E88.810'], role: 'primary' },
  { expect: 'vitamin d deficiency', tag: 'finding', icd: ['E55.9'], role: 'secondary' },
  { expect: 'hypocalcemia', tag: 'finding', icd: ['E83.51'], role: 'secondary' },
  { expect: 'iron overload', tag: 'disorder', icd: ['E83.110'], role: 'primary', syn: ['hemochromatosis'] },
  { expect: 'hepatitis', tag: 'disorder', icd: ['K75.9'], role: 'primary' },
  { expect: 'jaundice', tag: 'finding', icd: ['R17'], role: 'secondary' },
  { expect: 'ascites', tag: 'finding', icd: ['R18.8'], role: 'secondary' },
  { expect: 'splenomegaly', tag: 'finding', icd: ['R16.1'], role: 'secondary' },
  { expect: 'cough with fever', tag: 'finding', icd: ['R05.9'], role: 'secondary' },
  { expect: 'wheezing', tag: 'finding', icd: ['R06.2'], role: 'secondary' },
  { expect: 'stridor', tag: 'finding', icd: ['R06.1'], role: 'secondary' },
  { expect: 'hematochezia', tag: 'finding', icd: ['K92.1'], role: 'secondary', syn: ['blood in stool', 'rectal bleeding'] },
  { expect: 'melena', tag: 'finding', icd: ['K92.1'], role: 'secondary' },
  { expect: 'dysuria', tag: 'finding', icd: ['R30.9'], role: 'secondary', syn: ['painful urination'] },
  { expect: 'urinary frequency', tag: 'finding', icd: ['R35.0'], role: 'secondary' },
  { expect: 'urinary incontinence', tag: 'finding', icd: ['R32'], role: 'secondary' },
  { expect: 'acute urinary retention', tag: 'disorder', icd: ['R33.8'], role: 'primary' },
  { expect: 'chronic pain', tag: 'finding', icd: ['G89.29'], role: 'secondary' },
  { expect: 'neck pain', tag: 'finding', icd: ['M54.2'], role: 'secondary', syn: ['cervicalgia'] },
  { expect: 'joint pain', tag: 'finding', icd: ['M25.50'], role: 'secondary', syn: ['arthralgia'] },
  { expect: 'muscle pain', tag: 'finding', icd: ['M79.10'], role: 'secondary', syn: ['myalgia'] },
  { expect: 'numbness', tag: 'finding', icd: ['R20.2'], role: 'secondary', syn: ['paresthesia'] },
  { expect: 'tremor', tag: 'finding', icd: ['R25.1'], role: 'secondary' },
  { expect: 'confusion', tag: 'finding', icd: ['R41.82'], role: 'secondary', syn: ['altered mental status', 'AMS'] },
  { expect: 'memory loss', tag: 'finding', icd: ['R41.3'], role: 'secondary', syn: ['amnesia'] },
  { expect: 'blurred vision', tag: 'finding', icd: ['H53.8'], role: 'secondary' },
  { expect: 'diplopia', tag: 'finding', icd: ['H53.2'], role: 'secondary', syn: ['double vision'] },
  { expect: 'tinnitus', tag: 'finding', icd: ['H93.19'], role: 'secondary' },
  { expect: 'gastrointestinal bleeding', tag: 'disorder', icd: ['K92.2'], role: 'primary', syn: ['GI bleed'] },
  { expect: 'anaphylaxis', tag: 'disorder', icd: ['T78.2XXA'], role: 'primary' },
  { expect: 'allergic rhinitis', tag: 'disorder', icd: ['J30.9'], role: 'primary', syn: ['hay fever'] },
  { expect: 'food allergy', tag: 'disorder', icd: ['Z91.010'], role: 'primary' },
  { expect: 'asthma exacerbation', tag: 'disorder', icd: ['J45.901'], role: 'primary', syn: ['acute asthma'] },
  { expect: 'pneumonia aspiration', tag: 'disorder', icd: ['J69.0'], role: 'primary', syn: ['aspiration pneumonia'] },
  { expect: 'lung abscess', tag: 'disorder', icd: ['J85.2'], role: 'primary' },
  { expect: 'pulmonary hypertension', tag: 'disorder', icd: ['I27.20'], role: 'primary' },
  { expect: 'nicotine dependence', tag: 'disorder', icd: ['F17.200'], role: 'primary', syn: ['smoking dependence', 'tobacco use disorder'] },
  { expect: 'obesity hypoventilation', tag: 'disorder', icd: ['E66.2'], role: 'primary' },
];

/* ------------------------------------------------------------------ */

const STOP = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'due', 'to', 'with', 'in', 'caused', 'by', 'acute', 'unspecified']);
const tokens = (s) =>
  s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((t) => t.length > 1);
const overlap = (label, expect) => {
  const L = new Set(tokens(label));
  const E = tokens(expect);
  if (!E.length) return 0;
  let hit = 0;
  for (const t of E) if (L.has(t) || (t.length > 3 && [...L].some((l) => l.startsWith(t.slice(0, 4))))) hit++;
  return hit / E.length;
};

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * (i + 1));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) {
        await sleep(1000);
        continue;
      }
      return await res.json();
    } catch (e) {
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

const seenIcd = new Map();
async function validateIcd(code) {
  if (!code) return null;
  if (seenIcd.has(code)) return seenIcd.get(code);
  const url = `${NLM}?sf=code,name&max_results=1&terms=${encodeURIComponent(code)}`;
  const rows = await fetchJson(url);
  let pair = null;
  if (Array.isArray(rows) && Array.isArray(rows[3]) && rows[3].length) {
    const [c, n] = rows[3][0];
    if (c && c.toUpperCase() === code.toUpperCase()) pair = { code: c, name: n };
  }
  await sleep(120);
  seenIcd.set(code, pair);
  return pair;
}

async function ols4Term(conceptId) {
  const iri = encodeURIComponent(encodeURIComponent(`http://snomed.info/id/${conceptId}`));
  return fetchJson(`${OLS4_TERM}${iri}`);
}

async function ols4Search(q) {
  const url = `${OLS4_SEARCH}?q=${encodeURIComponent(q)}&ontology=snomed&type=class&size=10`;
  const data = await fetchJson(url);
  return data?.response?.docs ?? [];
}

async function ontoExpand(q) {
  const url = `${ONTO_EXPAND}?url=${encodeURIComponent('http://snomed.info/sct?fhir_vs')}&filter=${encodeURIComponent(q)}&count=5&activeOnly=true`;
  const data = await fetchJson(url);
  return data?.expansion?.contains ?? [];
}

/** Two-stage search: OLS4 literal search, then Ontoserver SNOMED-aware filter. */
async function findConceptBySearch(q) {
  const cand = await ols4Search(q);
  await sleep(200);
  const best = cand.find((d) => overlap(d.label ?? '', q) >= 0.5);
  if (best) {
    const term = await ols4Term(best.short_form.replace('SNOMED_', ''));
    await sleep(220);
    if (term?.label) return { term, via: 'ols4-search' };
  }
  const rows = await ontoExpand(q);
  await sleep(200);
  if (rows.length) {
    const t = await ols4Term(rows[0].code);
    await sleep(220);
    if (t?.label) return { term: t, via: 'ontoserver-expand' };
    // OLS4 may not mirror AU-extension concepts — synthesize from the FHIR result
    if (rows[0].code && rows[0].display) {
      return { term: { label: rows[0].display, short_form: `SNOMED_${rows[0].code}`, annotation: {}, is_obsolete: false }, via: 'ontoserver-only' };
    }
  }
  return null;
}

function extractSynonyms(term) {
  const a = term?.annotation ?? {};
  const out = new Set();
  for (const k of ['alternative label', 'Alternative term', 'synonym']) {
    const v = a[k];
    if (Array.isArray(v)) v.forEach((s) => out.add(s));
    else if (typeof v === 'string') out.add(v);
  }
  return [...out];
}

async function main() {
  const seeds = LIMIT > 0 ? SEEDS.slice(0, LIMIT) : SEEDS;
  const concepts = [];
  const dropped = [];
  let n = 0;

  for (const seed of seeds) {
    n++;
    let term = null;
    let resolvedBy = 'curated-id';

    if (seed.id) {
      term = await ols4Term(seed.id);
      await sleep(220);
      if (term && (term.is_obsolete === true)) term = null;
    }

    if (term && seed.expect) {
      const sc = overlap(term.label ?? '', seed.expect);
      if (sc < STRONG_SCORE) {
        // authoritative label disagrees (or only partially matches) -> resolve the
        // precise concept by search; keep the broad concept only without its ICD map
        const cand = await ols4Search(seed.expect);
        await sleep(200);
        const best = cand.find((d) => overlap(d.label ?? '', seed.expect) >= Math.max(0.5, MIN_SCORE));
        if (best) {
          const preciseId = best.short_form.replace('SNOMED_', '');
          if (preciseId !== seed.id) {
            // keep broad concept (no curated ICD — it belonged to the expectation)
            const { pt: broadPt, tag: broadTag } = splitTag(term.label);
            concepts.push({
              id: seed.id, pt: broadPt,
              synonyms: [...new Set([...extractSynonyms(term)])],
              tag: broadTag ?? seed.tag, role: seed.role ?? 'secondary',
              icd10cm: [], resolvedBy: 'curated-id-broad',
            });
          }
          term = await ols4Term(preciseId);
          await sleep(220);
          resolvedBy = 'search-fallback';
        } else if (sc < MIN_SCORE) {
          dropped.push({ expect: seed.expect, id: seed.id, reason: `label mismatch: "${term.label}" (score ${sc.toFixed(2)})` });
          term = null;
        }
        // else: acceptable partial match (>=MIN_SCORE) — keep with curated ICD
      }
    } else if (!term && seed.expect) {
      // curated id was 404/obsolete -> resolve by search chain
      const hit = await findConceptBySearch(seed.expect);
      if (hit) {
        term = hit.term;
        resolvedBy = hit.via;
      }
    } else {
      const hit = await findConceptBySearch(seed.expect);
      if (hit) {
        term = hit.term;
        resolvedBy = hit.via;
      }
    }

    if (!term || !term.label) {
      if (!dropped.find((d) => d.expect === seed.expect)) dropped.push({ expect: seed.expect, id: seed.id ?? null, reason: 'not found' });
      continue;
    }

    const conceptId = (term.short_form || '').replace('SNOMED_', '');
    const { pt: cleanPt, tag: labelTag } = splitTag(term.label);
    const icdTargets = [];
    for (const code of seed.icd ?? []) {
      const v = await validateIcd(code);
      if (v) icdTargets.push(v);
      else dropped.push({ expect: seed.expect, id: conceptId, reason: `ICD-10-CM code not in NLM index: ${code}` });
    }

    concepts.push({
      id: conceptId,
      pt: cleanPt,
      fsn: term.label,
      synonyms: [...new Set([...extractSynonyms(term), ...(seed.syn ?? [])])],
      tag: labelTag ?? seed.tag,
      role: seed.role ?? 'secondary',
      icd10cm: icdTargets,
      resolvedBy,
    });
    if (n % 15 === 0) console.log(`  ... ${n}/${seeds.length} seeds processed`);
  }

  // de-duplicate by concept id; prefer entries that carry an ICD map
  const byId = new Map();
  for (const c of concepts) {
    const prev = byId.get(c.id);
    if (!prev || (c.icd10cm.length > 0 && prev.icd10cm.length === 0) || (c.resolvedBy === 'curated-id' && prev.resolvedBy !== 'curated-id')) {
      if (prev) c.synonyms = [...new Set([...c.synonyms, ...prev.synonyms])];
      byId.set(c.id, c);
    } else {
      prev.synonyms = [...new Set([...prev.synonyms, ...c.synonyms])];
    }
  }
  const final = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  const out = {
    meta: {
      builtAt: new Date().toISOString(),
      what: 'Embedded SNOMED CT subset for offline demo coding (curated seed, server-validated)',
      snomedEdition: 'SNOMED CT International Edition — validated via EBI OLS4 (mirror of the international release); search fallback via CSIRO Ontoserver (AU edition, superset of international)',
      icdTarget: 'ICD-10-CM — code targets curated, then validated against NLM Clinical Table Search Service (icd10cm v3)',
      mapRefsetProduction: 'For production regenerate from the official "SNOMED CT to ICD-10-CM extended map" refset (60206000) using a local Snowstorm instance (see integration guide).',
      license: 'SNOMED CT is licensed material — deployment requires an appropriate license (e.g., SNOMED International affiliate/member, or US NLM UMLS license).',
      conceptCount: final.length,
      droppedCount: dropped.length,
      withIcdMap: final.filter((c) => c.icd10cm.length > 0).length,
    },
    concepts: final,
  };

  const fs = await import('node:fs');
  const path = await import('node:path');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`\n✅ wrote ${OUT}`);
  console.log(`   concepts: ${final.length}  withICD: ${out.meta.withIcdMap}  dropped: ${dropped.length}`);
  if (dropped.length) {
    console.log('\nDropped (first 25):');
    for (const d of dropped.slice(0, 25)) console.log(`  - [${d.id ?? '-'}] ${d.expect}: ${d.reason}`);
  }
}

main().catch((e) => {
  console.error('BUILD FAILED:', e);
  process.exit(1);
});
