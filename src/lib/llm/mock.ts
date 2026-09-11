import type { ClinicalCodingResponse, ICDCodeDetail } from "@/lib/schemas/icd";
import type { LLMProvider } from "./types";
import { CHRONIC_CONDITION_MATCHERS } from "@/lib/icd/chronic-conditions";
import { keywordPresentNotNegated } from "@/lib/icd/validation";

/**
 * Smart offline ICD-10-CM coder (v0.3).
 *
 * No network call. Key intelligence:
 *  - Negation-aware matching: "no fever" / "denies chest pain" never codes
 *  - Chronic comorbidity library (~35 matchers) guarantees Secondary
 *    Diagnoses are populated per UHDDS "other diagnoses" rules
 *  - Combo logic: diabetic foot ulcer -> E11.621 code-first; HTN + CKD ->
 *    I12.- combination; diabetes refinement by complication (E11.40/65/22…)
 *  - Encounter-timing detection drives the 7th character (A/D/S)
 *  - Acuity detection (acute / chronic / acute-on-chronic)
 *  - Laterality detection with ICD-10-CM 6th-character substitution
 *  - RAG-context boost: rules whose code family appears in RAG rank higher
 */

interface MockRule {
  /** Lowercased keyword(s) that trigger this rule. Matched negation-aware. */
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
  /** Extra base score for primary-selection ranking (default 0). */
  boost?: number;
}

