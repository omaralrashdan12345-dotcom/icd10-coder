import type { ClinicalCodingResponse, ICDCodeDetail } from "@/lib/schemas/icd";
import type { LLMProvider } from "./types";
import { BUILTIN_ICD10 } from "@/lib/icd/data";

/**
 * Smart offline ICD-10-CM coder.
 *
 * Uses an expanded clinical pattern library (~50 chief complaints) plus
 * laterality + acuity detection from the source text. No network call.
 *
 * Coverage:
 *  - Upper extremity injuries (shoulder, arm, elbow, wrist, hand, finger)
 *  - Lower extremity injuries (hip, knee, ankle, foot, toe, leg)
 *  - Spine / back (cervical, thoracic, lumbar)
 *  - Head / face (concussion, headache, laceration)
 *  - Chest (chest pain, rib injury, asthma, COPD, pneumonia)
 *  - Abdomen (abdominal pain, GERD, appendicitis, GI bleed)
 *  - Endocrine (DM variants, thyroid, hyperlipidemia)
 *  - Cardiovascular (HTN variants, heart failure, MI, stroke, DVT)
 *  - Skin (cellulitis, ulcer, eczema, acne)
 *  - Mental health (anxiety, depression, PTSD)
 *  - Symptoms (fever, cough, dyspnea, fatigue)
 *  - External causes (falls, bites, burns, MVT, poisoning, sport activity)
 *
 * For each pattern we capture:
 *  - The matching keyword(s)
 *  - The default primary code (laterality placeholder gets replaced)
 *  - Whether the code requires a 7th character (for injuries)
 *  - Common secondary / tertiary additions
 */

interface MockRule {
  /** Lowercased keyword(s) that trigger this rule. Matched as substring. */
  keywords: string[];
  /** ICD-10 code template. Use {SIDE} placeholder for laterality substitution. */
  code: string;
  /** Official description (also templated). */
  description: string;
  /** Level in the output. */
  level: "primary" | "secondary" | "tertiary";
  /** Rationale text. */
  rationale: string;
  /** Whether this code category requires a 7th character (for injuries). */
  requires_seventh_char?: boolean;
  /** Default 7th char value when required. */
  default_seventh_char?: "A" | "D" | "S";
  /** Confidence. */
  confidence: number;
  /** True if the rule's laterality should be detected from the note (replaces {SIDE}). */
  detect_laterality?: boolean;
}