const MOCK_RULES: MockRule[] = [
  // =========================================================================
  // LOWER EXTREMITY
  // =========================================================================
  {
    keywords: ["big toe pain", "toe pain", "great toe pain", "toe swelling", "hallux"],
    code: "M25.57{SIDE}",
    description: "Pain in joints of {SIDE_DESC} ankle and foot",
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
    code: "S93.40{SIDE}A",
    description: "Unspecified sprain of {SIDE_DESC} ankle, initial encounter",
    level: "primary",
    rationale: "Ankle sprain, initial encounter. S93.4- requires 7th char A for acute presentation.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
    detect_laterality: true,
  },
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
    code: "S83.24{SIDE}A",
    description: "Tear of medial meniscus, current injury, {SIDE_DESC} knee, initial encounter",
    level: "primary",
    rationale: "Acute meniscus tear of the knee. S83.2- requires 7th char A for initial encounter.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.75,
    detect_laterality: true,
  },
  {
    keywords: ["osteoarthritis knee", "oa knee", "knee osteoarthritis", "arthritis knee"],
    code: "M17.1{SIDE}",
    description: "Unilateral primary osteoarthritis, {SIDE_DESC} knee",
    level: "primary",
    rationale: "Unilateral primary knee OA. M17.1- (right) or M17.12 (left).",
    confidence: 0.88,
    detect_laterality: true,
  },
  {
    keywords: ["bilateral knee osteoarthritis", "bilateral knee oa"],
    code: "M17.0",
    description: "Bilateral primary osteoarthritis of knee",
    level: "primary",
    rationale: "Bilateral primary knee OA is coded M17.0.",
    confidence: 0.88,
  },
  {
    keywords: ["hip pain", "hip arthritis"],
    code: "M25.55{SIDE}",
    description: "Pain in {SIDE_DESC} hip",
    level: "primary",
    rationale: "Hip pain — M25.55- with laterality.",
    confidence: 0.82,
    detect_laterality: true,
  },
  {
    keywords: ["cat scratch", "cat bite", "scratched by cat"],
    code: "S81.81{SIDE}A",
    description: "Laceration without foreign body, {SIDE_DESC} lower leg, initial encounter",
    level: "primary",
    rationale: "Cat scratch/bite on the lower leg is treated as a laceration. S81.81- with 7th char A for initial encounter.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.86,
    detect_laterality: true,
  },
  {
    keywords: ["dog bite left hand", "dog bite right hand", "dog bite on left hand", "dog bite on right hand", "dog bite hand"],
    code: "S61.41{SIDE}A",
    description: "Laceration without foreign body, {SIDE_DESC} hand, initial encounter",
    level: "primary",
    rationale: "Dog bite to the hand. S61.41- with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.82,
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
  {
    keywords: ["leg pain"],
    code: "M79.60{SIDE}",
    description: "Pain in {SIDE_DESC} leg",
    level: "primary",
    rationale: "Leg pain — M79.60- with laterality from the note.",
    confidence: 0.78,
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
    rationale: "Shoulder pain — M25.51- with laterality from the note.",
    confidence: 0.8,
    detect_laterality: true,
  },
  {
    keywords: ["rotator cuff tear", "rotator cuff rupture"],
    code: "M75.100",
    description: "Unspecified rotator cuff tear or rupture of unspecified shoulder, not specified as traumatic",
    level: "primary",
    rationale: "Rotator cuff tear — M75.100 is the unspecified tear code.",
    confidence: 0.75,
  },
  {
    keywords: ["shoulder impingement"],
    code: "M75.4{SIDE}",
    description: "Impingement syndrome of {SIDE_DESC} shoulder",
    level: "primary",
    rationale: "Shoulder impingement syndrome with laterality.",
    confidence: 0.85,
    detect_laterality: true,
  },
  {
    keywords: ["arm pain", "upper arm pain"],
    code: "M79.63{SIDE}",
    description: "Pain in {SIDE_DESC} arm",
    level: "primary",
    rationale: "Arm pain — M79.63- with laterality.",
    confidence: 0.78,
    detect_laterality: true,
  },
  {
    keywords: ["elbow pain", "tennis elbow", "lateral epicondylitis"],
    code: "M25.52{SIDE}",
    description: "Pain in {SIDE_DESC} elbow",
    level: "primary",
    rationale: "Elbow pain — M25.52- with laterality from the note.",
    confidence: 0.78,
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
    keywords: ["carpal tunnel"],
    code: "G56.0{SIDE}",
    description: "Postmononeuropathy (carpal tunnel) of {SIDE_DESC} upper limb",
    level: "primary",
    rationale: "Carpal tunnel syndrome — G56.0- with laterality (G56.00 when unspecified).",
    confidence: 0.85,
    detect_laterality: true,
  },
  {
    keywords: ["hand pain"],
    code: "M25.54{SIDE}",
    description: "Pain in joints of {SIDE_DESC} hand",
    level: "primary",
    rationale: "Hand pain — M25.54- with laterality.",
    confidence: 0.78,
    detect_laterality: true,
  },
  {
    keywords: ["hand laceration", "cut on hand", "cut hand", "laceration hand"],
    code: "S61.41{SIDE}A",
    description: "Laceration without foreign body, {SIDE_DESC} hand, initial encounter",
    level: "primary",
    rationale: "Hand laceration — S61.41- with 7th char A for initial encounter.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
    detect_laterality: true,
  },
  {
    keywords: ["hand abrasion", "scraped hand", "abrasion hand"],
    code: "S60.0{SIDE}XA",
    description: "Abrasion of {SIDE_DESC} wrist and hand, initial encounter",
    level: "primary",
    rationale: "Hand abrasion — S60.0- with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.82,
    detect_laterality: true,
  },

  // =========================================================================
  // FRACTURES
  // =========================================================================
  {
    keywords: ["distal radius fracture", "wrist fracture", "colles fracture"],
    code: "S52.50{SIDE}A",
    description: "Unspecified fracture of the lower end of the {SIDE_DESC} radius, initial encounter for closed fracture",
    level: "primary",
    rationale: "Distal radius fracture — S52.50- with 7th char A for initial encounter for closed fracture.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.88,
    detect_laterality: true,
  },
  {
    keywords: ["hip fracture", "femoral neck fracture", "broken hip"],
    code: "S72.00{SIDE}A",
    description: "Fracture of unspecified part of neck of {SIDE_DESC} femur, initial encounter for closed fracture",
    level: "primary",
    rationale: "Hip (femoral neck) fracture — S72.00- with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.88,
    detect_laterality: true,
  },
  {
    keywords: ["tibia fracture", "shinbone fracture", "tibial fracture"],
    code: "S82.20{SIDE}A",
    description: "Unspecified fracture of shaft of {SIDE_DESC} tibia, initial encounter for closed fracture",
    level: "primary",
    rationale: "Tibial shaft fracture — S82.20- with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
    detect_laterality: true,
  },
  {
    keywords: ["clavicle fracture", "broken collarbone"],
    code: "S42.01{SIDE}A",
    description: "Fracture of unspecified part of {SIDE_DESC} clavicle, initial encounter for closed fracture",
    level: "primary",
    rationale: "Clavicle fracture — S42.01- with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
    detect_laterality: true,
  },
  {
    keywords: ["rib fracture", "broken rib", "fractured rib"],
    code: "S22.31XA",
    description: "Fracture of one rib, right side, initial encounter for closed fracture",
    level: "primary",
    rationale: "Rib fracture — S22.3- with 7th char A. Side refinement requires imaging detail.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.72,
  },
  {
    keywords: ["ankle fracture", "lateral malleolus fracture", "broken ankle"],
    code: "S82.6{SIDE}XA",
    description: "Fracture of lateral malleolus of {SIDE_DESC} ankle, initial encounter for closed fracture",
    level: "primary",
    rationale: "Lateral malleolus fracture — S82.6- with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.8,
    detect_laterality: true,
  },
  {
    keywords: ["concussion"],
    code: "S06.0X9A",
    description: "Concussion with loss of consciousness of unspecified duration, initial encounter",
    level: "primary",
    rationale: "Concussion — S06.0- with 7th char A; LOC duration unspecified when not documented (refine to S06.0X0A/S06.0X1A when documented).",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.82,
  },

  // =========================================================================
  // HEAD / FACE / SPINE
  // =========================================================================
  {
    keywords: ["scalp laceration", "head laceration", "cut on head"],
    code: "S01.01XA",
    description: "Laceration without foreign body of scalp, initial encounter",
    level: "primary",
    rationale: "Scalp laceration — S01.01- with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
  },
  {
    keywords: ["head injury"],
    code: "S09.90XA",
    description: "Unspecified injury of head, initial encounter, without skull fracture",
    level: "primary",
    rationale: "Unspecified head injury — S09.90- with 7th char A pending further evaluation.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.7,
  },
  {
    keywords: ["low back pain", "lumbago", "back pain", "lumbar strain"],
    code: "M54.50",
    description: "Low back pain, unspecified",
    level: "primary",
    rationale: "Low back pain — M54.50; refine to M54.51 (vertebrogenic) or M54.59 when the type is documented.",
    confidence: 0.82,
  },
  {
    keywords: ["sciatica", "lumbar radiculopathy", "disc displacement lumbar"],
    code: "M51.26",
    description: "Other intervertebral disc displacement, lumbar region",
    level: "primary",
    rationale: "Lumbar disc displacement with radiculopathy — M51.26.",
    confidence: 0.75,
  },
  {
    keywords: ["neck pain", "cervicalgia"],
    code: "M54.2",
    description: "Cervicalgia",
    level: "primary",
    rationale: "Neck pain — M54.2 is the standard cervicalgia code.",
    confidence: 0.82,
  },

  // =========================================================================
  // CARDIOVASCULAR / RESPIRATORY
  // =========================================================================
  {
    keywords: ["chest pain"],
    code: "R07.9",
    description: "Chest pain, unspecified",
    level: "primary",
    rationale: "Chest pain, unspecified — R07.9 pending cardiac workup.",
    confidence: 0.75,
  },
  {
    keywords: ["palpitations"],
    code: "R00.2",
    description: "Palpitations",
    level: "primary",
    rationale: "Palpitations — R00.2.",
    confidence: 0.78,
  },
  {
    keywords: ["hypertension crisis", "hypertensive urgency", "hypertensive emergency"],
    code: "I16.9",
    description: "Hypertensive crisis, unspecified",
    level: "primary",
    rationale: "Hypertensive urgency/emergency — I16.9.",
    confidence: 0.8,
  },
  {
    keywords: ["dyspnea", "shortness of breath", "short of breath", "breathlessness", "sob"],
    code: "R06.02",
    description: "Shortness of breath",
    level: "primary",
    rationale: "Shortness of breath — R06.02. Underlying cause should be coded first if established.",
    confidence: 0.72,
    boost: -0.5,
  },
  {
    keywords: ["asthma attack", "asthma exacerbation", "wheezing", "asthma flare"],
    code: "J45.901",
    description: "Unspecified asthma with (acute) exacerbation",
    level: "primary",
    rationale: "Asthma with acute exacerbation — J45.901.",
    confidence: 0.85,
  },
  {
    keywords: ["asthma", "reactive airway"],
    code: "J45.909",
    description: "Unspecified asthma, uncomplicated",
    level: "primary",
    rationale: "Asthma without documented exacerbation — J45.909.",
    confidence: 0.82,
    boost: 0.3,
  },
  {
    keywords: ["copd exacerbation", "acute exacerbation of copd", "copd flare"],
    code: "J44.1",
    description: "Chronic obstructive pulmonary disease with (acute) exacerbation",
    level: "primary",
    rationale: "COPD with acute exacerbation — J44.1.",
    confidence: 0.88,
  },
  {
    keywords: ["copd", "emphysema", "chronic obstructive pulmonary"],
    code: "J44.9",
    description: "Chronic obstructive pulmonary disease, unspecified",
    level: "primary",
    rationale: "COPD without documented exacerbation — J44.9.",
    confidence: 0.85,
    boost: 0.3,
  },
  {
    keywords: ["pneumonia", "lung infection"],
    code: "J18.9",
    description: "Pneumonia, unspecified organism",
    level: "primary",
    rationale: "Pneumonia — J18.9 pending organism identification.",
    confidence: 0.85,
  },
  {
    keywords: ["bronchitis"],
    code: "J20.9",
    description: "Acute bronchitis, unspecified",
    level: "primary",
    rationale: "Acute bronchitis — J20.9.",
    confidence: 0.82,
  },
  {
    keywords: ["upper respiratory infection", "common cold", "uri"],
    code: "J06.9",
    description: "Acute upper respiratory infection, unspecified",
    level: "primary",
    rationale: "URI — J06.9.",
    confidence: 0.85,
  },
  {
    keywords: ["sore throat", "pharyngitis"],
    code: "J02.9",
    description: "Acute pharyngitis, unspecified",
    level: "primary",
    rationale: "Pharyngitis — J02.9.",
    confidence: 0.82,
  },
  {
    keywords: ["sinusitis", "sinus infection"],
    code: "J01.90",
    description: "Acute sinusitis, unspecified",
    level: "primary",
    rationale: "Sinusitis — J01.90.",
    confidence: 0.82,
  },
  {
    keywords: ["influenza", "flu"],
    code: "J11.1",
    description: "Influenza with other respiratory manifestations, virus not identified",
    level: "primary",
    rationale: "Influenza-like illness — J11.1.",
    confidence: 0.8,
  },
  {
    keywords: ["covid", "sars-cov-2", "coronavirus infection"],
    code: "U07.1",
    description: "COVID-19, virus identified",
    level: "primary",
    rationale: "COVID-19 with virus identified — U07.1.",
    confidence: 0.85,
  },
  {
    keywords: ["allergic rhinitis", "hay fever"],
    code: "J30.9",
    description: "Allergic rhinitis, unspecified",
    level: "primary",
    rationale: "Allergic rhinitis — J30.9.",
    confidence: 0.82,
  },

  // =========================================================================
  // GI / ABDOMEN
  // =========================================================================
  {
    keywords: ["abdominal pain", "stomach pain", "belly pain"],
    code: "R10.9",
    description: "Unspecified abdominal pain",
    level: "primary",
    rationale: "Abdominal pain — R10.9; quadrant refinement requires documentation.",
    confidence: 0.78,
  },
  {
    keywords: ["gerd", "acid reflux", "heartburn", "reflux"],
    code: "K21.9",
    description: "Gastro-esophageal reflux disease without esophagitis",
    level: "primary",
    rationale: "GERD without documented esophagitis — K21.9.",
    confidence: 0.85,
  },
  {
    keywords: ["appendicitis"],
    code: "K35.80",
    description: "Unspecified acute appendicitis",
    level: "primary",
    rationale: "Acute appendicitis — K35.80.",
    confidence: 0.85,
  },
  {
    keywords: ["diarrhea", "loose stools"],
    code: "R19.7",
    description: "Diarrhea, unspecified",
    level: "primary",
    rationale: "Diarrhea — R19.7.",
    confidence: 0.8,
  },
  {
    keywords: ["vomiting", "emesis", "nausea and vomiting"],
    code: "R11.2",
    description: "Nausea with vomiting, unspecified",
    level: "primary",
    rationale: "Nausea with vomiting — R11.2.",
    confidence: 0.78,
  },
  {
    keywords: ["constipation"],
    code: "K59.00",
    description: "Constipation, unspecified",
    level: "primary",
    rationale: "Constipation — K59.00.",
    confidence: 0.85,
  },
  {
    keywords: ["gi bleed", "gi bleeding", "gastrointestinal bleeding", "rectal bleeding", "melena"],
    code: "K92.2",
    description: "Gastrointestinal hemorrhage, unspecified",
    level: "primary",
    rationale: "GI hemorrhage — K92.2 pending source localization.",
    confidence: 0.82,
  },
  {
    keywords: ["gastroenteritis", "stomach flu", "stomach bug"],
    code: "K52.9",
    description: "Noninfective gastroenteritis and colitis, unspecified",
    level: "primary",
    rationale: "Gastroenteritis — K52.9 (infectious A09 when organism documented).",
    confidence: 0.8,
  },
  {
    keywords: ["gallstones", "cholelithiasis"],
    code: "K80.20",
    description: "Calculus of gallbladder without cholecystitis, without obstruction",
    level: "primary",
    rationale: "Gallstones without documented cholecystitis — K80.20.",
    confidence: 0.8,
  },
  {
    keywords: ["pancreatitis"],
    code: "K85.90",
    description: "Acute pancreatitis without necrosis or infection, unspecified",
    level: "primary",
    rationale: "Acute pancreatitis — K85.90.",
    confidence: 0.82,
  },
  {
    keywords: ["hemorrhoids"],
    code: "K64.9",
    description: "Unspecified hemorrhoids",
    level: "primary",
    rationale: "Hemorrhoids — K64.9.",
    confidence: 0.85,
  },

  // =========================================================================
  // GU
  // =========================================================================
  {
    keywords: ["urinary tract infection", "uti", "dysuria"],
    code: "N39.0",
    description: "Urinary tract infection, site not specified",
    level: "primary",
    rationale: "UTI site not specified — N39.0.",
    confidence: 0.85,
  },
  {
    keywords: ["kidney stone", "renal stone", "renal colic", "nephrolithiasis", "ureteral stone"],
    code: "N20.0",
    description: "Calculus of kidney",
    level: "primary",
    rationale: "Renal calculus — N20.0 (N20.1 for ureteral stone when documented).",
    confidence: 0.82,
  },
  {
    keywords: ["urinary retention"],
    code: "R33.9",
    description: "Urinary retention, unspecified",
    level: "primary",
    rationale: "Urinary retention — R33.9.",
    confidence: 0.8,
  },
  {
    keywords: ["hematuria", "blood in urine"],
    code: "R31.9",
    description: "Hematuria, unspecified",
    level: "primary",
    rationale: "Hematuria — R31.9.",
    confidence: 0.8,
  },

  // =========================================================================
  // NEURO / GENERAL
  // =========================================================================
  {
    keywords: ["headache", "migraine"],
    code: "R51.9",
    description: "Headache, unspecified",
    level: "primary",
    rationale: "Headache — R51.9 (G43.- when migraine documented).",
    confidence: 0.8,
  },
  {
    keywords: ["migraine with aura", "chronic migraine", "migraine disorder"],
    code: "G43.909",
    description: "Migraine, unspecified, not intractable, without status migrainosus",
    level: "primary",
    rationale: "Migraine — G43.909.",
    confidence: 0.85,
  },
  {
    keywords: ["dizziness", "vertigo", "lightheaded"],
    code: "R42",
    description: "Dizziness and giddiness",
    level: "primary",
    rationale: "Dizziness — R42.",
    confidence: 0.78,
  },
  {
    keywords: ["syncope", "fainted", "passed out", "blacked out"],
    code: "R55",
    description: "Syncope and collapse",
    level: "primary",
    rationale: "Syncope — R55.",
    confidence: 0.8,
  },
  {
    keywords: ["fever", "pyrexia", "febrile"],
    code: "R50.9",
    description: "Fever, unspecified",
    level: "primary",
    rationale: "Fever — R50.9. Underlying cause coded first when established.",
    confidence: 0.75,
  },
  {
    keywords: ["fatigue", "tiredness", "malaise"],
    code: "R53.83",
    description: "Other fatigue",
    level: "primary",
    rationale: "Fatigue — R53.83.",
    confidence: 0.72,
  },
  {
    keywords: ["seizure", "convulsion"],
    code: "G40.909",
    description: "Epilepsy, unspecified, not intractable, without status epilepticus",
    level: "primary",
    rationale: "Seizure — G40.909 pending epilepsy classification.",
    confidence: 0.72,
  },
  {
    keywords: ["stroke", "cerebral infarction", "cva"],
    code: "I63.9",
    description: "Cerebral infarction, unspecified",
    level: "primary",
    rationale: "Cerebral infarction — I63.9.",
    confidence: 0.85,
  },
  {
    keywords: ["tia", "transient ischemic attack", "mini stroke"],
    code: "G45.9",
    description: "Transient cerebral ischemic attack, unspecified",
    level: "primary",
    rationale: "TIA — G45.9.",
    confidence: 0.85,
  },
  {
    keywords: ["numbness", "paresthesia", "tingling"],
    code: "R20.2",
    description: "Paresthesia of skin",
    level: "primary",
    rationale: "Paresthesia — R20.2.",
    confidence: 0.7,
  },
  {
    keywords: ["cellulitis right leg", "cellulitis of right leg", "cellulitis right lower limb", "right leg cellulitis"],
    code: "L03.115",
    description: "Cellulitis of right lower limb",
    level: "primary",
    rationale: "Cellulitis of the right lower limb — L03.115.",
    confidence: 0.88,
  },
  {
    keywords: ["cellulitis left leg", "cellulitis of left leg", "cellulitis left lower limb", "left leg cellulitis"],
    code: "L03.116",
    description: "Cellulitis of left lower limb",
    level: "primary",
    rationale: "Cellulitis of the left lower limb — L03.116.",
    confidence: 0.88,
  },
  {
    keywords: ["cellulitis"],
    code: "L03.90",
    description: "Cellulitis, unspecified",
    level: "primary",
    rationale: "Cellulitis — L03.90; refine to L03.115/L03.116 when laterality is documented.",
    confidence: 0.85,
  },
  {
    keywords: ["skin rash", "rash", "dermatitis", "eczema"],
    code: "L30.9",
    description: "Dermatitis, unspecified",
    level: "primary",
    rationale: "Dermatitis unspecified — L30.9.",
    confidence: 0.72,
  },
  {
    keywords: ["allergic reaction", "hives", "urticaria"],
    code: "L50.9",
    description: "Urticaria, unspecified",
    level: "primary",
    rationale: "Urticaria — L50.9. T78.40XA added for anaphylaxis when documented.",
    confidence: 0.78,
  },
  {
    keywords: ["acne"],
    code: "L70.0",
    description: "Acne vulgaris",
    level: "primary",
    rationale: "Acne vulgaris — L70.0.",
    confidence: 0.88,
  },
  {
    keywords: ["foot ulcer", "ulcer on foot", "heel ulcer", "non-healing ulcer", "nonhealing ulcer", "diabetic foot"],
    code: "L97.4",
    description: "Non-pressure chronic ulcer of heel and midfoot",
    level: "primary",
    rationale: "Lower-extremity ulcer — L97.4. When diabetes is documented, E11.621 takes code-first priority and this moves to Secondary.",
    confidence: 0.8,
  },
  {
    keywords: ["anaphylaxis", "anaphylactic"],
    code: "T78.40XA",
    description: "Anaphylactic reaction, unspecified, initial encounter",
    level: "primary",
    rationale: "Anaphylactic reaction — T78.40XA with 7th char A.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
  },

  // =========================================================================
  // EXTERNAL CAUSES (V/W/X/Y) — tertiary supplements
  // =========================================================================
  {
    keywords: ["fall", "fell", "slipped", "tripped", "stumbled", "lost balance", "tripping"],
    code: "W19.XXX{ENC}",
    description: "Unspecified fall, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause of injury — unspecified fall; 7th character matches the injury code's encounter type.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
  },
  {
    keywords: ["on the stairs", "from the stairs", "staircase", "steps"],
    code: "W10.XXX{ENC}",
    description: "Fall on and from stairs and steps, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — fall on and from stairs and steps.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
  },
  {
    keywords: ["from a ladder", "off a ladder", "ladder fall"],
    code: "W11.XXX{ENC}",
    description: "Fall on and from ladder, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — fall on and from ladder.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
  },
  {
    keywords: ["fell from bed", "fell out of bed", "out of bed"],
    code: "W06.XXX{ENC}",
    description: "Fall from bed, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — fall from bed.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.82,
  },
  {
    keywords: ["fell from chair", "off a chair"],
    code: "W07.XXX{ENC}",
    description: "Fall from chair, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — fall from chair.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.82,
  },
  {
    keywords: ["motor vehicle accident", "mva", "car crash", "car accident", "auto accident", "vehicle collision", "traffic accident"],
    code: "V89.2XX{ENC}",
    description: "Person injured in unspecified motor-vehicle accident, traffic, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — unspecified motor-vehicle traffic accident.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.8,
  },
  {
    keywords: ["pedestrian struck", "hit by car", "hit by vehicle"],
    code: "V09.2XX{ENC}",
    description: "Pedestrian injured in unspecified traffic accident, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — pedestrian struck by vehicle in traffic.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.78,
  },
  {
    keywords: ["bicycle accident", "bike accident", "bicycle crash", "bike crash"],
    code: "V19.9XX{ENC}",
    description: "Pedal cyclist injured in unspecified traffic accident, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — pedal cyclist injured in traffic accident.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.78,
  },
  {
    keywords: ["motorcycle accident", "motorbike accident"],
    code: "V29.9XX{ENC}",
    description: "Motorcycle rider injured in unspecified traffic accident, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — motorcycle rider injured in traffic accident.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.78,
  },
  {
    keywords: ["burn", "scald", "burned"],
    code: "X10.1XX{ENC}",
    description: "Contact with hot water, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — contact with hot water (scald); refine with X00/X12/X19 when the source is documented.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.78,
  },
  {
    keywords: ["insect bite", "bug bite", "mosquito bite"],
    code: "W57.XXX{ENC}",
    description: "Bitten or stung by nonvenomous insect and other nonvenomous arthropods, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — bitten or stung by nonvenomous insect.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.8,
  },
  {
    keywords: ["snake bite", "snakebit"],
    code: "X20.XXX{ENC}",
    description: "Contact with and (suspected) exposure to venomous snakes and lizards, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — venomous snake contact.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.85,
  },
  {
    keywords: ["bee sting", "wasp sting", "hornet sting"],
    code: "X23.XXX{ENC}",
    description: "Contact with and (suspected) exposure to hornets, wasps and bees, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — hornet/wasp/bee contact.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.82,
  },
  {
    keywords: ["cat bite", "cat scratch", "scratched by cat"],
    code: "W55.03X{ENC}",
    description: "Other contact with cat, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — other contact with cat (scratch/bite). 7th character matches the injury code.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.88,
  },
  {
    keywords: ["dog bite", "bitten by dog", "dog attack"],
    code: "W54.0XX{ENC}",
    description: "Bitten by dog, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — bitten by dog. 7th character matches the injury code.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.9,
  },
  {
    keywords: ["cut by", "lacerated by", "sharp object", "glass cut", "cut with", "knife cut"],
    code: "W26.XXX{ENC}",
    description: "Contact with other sharp object, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — contact with sharp object.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.72,
  },
  {
    keywords: ["overdose", "poisoning", "ingested", "swallowed"],
    code: "X44.XXX{ENC}",
    description: "Accidental poisoning by and exposure to other and unspecified drugs, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — accidental poisoning by unspecified drugs (X40-X49 refinement per agent).",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.75,
  },
  {
    keywords: ["electrocution", "electric shock"],
    code: "W86.XXX{ENC}",
    description: "Exposure to other specified electric current, {ENC_DESC} encounter",
    level: "tertiary",
    rationale: "External cause — exposure to electric current.",
    requires_seventh_char: true,
    default_seventh_char: "A",
    confidence: 0.78,
  },
  {
    keywords: ["at home", "while at home", "in the house", "at his home", "at her home"],
    code: "Y92.008",
    description: "Unspecified place in single-family (private) house as the place of occurrence of the external cause",
    level: "tertiary",
    rationale: "Place of occurrence — private house (supplemental to the external cause code).",
    confidence: 0.65,
  },
  {
    keywords: ["at work", "while working", "on the job", "workplace"],
    code: "Y99.0",
    description: "Civilian activity done for income or pay as the external cause status",
    level: "tertiary",
    rationale: "External cause status — while working for income (supplemental).",
    confidence: 0.65,
  },
  {
    keywords: ["at school", "school playground", "in school"],
    code: "Y92.41",
    description: "School, other institution and public administrative area as the place of occurrence of the external cause",
    level: "tertiary",
    rationale: "Place of occurrence — school (supplemental).",
    confidence: 0.65,
  },
  {
    keywords: ["playing sports", "during sports", "athletic activity", "on the field"],
    code: "Y92.46",
    description: "Sports and athletics area as the place of occurrence of the external cause",
    level: "tertiary",
    rationale: "Place of occurrence — sports and athletics area (supplemental).",
    confidence: 0.62,
  },
  {
    keywords: ["walking", "while walking"],
    code: "Y93.A1",
    description: "Activity, walking",
    level: "tertiary",
    rationale: "Activity code — walking (supplemental).",
    confidence: 0.62,
  },
  {
    keywords: ["running", "jogging"],
    code: "Y93.A2",
    description: "Activity, running",
    level: "tertiary",
    rationale: "Activity code — running (supplemental).",
    confidence: 0.62,
  },
  {
    keywords: ["cycling", "bicycle riding", "riding bike"],
    code: "Y93.A4",
    description: "Activity, cycling",
    level: "tertiary",
    rationale: "Activity code — cycling (supplemental).",
    confidence: 0.62,
  },
];

// =========================================================================
// Context detection helpers
// =========================================================================

type Laterality = "right" | "left" | "bilateral" | "unspecified";

const LEFT_CUES = ["left", "l/", "lt ", " lt.", "(l)", "left-sided", "left side", "sinistra"];
const RIGHT_CUES = ["right", "r/", "rt ", " rt.", "(r)", "right-sided", "right side", "dextra"];
const BILATERAL_CUES = ["bilateral", "both sides", "both legs", "both arms", "both feet", "both hands", "both knees", "b/l"];

function detectLaterality(text: string): Laterality {
  const t = text.toLowerCase();
  if (BILATERAL_CUES.some((c) => t.includes(c))) return "bilateral";
  const hasLeft = LEFT_CUES.some((c) => t.includes(c));
  const hasRight = RIGHT_CUES.some((c) => t.includes(c));
  if (hasLeft && hasRight) return "bilateral";
  if (hasLeft) return "left";
  if (hasRight) return "right";
  return "unspecified";
}

/**
 * Body-part-scoped laterality: a note like "bilateral knee OA ... left wrist
 * fracture" must NOT make the wrist code bilateral. The cue must appear in
 * the sentence window around the matched keyword itself.
 */
function detectLateralityScoped(text: string, keywords: string[]): Laterality {
  const t = text.toLowerCase();
  let anchor = -1;
  for (const k of keywords) {
    const i = t.indexOf(k.toLowerCase());
    if (i !== -1 && (anchor === -1 || i < anchor)) anchor = i;
  }
  if (anchor === -1) return detectLaterality(text);
  const anchorOffset = Math.min(70, anchor); // anchor position inside the window
  const start = Math.max(0, anchor - 70);
  const window = t.slice(start, Math.min(t.length, anchor + 90));
  // Keep only the sentence segment that contains the anchor, so cues from a
  // previous sentence ("bilateral knee OA.") don't leak into this finding.
  let scope = window;
  let pos = 0;
  for (const part of window.split(/[.;\n]/)) {
    const len = part.length + 1; // +1 for the split char
    if (anchorOffset >= pos && anchorOffset < pos + len) {
      scope = part;
      break;
    }
    pos += len;
  }
  const hasBilateral = BILATERAL_CUES.some((c) => scope.includes(c));
  const hasLeft = LEFT_CUES.some((c) => scope.includes(c));
  const hasRight = RIGHT_CUES.some((c) => scope.includes(c));
  if (hasLeft && hasRight) return "bilateral";
  if (hasBilateral) return "bilateral";
  if (hasLeft) return "left";
  if (hasRight) return "right";
  return "unspecified";
}