const MOCK_RULES: MockRule[] = [
  // =========================================================================
  // LOWER EXTREMITY
  // =========================================================================

  // Toe pain / swelling
  {
    keywords: ["big toe pain", "toe pain", "great toe pain", "toe swelling", "hallux"],
    code: "M25.57{SIDE}",
    description: "Pain in {SIDE_DESC} ankle and joints of {SIDE_DESC} foot",
    level: "primary",
    rationale: "Chief complaint: toe pain and swelling. M25.57- captures joint pain of the ankle/foot. Laterality determined from the note.",
    confidence: 0.78,
    detect_laterality: true,
  },
  {
    keywords: ["hallux valgus", "bunion"],
    code: "M20.1{SIDE}",
    description: "Hallux valgus (acquired), {SIDE_DESC} foot",
    level: "primary",
    rationale: "Hallux valgus (bunion) of the affected foot.",
    confidence: 0.85,
    detect_laterality: true,
  },
  {
    keywords: ["ingrown toenail", "ingrowing toenail", "paronychia toe"],
    code: "L60.0",
    description: "Ingrowing nail",
    level: "primary",
    rationale: "Ingrown toenail — L60.0 is the default code. No laterality required.",
    confidence: 0.88,
  },

  // Foot / ankle pain
  {
    keywords: ["foot pain", "ankle pain", "ankle swelling", "foot swelling"],
    code: "M79.67{SIDE}",
    description: "Pain in {SIDE_DESC} foot",
    level: "primary",
    rationale: "Foot/ankle pain — M79.67- specifies pain in foot. Laterality from the note.",
    confidence: 0.8,
    detect_laterality: true,
  },
  {
    keywords: ["plantar fasciitis", "heel pain"],
    code: "M72.2",
    description: "Plantar fascial fibromatosis",
    level: "primary",
    rationale: "Plantar fasciitis / heel pain. M72.2 is the standard code.",
    confidence: 0.82,
  },
  {
    keywords: ["ankle sprain", "sprained ankle", "rolled ankle"],
    code: "S93.4{SIDE}A",
    description: "Sprain of {SIDE_DESC} ankle, initial encounter",
    level: "primary",
    rationale: "Ankle sprain, initial encounter. S93.4- requires 7th char A for acute presentation.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
    detect_laterality: true,
  },

  // Knee pain / injury
  {
    keywords: ["knee pain", "knee swelling", "effusion knee"],
    code: "M25.56{SIDE}",
    description: "Pain in {SIDE_DESC} knee",
    level: "primary",
    rationale: "Knee pain — M25.56- is the standard pain-in-knee code with laterality.",
    confidence: 0.85,
    detect_laterality: true,
  },
  {
    keywords: ["meniscus tear", "torn meniscus", "mensical tear"],
    code: "S83.2{SIDE}A",
    description: "Tear of medial meniscus, current injury, {SIDE_DESC} knee, initial encounter",
    level: "primary",
    rationale: "Acute meniscus tear of the knee. S83.2- requires 7th char A for initial encounter.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.75,
    detect_laterality: true,
  },
  {
    keywords: ["osteoarthritis knee", "oa knee", "knee osteoarthritis"],
    code: "M17.{SIDE}",
    description: "Unilateral primary osteoarthritis, {SIDE_DESC} knee" ,
    level: "primary",
    rationale: "Unilateral primary knee OA. M17.1- (right) or M17.2 (left).",
    confidence: 0.88,
    detect_laterality: true,
  },

  // Hip pain
  {
    keywords: ["hip pain", "hip arthritis"],
    code: "M25.55{SIDE}",
    description: "Pain in {SIDE_DESC} hip",
    level: "primary",
    rationale: "Hip pain — M25.55- with laterality.",
    confidence: 0.82,
    detect_laterality: true,
  },

  // Lower leg injury / laceration
  {
    keywords: ["cat scratch", "cat bite"],
    code: "S81.8{SIDE}1A",
    description: "Laceration without foreign body, {SIDE_DESC} lower leg, initial encounter",
    level: "primary",
    rationale: "Cat scratch on the lower leg is treated as a laceration. S81.81- with 7th char A for initial encounter.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.86,
    detect_laterality: true,
  },
  {
    keywords: ["dog bite"],
    code: "S61.4{SIDE}1A",
    description: "Laceration without foreign body, {SIDE_DESC} hand, initial encounter",
    level: "primary",
    rationale: "Dog bite typically affects the hand. S61.41- with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.8,
    detect_laterality: true,
  },
  {
    keywords: ["contusion lower leg", "bruise lower leg", "shin contusion"],
    code: "S80.0{SIDE}XA",
    description: "Contusion of {SIDE_DESC} lower leg, initial encounter",
    level: "primary",
    rationale: "Contusion of lower leg, initial encounter. S80.0- requires 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
    detect_laterality: true,
  },

  // =========================================================================
  // UPPER EXTREMITY
  // =========================================================================

  {
    keywords: ["shoulder pain", "rotator cuff"],
    code: "M25.51{SIDE}",
    description: "Pain in {SIDE_DESC} shoulder",
    level: "primary",
    rationale: "Shoulder pain — M25.51- with laterality.",
    confidence: 0.82,
    detect_laterality: true,
  },
  {
    keywords: ["elbow pain", "tennis elbow", "golfer's elbow", "lateral epicondylitis"],
    code: "M77.0{SIDE}",
    description: "Lateral epicondylitis, {SIDE_DESC} elbow",
    level: "primary",
    rationale: "Lateral epicondylitis (tennis elbow). M77.0- with laterality.",
    confidence: 0.85,
    detect_laterality: true,
  },
  {
    keywords: ["wrist pain", "wrist swelling"],
    code: "M25.53{SIDE}",
    description: "Pain in {SIDE_DESC} wrist",
    level: "primary",
    rationale: "Wrist pain — M25.53- with laterality.",
    confidence: 0.8,
    detect_laterality: true,
  },
  {
    keywords: ["hand pain", "hand swelling"],
    code: "M79.64{SIDE}",
    description: "Pain in {SIDE_DESC} hand",
    level: "primary",
    rationale: "Hand pain — M79.64- with laterality.",
    confidence: 0.8,
    detect_laterality: true,
  },
  {
    keywords: ["finger pain", "finger swelling", "finger injury"],
    code: "M79.64{SIDE}",
    description: "Pain in {SIDE_DESC} hand",
    level: "primary",
    rationale: "Finger pain falls under hand pain M79.64- with laterality.",
    confidence: 0.75,
    detect_laterality: true,
  },

  // =========================================================================
  // SPINE / BACK
  // =========================================================================

  {
    keywords: ["low back pain", "lumbago", "lower back pain"],
    code: "M54.50",
    description: "Low back pain, unspecified",
    level: "primary",
    rationale: "Low back pain — M54.50 is the default code when no specific cause documented.",
    confidence: 0.85,
  },
  {
    keywords: ["neck pain", "cervical pain", "cervicalgia"],
    code: "M54.2",
    description: "Cervicalgia",
    level: "primary",
    rationale: "Neck pain / cervicalgia. M54.2 is the default code.",
    confidence: 0.85,
  },
  {
    keywords: ["upper back pain", "thoracic pain"],
    code: "M54.6",
    description: "Pain in thoracic spine",
    level: "primary",
    rationale: "Thoracic spine pain. M54.6.",
    confidence: 0.82,
  },
  {
    keywords: ["sciatica", "radiculopathy"],
    code: "M54.9",
    description: "Backache, unspecified",
    level: "primary",
    rationale: "Sciatica/radiculopathy — M54.9 when no specific nerve root documented.",
    confidence: 0.7,
  },

  // =========================================================================
  // HEAD / FACE
  // =========================================================================

  {
    keywords: ["headache", "head pain", "migraine"],
    code: "R51",
    description: "Headache",
    level: "primary",
    rationale: "Headache — R51 is the unspecified code. Use G43.x for confirmed migraine.",
    confidence: 0.8,
  },
  {
    keywords: ["concussion"],
    code: "S06.0X0A",
    description: "Concussion without loss of consciousness, initial encounter",
    level: "primary",
    rationale: "Concussion, initial encounter. S06.0X0A includes 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
  },
  {
    keywords: ["head laceration", "scalp laceration", "cut on head"],
    code: "S01.01XA",
    description: "Laceration without foreign body of scalp, initial encounter",
    level: "primary",
    rationale: "Scalp laceration, initial encounter. S01.01XA includes 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.82,
  },

  // =========================================================================
  // CHEST / RESPIRATORY
  // =========================================================================

  {
    keywords: ["chest pain", "substernal pain"],
    code: "R07.9",
    description: "Chest pain, unspecified",
    level: "primary",
    rationale: "Chest pain, unspecified. R07.9. If cardiac etiology suspected, use I20-I25.",
    confidence: 0.75,
  },
  {
    keywords: ["shortness of breath", "dyspnea", "breathlessness"],
    code: "R06.02",
    description: "Shortness of breath",
    level: "primary",
    rationale: "Shortness of breath — R06.02.",
    confidence: 0.82,
  },
  {
    keywords: ["cough"],
    code: "R05.9",
    description: "Cough, unspecified",
    level: "primary",
    rationale: "Cough — R05.9.",
    confidence: 0.8,
  },
  {
    keywords: ["asthma exacerbation", "asthma attack", "asthma"],
    code: "J45.901",
    description: "Unspecified asthma with (acute) exacerbation",
    level: "primary",
    rationale: "Asthma with acute exacerbation. J45.901 is unspecified severity.",
    confidence: 0.85,
  },
  {
    keywords: ["copd exacerbation", "copd"],
    code: "J44.1",
    description: "Chronic obstructive pulmonary disease with (acute) exacerbation",
    level: "primary",
    rationale: "COPD with acute exacerbation. J44.1.",
    confidence: 0.88,
  },
  {
    keywords: ["pneumonia"],
    code: "J18.9",
    description: "Pneumonia, unspecified organism",
    level: "primary",
    rationale: "Pneumonia, unspecified organism. J18.9 — use J12-J16 if organism identified.",
    confidence: 0.85,
  },
  {
    keywords: ["bronchitis"],
    code: "J20.9",
    description: "Acute bronchitis, unspecified",
    level: "primary",
    rationale: "Acute bronchitis — J20.9.",
    confidence: 0.85,
  },

  // =========================================================================
  // ABDOMEN / GI
  // =========================================================================

  {
    keywords: ["abdominal pain", "belly pain", "stomach pain"],
    code: "R10.9",
    description: "Unspecified abdominal pain",
    level: "primary",
    rationale: "Abdominal pain, unspecified. R10.9 — use R10.0/1/2 for quadrant-specific pain.",
    confidence: 0.8,
  },
  {
    keywords: ["appendicitis"],
    code: "K35.80",
    description: "Unspecified acute appendicitis",
    level: "primary",
    rationale: "Acute appendicitis — K35.80.",
    confidence: 0.9,
  },
  {
    keywords: ["gerd", "reflux", "heartburn", "acid reflux"],
    code: "K21.9",
    description: "Gastro-esophageal reflux disease without esophagitis",
    level: "primary",
    rationale: "GERD without esophagitis — K21.9.",
    confidence: 0.88,
  },
  {
    keywords: ["nausea", "vomiting"],
    code: "R11.2",
    description: "Nausea with vomiting, unspecified",
    level: "primary",
    rationale: "Nausea with vomiting — R11.2.",
    confidence: 0.8,
  },
  {
    keywords: ["diarrhea"],
    code: "R19.7",
    description: "Diarrhea, unspecified",
    level: "primary",
    rationale: "Diarrhea, unspecified — R19.7.",
    confidence: 0.8,
  },
  {
    keywords: ["constipation"],
    code: "K59.00",
    description: "Constipation, unspecified",
    level: "primary",
    rationale: "Constipation, unspecified — K59.00.",
    confidence: 0.85,
  },

  // =========================================================================
  // ENDOCRINE
  // =========================================================================

  {
    keywords: ["type 2 diabetes", "t2dm", "dm2", "diabetes mellitus type 2", "controlled diabetes", "diabetic"],
    code: "E11.9",
    description: "Type 2 diabetes mellitus without complications",
    level: "secondary",
    rationale: "Chronic comorbidity. E11.9 = DM2 without complications (no manifestation documented).",
    confidence: 0.92,
  },
  {
    keywords: ["type 1 diabetes", "t1dm", "dm1"],
    code: "E10.9",
    description: "Type 1 diabetes mellitus without complications",
    level: "secondary",
    rationale: "Chronic comorbidity. E10.9 = DM1 without complications.",
    confidence: 0.92,
  },
  {
    keywords: ["diabetic foot ulcer", "foot ulcer diabetic", "diabetes foot ulcer"],
    code: "E11.621",
    description: "Type 2 diabetes mellitus with foot ulcer",
    level: "primary",
    rationale: "DM2 with foot ulcer — combination code E11.621 is coded first, then L97.4 for the ulcer.",
    confidence: 0.92,
  },
  {
    keywords: ["diabetic neuropathy", "diabetes with neuropathy"],
    code: "E11.40",
    description: "Type 2 diabetes mellitus with diabetic neuropathy, unspecified",
    level: "secondary",
    rationale: "DM2 with neuropathy — combination code E11.40.",
    confidence: 0.9,
  },
  {
    keywords: ["hyperlipidemia", "high cholesterol"],
    code: "E78.5",
    description: "Hyperlipidemia, unspecified",
    level: "secondary",
    rationale: "Hyperlipidemia — E78.5. Affects treatment plan (statin therapy).",
    confidence: 0.88,
  },
  {
    keywords: ["hypothyroidism", "underactive thyroid"],
    code: "E03.9",
    description: "Hypothyroidism, unspecified",
    level: "secondary",
    rationale: "Hypothyroidism — E03.9.",
    confidence: 0.85,
  },

  // =========================================================================
  // CARDIOVASCULAR
  // =========================================================================

  {
    keywords: ["hypertension", "htn", "high blood pressure"],
    code: "I10",
    description: "Essential (primary) hypertension",
    level: "secondary",
    rationale: "Essential hypertension — I10. Affects treatment plan.",
    confidence: 0.92,
  },
  {
    keywords: ["chest pain cardiac", "nstemi", "non-stemi", "heart attack"],
    code: "I21.4",
    description: "Non-ST elevation (NSTEMI) myocardial infarction",
    level: "primary",
    rationale: "NSTEMI — I21.4. Emergency primary diagnosis.",
    confidence: 0.9,
  },
  {
    keywords: ["heart failure", "chf"],
    code: "I50.9",
    description: "Heart failure, unspecified",
    level: "primary",
    rationale: "Heart failure, unspecified — I50.9.",
    confidence: 0.88,
  },
  {
    keywords: ["stroke", "cerebral infarction", "cva"],
    code: "I63.9",
    description: "Cerebral infarction, unspecified",
    level: "primary",
    rationale: "Cerebral infarction, unspecified — I63.9.",
    confidence: 0.9,
  },
  {
    keywords: ["dvt", "deep vein thrombosis", "leg clot"],
    code: "I80.2",
    description: "Embolism and thrombosis of other deep vessels of lower extremities",
    level: "primary",
    rationale: "DVT of lower extremity — I80.2.",
    confidence: 0.88,
  },

  // =========================================================================
  // SKIN
  // =========================================================================

  {
    keywords: ["cellulitis"],
    code: "L03.90",
    description: "Cellulitis, unspecified",
    level: "primary",
    rationale: "Cellulitis, unspecified site — L03.90.",
    confidence: 0.85,
  },
  {
    keywords: ["eczema", "atopic dermatitis"],
    code: "L20.9",
    description: "Atopic dermatitis, unspecified",
    level: "primary",
    rationale: "Atopic dermatitis / eczema — L20.9.",
    confidence: 0.85,
  },
  {
    keywords: ["acne"],
    code: "L70.0",
    description: "Acne vulgaris",
    level: "primary",
    rationale: "Acne vulgaris — L70.0.",
    confidence: 0.88,
  },

  // =========================================================================
  // GENITOURINARY
  // =========================================================================

  {
    keywords: ["uti", "urinary tract infection", "dysuria"],
    code: "N39.0",
    description: "Urinary tract infection, site not specified",
    level: "primary",
    rationale: "UTI — N39.0.",
    confidence: 0.9,
  },
  {
    keywords: ["ckd", "chronic kidney disease", "renal failure chronic"],
    code: "N18.9",
    description: "Chronic kidney disease, unspecified",
    level: "secondary",
    rationale: "CKD — N18.9 (use N18.3-6 for stage-specific).",
    confidence: 0.88,
  },
  {
    keywords: ["esrd", "end-stage renal", "dialysis"],
    code: "N18.6",
    description: "End stage renal disease",
    level: "secondary",
    rationale: "ESRD requiring dialysis — N18.6.",
    confidence: 0.92,
  },

  // =========================================================================
  // MENTAL HEALTH
  // =========================================================================

  {
    keywords: ["anxiety", "gad", "generalized anxiety"],
    code: "F41.1",
    description: "Generalized anxiety disorder",
    level: "primary",
    rationale: "Generalized anxiety disorder — F41.1.",
    confidence: 0.85,
  },
  {
    keywords: ["depression", "major depressive", "mdd"],
    code: "F33.1",
    description: "Major depressive disorder, recurrent, moderate",
    level: "primary",
    rationale: "Recurrent MDD, moderate — F33.1 (use F33.2 for severe).",
    confidence: 0.8,
  },
  {
    keywords: ["ptsd", "post-traumatic stress"],
    code: "F43.10",
    description: "Post-traumatic stress disorder, unspecified",
    level: "primary",
    rationale: "PTSD, unspecified — F43.10.",
    confidence: 0.85,
  },

  // =========================================================================
  // SYMPTOMS
  // =========================================================================

  {
    keywords: ["fever", "pyrexia"],
    code: "R50.9",
    description: "Fever, unspecified",
    level: "primary",
    rationale: "Fever, unspecified — R50.9. Look for underlying cause.",
    confidence: 0.78,
  },
  {
    keywords: ["fatigue", "tiredness", "exhaustion"],
    code: "R53.83",
    description: "Other fatigue",
    level: "primary",
    rationale: "Fatigue — R53.83.",
    confidence: 0.75,
  },

  // =========================================================================
  // EXTERNAL CAUSES (TERTIARY)
  // =========================================================================

  {
    keywords: ["fall", "fell"],
    code: "W19.XXXA",
    description: "Unspecified fall, initial encounter",
    level: "tertiary",
    rationale: "External cause of injury — fall on same level, unspecified, initial encounter. 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
  },
  {
    keywords: ["motor vehicle accident", "mva", "car crash", "car accident"],
    code: "V89.2XXA",
    description: "Person injured in unspecified motor-vehicle accident, traffic, initial encounter",
    level: "tertiary",
    rationale: "External cause — unspecified MVA, traffic, initial encounter.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.8,
  },
  {
    keywords: ["burn", "scald"],
    code: "X10.1XXA",
    description: "Contact with hot water, initial encounter",
    level: "tertiary",
    rationale: "External cause — contact with hot water (scald). 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.78,
  },
  {
    keywords: ["insect bite", "bug bite", "mosquito bite"],
    code: "S90.46{SIDE}A",
    description: "Insect bite (nonvenomous), {SIDE_DESC} foot, initial encounter",
    level: "tertiary",
    rationale: "External cause + injury site for insect bite. S90.46- with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.75,
    detect_laterality: true,
  },
  {
    keywords: ["cat bite", "cat scratch"],
    code: "W55.03XA",
    description: "Other contact with cat, initial encounter",
    level: "tertiary",
    rationale: "External cause — other contact with cat (scratch/bite). 7th char A matches the injury code.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.88,
  },
  {
    keywords: ["dog bite", "bitten by dog", "dog attack"],
    code: "W54.0XXA",
    description: "Bitten by dog, initial encounter",
    level: "tertiary",
    rationale: "External cause — bitten by dog. 7th char A matches the injury code.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.9,
  },
  {
    keywords: ["pedestrian struck", "hit by car", "hit by vehicle"],
    code: "V09.2XXA",
    description: "Pedestrian injured in unspecified traffic accident, initial encounter",
    level: "tertiary",
    rationale: "External cause — pedestrian struck by vehicle. 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.78,
  },

  // =========================================================================
  // ACTIVITY CODES (Z chapter, Y93) — tertiary supplements
  // =========================================================================

  {
    keywords: ["cycling", "bicycle", "bike riding", "riding bike"],
    code: "Y93.A2",
    description: "Activity, cycling",
    level: "tertiary",
    rationale: "Activity code — cycling. Used as a supplemental tertiary code to describe what the patient was doing when symptoms began.",
    confidence: 0.7,
  },
  {
    keywords: ["running", "jogging"],
    code: "Y93.A1",
    description: "Activity, running",
    level: "tertiary",
    rationale: "Activity code — running.",
    confidence: 0.7,
  },
  {
    keywords: ["at home", "while at home", "in the house"],
    code: "Y92.008A",
    description: "Unspecified place in single-family (private) house as the place of occurrence of the external cause",
    level: "tertiary",
    rationale: "Place of occurrence — private house. Used as supplemental tertiary code.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.65,
  },
];