type EncounterType = "initial" | "subsequent" | "sequela";

function detectEncounterType(text: string): EncounterType {
  const t = text.toLowerCase();
  if (
    t.includes("sequela") || t.includes("late effect") || t.includes("residual") ||
    t.includes("old injury") || t.includes("permanent damage from")
  ) {
    return "sequela";
  }
  if (
    t.includes("follow-up") || t.includes("follow up") || t.includes("followup") ||
    t.includes("recheck") || t.includes("suture removal") || t.includes("post-op") ||
    t.includes("postop") || t.includes("post op") || t.includes("cast check") ||
    t.includes("wound check") || t.includes("routine healing") || t.includes("return visit") ||
    t.includes("review of") || t.includes("re-evaluation") || t.includes("reevaluation")
  ) {
    return "subsequent";
  }
  return "initial";
}

type Acuity = "acute" | "chronic" | "acute_on_chronic" | "unspecified";

function detectAcuity(text: string): Acuity {
  const t = text.toLowerCase();
  if (t.includes("acute on chronic") || t.includes("acute-on-chronic")) return "acute_on_chronic";
  if (
    t.includes("chronic") || t.includes("long-standing") || t.includes("long standing") ||
    t.includes("ongoing") || t.includes("history of") || t.includes("known")
  ) {
    return "chronic";
  }
  if (
    t.includes("acute") || t.includes("sudden") || t.includes("new onset") ||
    t.includes("today") || t.includes("this morning") || t.includes("yesterday") ||
    t.includes("since last night") || t.includes("for 2 days") || t.includes("for three days")
  ) {
    return "acute";
  }
  return "unspecified";
}