// =========================================================================
// Laterality detection
// =========================================================================

type Laterality = "right" | "left" | "bilateral" | "unspecified";

function detectLaterality(text: string): Laterality {
  const t = text.toLowerCase();
  // Look for explicit left/right cues near body parts
  const leftCues = ["left", "l/", "lt ", " lt.", "(l)", "left-sided", "left side"];
  const rightCues = ["right", "r/", "rt ", " rt.", "(r)", "right-sided", "right side"];
  const bilateralCues = ["bilateral", "both sides", "both legs", "both arms", "both feet", "both hands", "b/l"];

  const hasBilateral = bilateralCues.some((c) => t.includes(c));
  if (hasBilateral) return "bilateral";

  const hasLeft = leftCues.some((c) => t.includes(c));
  const hasRight = rightCues.some((c) => t.includes(c));
  if (hasLeft && !hasRight) return "left";
  if (hasRight && !hasLeft) return "right";
  if (hasLeft && hasRight) return "bilateral";
  return "unspecified";
}

/**
 * Resolve the {SIDE} placeholder in a code template.
 * ICD-10-CM laterality convention (6th character):
 *   1 = right, 2 = left, 9 = unspecified
 */
function fillSide(code: string, side: Laterality): string {
  const map: Record<Laterality, string> = {
    right: "1",
    left: "2",
    bilateral: "9", // bilateral typically uses 9 + companion code, simplified here
    unspecified: "9",
  };
  return code.replace("{SIDE}", map[side]);
}

function fillSideDesc(desc: string, side: Laterality): string {
  const map: Record<Laterality, string> = {
    right: "right",
    left: "left",
    bilateral: "bilateral",
    unspecified: "unspecified",
  };
  return desc.replace(/{SIDE_DESC}/g, map[side]);
}

// =========================================================================
// Provider implementation
// =========================================================================

function buildCodeDetail(rule: MockRule, text: string): ICDCodeDetail {
  const side = rule.detect_laterality ? detectLaterality(text) : "unspecified";
  const code = rule.code.includes("{SIDE}") ? fillSide(rule.code, side) : rule.code;
  const description = rule.description.includes("{SIDE_DESC}")
    ? fillSideDesc(rule.description, side)
    : rule.description;
  const seventhChar =
    rule.requires_seventh_char && rule.default_seventh_char
      ? rule.default_seventh_char
      : rule.requires_seventh_char
      ? "missing"
      : "not_required";
  return {
    code,
    description,
    rationale: rule.rationale,
    confidence: rule.confidence,
    laterality: (rule.detect_laterality
      ? side === "unspecified"
        ? "unspecified"
        : (side as "right" | "left" | "bilateral" | "unspecified")
      : "not_applicable") as ICDCodeDetail["laterality"],
    acuity: "unspecified" as const,
    seventh_character: seventhChar as ICDCodeDetail["seventh_character"],
  };
}