const ENCOUNTER_CHAR: Record<EncounterType, "A" | "D" | "S"> = {
  initial: "A",
  subsequent: "D",
  sequela: "S",
};

const ENCOUNTER_DESC: Record<EncounterType, string> = {
  initial: "initial",
  subsequent: "subsequent",
  sequela: "sequela",
};

/**
 * Resolve the {SIDE} placeholder in a code template.
 * ICD-10-CM laterality convention (5th/6th character): 1 = right, 2 = left, 9 = unspecified
 */
function fillSide(code: string, side: Laterality): string {
  const map: Record<Laterality, string> = {
    right: "1",
    left: "2",
    bilateral: "9",
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

function resolveTemplate(rule: MockRule, side: Laterality, enc: EncounterType): { code: string; description: string } {
  let code = rule.code;
  let description = rule.description;

  if (code.includes("{SIDE}")) {
    code = fillSide(code, side);
    description = fillSideDesc(description, side);
  } else if (description.includes("{SIDE_DESC}")) {
    description = fillSideDesc(description, side);
  }

  // Low back pain special: M54.5 has no laterality (handled by static M54.50 rule)

  // Carpal tunnel special: unspecified -> G56.00
  if (rule.code === "G56.0{SIDE}" && (side === "unspecified" || side === "bilateral")) {
    code = "G56.00";
    description = "Postmononeuropathy of unspecified upper limb (carpal tunnel)";
  }

  // Knee OA special: unspecified -> M17.9, bilateral -> M17.0
  if (rule.code === "M17.1{SIDE}") {
    if (side === "bilateral") {
      code = "M17.0";
      description = "Bilateral primary osteoarthritis of knee";
    } else if (side === "unspecified") {
      code = "M17.9";
      description = "Osteoarthritis of knee, unspecified";
    }
  }

  // Hallux valgus special: no 'unspecified' subcategory exists
  if (rule.code === "M20.1{SIDE}" && (side === "unspecified" || side === "bilateral")) {
    code = "M20.9";
    description = "Unspecified acquired deformity of toe";
  }

  // {ENC} — external cause encounter character
  if (code.includes("{ENC}")) {
    code = code.replace("{ENC}", ENCOUNTER_CHAR[enc]);
    description = description.replace("{ENC_DESC}", ENCOUNTER_DESC[enc]);
  }

  return { code, description };
}

function buildCodeDetail(
  rule: MockRule,
  text: string,
  enc: EncounterType,
  acuityOverride?: Acuity
): ICDCodeDetail {
  const side = rule.detect_laterality ? detectLateralityScoped(text, rule.keywords) : "unspecified";
  const resolved = resolveTemplate(rule, side, enc);
  const acuity = acuityOverride ?? detectAcuity(text);

  // 7th char: rule default, overridden by detected encounter type for injury/external rules
  let seventh: ICDCodeDetail["seventh_character"] = "not_required";
  if (rule.requires_seventh_char) {
    seventh = /[ADS]$/.test(resolved.code)
      ? (resolved.code[resolved.code.length - 1] as "A" | "D" | "S")
      : rule.default_seventh_char ?? ENCOUNTER_CHAR[enc];
  }

  return {
    code: resolved.code,
    description: resolved.description,
    rationale: rule.rationale,
    confidence: rule.confidence,
    laterality: (rule.detect_laterality ? side : "not_applicable"),
    acuity,
    seventh_character: seventh,
  };
}

// =========================================================================
// Chronic conditions -> Secondary Diagnoses (UHDDS "other diagnoses")
// =========================================================================

interface ChronicHit {
  code: string;
  description: string;
  label_en: string;
  label_ar: string;
  rationale: string;
  confidence: number;
  specificity: number;
  acuity: Acuity;
}

function detectChronicConditions(note: string): ChronicHit[] {
  const hits: ChronicHit[] = [];
  for (const cc of CHRONIC_CONDITION_MATCHERS) {
    const kw = cc.keywords.find((k) => keywordPresentNotNegated(note, k));
    if (!kw) continue;

    const refined = cc.refine ? cc.refine(note) : null;
    const code = refined?.code ?? cc.default_code;
    const description = refined?.description ?? cc.description;

    hits.push({
      code,
      description,
      label_en: cc.label_en,
      label_ar: cc.label_ar,
      rationale: `Documented comorbidity detected from the note ("${kw}"). Per UHDDS / OGCR Section III, co-existing conditions that affect patient care during this encounter are reported as secondary diagnoses.`,
      confidence: refined ? 0.9 : 0.82,
      specificity: cc.specificity ?? 5,
      acuity: "chronic",
    });
  }
  return hits;
}

/** Keep only the most specific code per code family (e.g. one E11.- diabetes code). */
function dedupeFamily(codes: { code: string; specificity: number }[], family: (c: string) => string) {
  const best = new Map<string, { code: string; specificity: number }>();
  for (const c of codes) {
    const fam = family(c.code);
    const prev = best.get(fam);
    if (!prev || c.specificity > prev.specificity) best.set(fam, c);
  }
  return Array.from(best.values()).map((x) => x.code);
}

function familyOf(code: string): string {
  // E11.621 -> E11 ; I12.9 -> I12 ; S81.811A -> S81.81
  const m = code.match(/^([A-Z]\d{2})(\.\d+)?/);
  return m ? m[1] : code;
}

// =========================================================================
// Provider implementation
// =========================================================================

interface RagBoostItem {
  code: string;
  score: number;
}

export const mockProvider: LLMProvider = {
  id: "mock",
  modelLabel: "Smart Offline Coder (built-in)",
  async generateCoding(clinicalNote, ragContext) {
    const note = clinicalNote;
    const text = note.toLowerCase();
    const enc = detectEncounterType(text);
    const encChar = ENCOUNTER_CHAR[enc];

    // --- RAG boost map: code family -> best RAG score
    const ragBoost = new Map<string, number>();
    for (const r of ragContext ?? []) {
      const fam = familyOf(r.code.toUpperCase());
      const prev = ragBoost.get(fam) ?? 0;
      if (r.score > prev) ragBoost.set(fam, r.score);
    }

    // --- 1. Match rules (negation-aware)
    const hits: MockRule[] = [];
    for (const rule of MOCK_RULES) {
      const matched = rule.keywords.some((k) => keywordPresentNotNegated(text, k));
      if (matched) hits.push(rule);
    }

    // --- 2. Detect chronic conditions
    const chronicHits = detectChronicConditions(text);

    const hasDiabetes = chronicHits.some((h) => h.code.startsWith("E10") || h.code.startsWith("E11"));
    const hasFootUlcerRule = hits.some(
      (h) => h.level === "primary" && h.code.startsWith("L97")
    );

    // --- 3. Combo logic: diabetic foot ulcer -> E11.621 code-first
    let comboPrimary: MockRule | null = null;
    if (hasDiabetes && hasFootUlcerRule) {
      comboPrimary = {
        keywords: [],
        code: chronicHits.find((h) => h.code.startsWith("E11") && h.code !== "E11.9")
          ? "E11.621"
          : "E11.621",
        description: "Type 2 diabetes mellitus with foot ulcer",
        level: "primary",
        rationale:
          "Code-first combination: diabetes documented with a foot ulcer. Per ICD-10-CM, the diabetes-with-foot-ulcer combination code (E11.621) is sequenced FIRST; the ulcer site code (L97.-) follows as an additional (secondary) diagnosis.",
        confidence: 0.88,
      };
    }

    // --- 4. Select primary
    let primaryDetail: ICDCodeDetail;
    const primaryHits = hits.filter((h) => h.level === "primary");

    if (comboPrimary) {
      primaryDetail = buildCodeDetail(comboPrimary, text, enc, "chronic");
      // Remove the ulcer rule from primary (it moves to secondary via L97 below)
    } else if (primaryHits.length > 0) {
      // COPD exacerbation upgrade: when COPD is documented together with
      // worsening dyspnea/sputum/wheeze, J44.1 supersedes plain J44.9.
      const copdIndex = primaryHits.findIndex((h) => h.code === "J44.9");
      if (copdIndex !== -1) {
        const worsening =
          keywordPresentNotNegated(text, "exacerbation") ||
          keywordPresentNotNegated(text, "increased dyspnea") ||
          keywordPresentNotNegated(text, "worsening dyspnea") ||
          keywordPresentNotNegated(text, "worse dyspnea") ||
          keywordPresentNotNegated(text, "purulent sputum") ||
          keywordPresentNotNegated(text, "wheeze");
        if (worsening) {
          primaryHits[copdIndex] = {
            ...primaryHits[copdIndex],
            code: "J44.1",
            description: "Chronic obstructive pulmonary disease with (acute) exacerbation",
            rationale: "COPD documented with worsening dyspnea/sputum/wheeze — coded as acute exacerbation (J44.1).",
            confidence: 0.88,
            boost: 1.0,
          };
        }
      }

      const scored = primaryHits.map((rule) => {
        const matchedKw = rule.keywords
          .filter((k) => keywordPresentNotNegated(text, k))
          .reduce((a, b) => (b.length > a.length ? b : a), "");
        const fam = familyOf(fillSide(rule.code.replace(/\{ENC\}|\{LOC\}/g, "A"), detectLaterality(text)));
        const rag = ragBoost.get(fam) ?? 0;
        const spec = Math.min(1.5, matchedKw.length / 12); // longer keyword = more specific
        const inj = rule.code.startsWith("S") || rule.code.startsWith("T") ? 2 : 0;
        // R-chapter symptom codes are diagnoses of exclusion — when a
        // specific disease rule also matched, the symptom must not outrank it.
        const symptomPenalty = rule.code.startsWith("R") ? -0.9 : 0;
        return { rule, score: spec + inj + symptomPenalty + (rag > 0 ? 0.35 + rag * 0.35 : 0) + (rule.boost ?? 0) };
      });
      scored.sort((a, b) => b.score - a.score);
      primaryDetail = buildCodeDetail(scored[0].rule, text, enc);
    } else if (chronicHits.length > 0) {
      // Encounter is for the chronic condition itself (e.g. CKD follow-up)
      const top = chronicHits.reduce((a, b) => (b.specificity > a.specificity ? b : a));
      primaryDetail = {
        code: top.code,
        description: top.description,
        rationale: `No acute chief complaint matched; the encounter is managed around "${top.label_en}". This chronic condition becomes the principal diagnosis for the visit.`,
        confidence: 0.8,
        laterality: "not_applicable",
        acuity: "chronic",
        seventh_character: "not_required",
      };
    } else {
      const fallback: ICDCodeDetail = {
        code: "R69",
        description: "Unknown causes of morbidity",
        rationale:
          "No specific primary diagnosis could be matched from the note by the offline pattern library. Review the clinical text, add more details (site, side, mechanism, duration), or select an online model.",
        confidence: 0.3,
        laterality: "not_applicable",
        acuity: "unspecified",
        seventh_character: "not_required",
      };
      primaryDetail = fallback;
    }

    // --- 5. Build secondary list
    const secondaryDetails: ICDCodeDetail[] = [];
    const primaryFam = familyOf(primaryDetail.code);

    // 5a. ulcer site code moves to secondary when combo primary used
    if (comboPrimary) {
      const ulcerRule = hits.find((h) => h.level === "primary" && h.code.startsWith("L97"));
      if (ulcerRule) {
        secondaryDetails.push(buildCodeDetail(ulcerRule, text, enc, "chronic"));
      }
    }

    // 5b. chronic conditions (dedupe family vs primary)
    const chronicFamilyMap = new Map<string, ChronicHit>();
    for (const ch of chronicHits) {
      const fam = familyOf(ch.code);
      const prev = chronicFamilyMap.get(fam);
      if (!prev || ch.specificity > prev.specificity) chronicFamilyMap.set(fam, ch);
    }
    for (const [fam, ch] of chronicFamilyMap) {
      if (fam === primaryFam) continue; // already the primary
      secondaryDetails.push({
        code: ch.code,
        description: ch.description,
        rationale: ch.rationale,
        confidence: ch.confidence,
        laterality: "not_applicable",
        acuity: ch.acuity,
        seventh_character: "not_required",
      });
    }

    // 5c. rule-level secondaries (rare — most chronic logic lives in matchers)
    for (const h of hits.filter((x) => x.level === "secondary")) {
      const d = buildCodeDetail(h, text, enc);
      if (familyOf(d.code) !== primaryFam && !secondaryDetails.some((s) => s.code === d.code)) {
        secondaryDetails.push(d);
      }
    }

    // --- 6. Tertiary (supplemental): external causes, activity, place, symptoms
    const tertiaryHits = hits.filter((x) => x.level === "tertiary");
    // Most specific (longest matched keyword) first, so the mechanism dedupe
    // below keeps "fall on stairs (W10)" over "unspecified fall (W19)".
    const maxKwLen = (r: MockRule) =>
      r.keywords
        .filter((k) => keywordPresentNotNegated(text, k))
        .reduce((a, b) => (b.length > a.length ? b : a), "").length;
    tertiaryHits.sort((a, b) => maxKwLen(b) - maxKwLen(a));
    const tertiaryDetails: ICDCodeDetail[] = [];
    for (const h of tertiaryHits) {
      // external cause 7th char must MATCH the injury's encounter type
      const d = buildCodeDetail(h, text, enc);
      if (d.seventh_character === "A" && h.requires_seventh_char && encChar !== "A") {
        d.seventh_character = encChar;
        d.code = d.code.slice(0, -1) + encChar;
      }
      tertiaryDetails.push(d);
    }

    // --- 7. Dedupe tertiary: keep the most specific external cause per mechanism
    const seenFams = new Set<string>();
    const dedupedTertiary: ICDCodeDetail[] = [];
    const mechanismKey = (code: string): string => {
      // All fall codes W00-W19 share one mechanism slot (most specific wins
      // via keyword length in rule order — stairs/ladder before generic fall)
      if (/^W[01]/.test(code)) return "W_FALL";
      return code.slice(0, 3);
    };
    for (const t of tertiaryDetails) {
      const fam = familyOf(t.code);
      // V/W/X/Y mechanism codes: keep the most specific mechanism per slot
      const key = /^[VWXY]/.test(t.code) ? mechanismKey(t.code) : `${fam}:${t.code}`;
      if (seenFams.has(key)) continue;
      seenFams.add(key);
      dedupedTertiary.push(t);
    }

    // --- 8. Dedupe secondary by exact code
    const finalSecondary = secondaryDetails.filter(
      (s, i, arr) => arr.findIndex((x) => x.code === s.code) === i
    );

    // --- 9. Entities
    const entities = [
      ...chronicHits.map((h) => ({
        entity: h.label_en,
        type: "chronic_condition" as const,
        value: h.code,
      })),
      ...hits
        .filter((h) => h.level === "tertiary")
        .map((h) => ({
          entity: h.keywords[0],
          type: "external_cause" as const,
          value: resolveTemplate(h, detectLaterality(text), enc).code,
        })),
      {
        entity: "chief complaint",
        type: "disease" as const,
        value: primaryDetail.code,
      },
    ];

    const parsed: ClinicalCodingResponse = {
      primary_icd10: primaryDetail,
      secondary_icd10: finalSecondary,
      tertiary_icd10: dedupedTertiary,
      summary:
        `Offline smart coding — encounter type: ${enc}${enc !== "initial" ? ` (7th char "${encChar}" applied to injury/external codes)` : ""}, acuity: ${detectAcuity(text)}. ` +
        `Primary: ${primaryDetail.code}. ` +
        `Secondary: ${finalSecondary.length} co-existing condition(s) detected from the UHDDS chronic-condition library (${CHRONIC_CONDITION_MATCHERS.length} patterns). ` +
        `Supplemental: ${dedupedTertiary.length} external cause / supporting code(s). ` +
        `Matched from a built-in library of ${MOCK_RULES.length} clinical patterns with negation-aware matching.`,
      entities_extracted: entities,
    };

    // Brief artificial delay so loading state is visible
    await new Promise((r) => setTimeout(r, 400));
    return { parsed, raw: JSON.stringify(parsed, null, 2) };
  },
};