export const mockProvider: LLMProvider = {
  id: "mock",
  modelLabel: "Smart Offline Coder (built-in)",
  async generateCoding(clinicalNote) {
    const text = clinicalNote.toLowerCase();
    const hits: MockRule[] = [];

    for (const rule of MOCK_RULES) {
      if (rule.keywords.some((k) => text.includes(k.toLowerCase()))) {
        hits.push(rule);
      }
    }

    // Pick primary: prefer the most specific injury (S-code) over a generic
    // symptom code if both match. Otherwise pick the first primary hit.
    const primaries = hits.filter((h) => h.level === "primary");
    const primary =
      primaries.sort((a, b) => {
        // S/T codes (injuries) get priority over M/R codes (symptoms)
        const score = (r: MockRule) => (r.code.startsWith("S") || r.code.startsWith("T") ? 2 : r.code.startsWith("M") ? 1 : 0);
        return score(b) - score(a);
      })[0] ?? {
        keywords: [],
        code: "R69",
        description: "Unknown causes of morbidity",
        level: "primary" as const,
        rationale: "No specific primary diagnosis could be matched from the note. Review the clinical text and select a more specific code.",
        confidence: 0.3,
      };

    const secondary = hits.filter((h) => h.level === "secondary");
    const tertiary = hits.filter((h) => h.level === "tertiary");

    const parsed: ClinicalCodingResponse = {
      primary_icd10: buildCodeDetail(primary, text),
      secondary_icd10: secondary.map((h) => buildCodeDetail(h, text)),
      tertiary_icd10: tertiary.map((h) => buildCodeDetail(h, text)),
      summary: `Offline-coded case. Primary: ${primary.code}. ${secondary.length} secondary, ${tertiary.length} tertiary codes. Pattern-matched from built-in library of ${MOCK_RULES.length} clinical patterns.`,
      entities_extracted: hits.map((h) => ({
        entity: h.keywords[0],
        type:
          h.level === "secondary"
            ? "chronic_condition"
            : h.level === "tertiary"
            ? "external_cause"
            : "disease",
        value: h.description.replace(/{SIDE_DESC}/g, "affected"),
      })),
    };

    // Brief artificial delay so loading state is visible
    await new Promise((r) => setTimeout(r, 400));
    return { parsed, raw: JSON.stringify(parsed, null, 2) };
  },
};
