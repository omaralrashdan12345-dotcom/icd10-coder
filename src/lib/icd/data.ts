/**
 * Built-in ICD-10-CM dataset (curated subset for offline fallback).
 * Used by the Vector DB when the NLM API is unreachable, and to seed
 * the vector index at startup.
 *
 * This is intentionally a small, high-quality subset covering the most
 * common conditions seen in primary care / ER. The NLM API provides the
 * full 70k-code dataset at runtime.
 */

export interface ICDEntry {
  code: string;
  description: string;
  /** Broad category — chapter-level grouping for faceted display */
  category: string;
  /** True if this code category requires a 7th character */
  requires_seventh_char?: boolean;
}

export const BUILTIN_ICD10: ICDEntry[] = [
  // External causes (V/W/X/Y)
  { code: "W55.03XA", description: "Other contact with cat, initial encounter", category: "External Causes", requires_seventh_char: true },
  { code: "W55.03XD", description: "Other contact with cat, subsequent encounter", category: "External Causes", requires_seventh_char: true },
  { code: "W55.03XS", description: "Other contact with cat, sequela", category: "External Causes", requires_seventh_char: true },
  { code: "W55.01XA", description: "Bitten by cat, initial encounter", category: "External Causes", requires_seventh_char: true },
  { code: "W55.41XA", description: "Bitten by dog, initial encounter", category: "External Causes", requires_seventh_char: true },
  { code: "W19.XXXA", description: "Unspecified fall, initial encounter", category: "External Causes", requires_seventh_char: true },
  { code: "W01.XXXA", description: "Fall on same level from slipping, tripping and stumbling without subsequent striking against object, initial encounter", category: "External Causes", requires_seventh_char: true },
  { code: "X10.1XXA", description: "Contact with hot water, initial encounter", category: "External Causes", requires_seventh_char: true },
  { code: "Y92.25", description: "Health care facility, outpatient, as the place of occurrence of the external cause", category: "External Causes" },

  // Injury — lower extremity (S80-S89)
  { code: "S80.01XA", description: "Contusion of right lower leg, initial encounter", category: "Injury — Lower Extremity", requires_seventh_char: true },
  { code: "S80.02XA", description: "Contusion of left lower leg, initial encounter", category: "Injury — Lower Extremity", requires_seventh_char: true },
  { code: "S80.04XA", description: "Contusion of unspecified lower leg, initial encounter", category: "Injury — Lower Extremity", requires_seventh_char: true },
  { code: "S81.811A", description: "Laceration without foreign body, right lower leg, initial encounter", category: "Injury — Lower Extremity", requires_seventh_char: true },
  { code: "S81.812A", description: "Laceration without foreign body, left lower leg, initial encounter", category: "Injury — Lower Extremity", requires_seventh_char: true },
  { code: "S81.001A", description: "Laceration without foreign body, right knee, initial encounter", category: "Injury — Lower Extremity", requires_seventh_char: true },
  { code: "S81.011A", description: "Laceration without foreign body, right thigh, initial encounter", category: "Injury — Lower Extremity", requires_seventh_char: true },
  { code: "S90.461A", description: "Insect bite (nonvenomous), right foot, initial encounter", category: "Injury — Lower Extremity", requires_seventh_char: true },
  { code: "S90.462A", description: "Insect bite (nonvenomous), left foot, initial encounter", category: "Injury — Lower Extremity", requires_seventh_char: true },

  // Injury — upper extremity (S60-S69)
  { code: "S61.411A", description: "Laceration without foreign body, right hand, initial encounter", category: "Injury — Upper Extremity", requires_seventh_char: true },
  { code: "S61.412A", description: "Laceration without foreign body, left hand, initial encounter", category: "Injury — Upper Extremity", requires_seventh_char: true },
  { code: "S60.001A", description: "Abrasion of right hand, initial encounter", category: "Injury — Upper Extremity", requires_seventh_char: true },

  // Endocrine (E00-E89)
  { code: "E11.9", description: "Type 2 diabetes mellitus without complications", category: "Endocrine" },
  { code: "E11.65", description: "Type 2 diabetes mellitus with hyperglycemia", category: "Endocrine" },
  { code: "E11.40", description: "Type 2 diabetes mellitus with diabetic neuropathy, unspecified", category: "Endocrine" },
  { code: "E11.51", description: "Type 2 diabetes mellitus with diabetic peripheral angiopathy without gangrene", category: "Endocrine" },
  { code: "E11.621", description: "Type 2 diabetes mellitus with foot ulcer", category: "Endocrine" },
  { code: "E11.22", description: "Type 2 diabetes mellitus with diabetic chronic kidney disease", category: "Endocrine" },
  { code: "E10.9", description: "Type 1 diabetes mellitus without complications", category: "Endocrine" },
  { code: "E03.9", description: "Hypothyroidism, unspecified", category: "Endocrine" },
  { code: "E78.5", description: "Hyperlipidemia, unspecified", category: "Endocrine" },

  // Circulatory (I00-I99)
  { code: "I10", description: "Essential (primary) hypertension", category: "Circulatory" },
  { code: "I11.9", description: "Hypertensive heart disease without heart failure", category: "Circulatory" },
  { code: "I12.9", description: "Hypertensive chronic kidney disease with stage 1-4 or unspecified CKD", category: "Circulatory" },
  { code: "I50.9", description: "Heart failure, unspecified", category: "Circulatory" },
  { code: "I21.4", description: "Non-ST elevation (NSTEMI) myocardial infarction", category: "Circulatory" },
  { code: "I63.9", description: "Cerebral infarction, unspecified", category: "Circulatory" },
  { code: "I80.2", description: "Embolism and thrombosis of other deep vessels of lower extremities", category: "Circulatory" },

  // Respiratory (J00-J99)
  { code: "J45.909", description: "Unspecified asthma, uncomplicated", category: "Respiratory" },
  { code: "J45.20", description: "Mild intermittent asthma, uncomplicated", category: "Respiratory" },
  { code: "J45.30", description: "Mild persistent asthma, uncomplicated", category: "Respiratory" },
  { code: "J45.40", description: "Moderate persistent asthma, uncomplicated", category: "Respiratory" },
  { code: "J45.50", description: "Severe persistent asthma, uncomplicated", category: "Respiratory" },
  { code: "J44.9", description: "Chronic obstructive pulmonary disease, unspecified", category: "Respiratory" },
  { code: "J44.1", description: "COPD with (acute) exacerbation", category: "Respiratory" },
  { code: "J20.9", description: "Acute bronchitis, unspecified", category: "Respiratory" },
  { code: "J06.9", description: "Acute upper respiratory infection, unspecified", category: "Respiratory" },
  { code: "J11.1", description: "Influenza with other respiratory manifestations", category: "Respiratory" },
  { code: "J18.9", description: "Pneumonia, unspecified organism", category: "Respiratory" },

  // Digestive (K00-K95)
  { code: "K21.9", description: "Gastro-esophageal reflux disease without esophagitis", category: "Digestive" },
  { code: "K35.80", description: "Unspecified acute appendicitis", category: "Digestive" },
  { code: "K59.00", description: "Constipation, unspecified", category: "Digestive" },
  { code: "K92.2", description: "Gastrointestinal hemorrhage, unspecified", category: "Digestive" },

  // Skin (L00-L99)
  { code: "L97.4", description: "Non-pressure chronic ulcer of heel and midfoot", category: "Skin" },
  { code: "L97.9", description: "Non-pressure chronic ulcer of unspecified part of lower leg", category: "Skin" },
  { code: "L03.90", description: "Cellulitis, unspecified", category: "Skin" },
  { code: "L20.9", description: "Atopic dermatitis, unspecified", category: "Skin" },
  { code: "L70.0", description: "Acne vulgaris", category: "Skin" },

  // Musculoskeletal (M00-M99)
  { code: "M17.11", description: "Unilateral primary osteoarthritis, right knee", category: "Musculoskeletal" },
  { code: "M17.12", description: "Unilateral primary osteoarthritis, left knee", category: "Musculoskeletal" },
  { code: "M54.5", description: "Low back pain", category: "Musculoskeletal" },
  { code: "M54.50", description: "Low back pain, unspecified", category: "Musculoskeletal" },
  { code: "M25.561", description: "Pain in right knee", category: "Musculoskeletal" },
  { code: "M25.562", description: "Pain in left knee", category: "Musculoskeletal" },
  { code: "M79.7", description: "Fibromyalgia", category: "Musculoskeletal" },

  // Genitourinary (N00-N99)
  { code: "N18.9", description: "Chronic kidney disease, unspecified", category: "Genitourinary" },
  { code: "N18.6", description: "End stage renal disease", category: "Genitourinary" },
  { code: "N39.0", description: "Urinary tract infection, site not specified", category: "Genitourinary" },
  { code: "N40.0", description: "Benign prostatic hyperplasia without lower urinary tract symptoms", category: "Genitourinary" },

  // Mental (F01-F99)
  { code: "F41.1", description: "Generalized anxiety disorder", category: "Mental" },
  { code: "F33.1", description: "Major depressive disorder, recurrent, moderate", category: "Mental" },
  { code: "F43.10", description: "Post-traumatic stress disorder, unspecified", category: "Mental" },

  // Nervous (G00-G99)
  { code: "G89.29", description: "Other chronic pain", category: "Nervous" },
  { code: "G89.11", description: "Acute pain due to trauma", category: "Nervous" },
  { code: "G89.4", description: "Chronic pain syndrome", category: "Nervous" },
  { code: "G40.909", description: "Epilepsy, unspecified, not intractable, without status epilepticus", category: "Nervous" },
  { code: "G45.9", description: "Transient cerebral ischemic attack, unspecified", category: "Nervous" },

  // Symptoms / ill-defined (R00-R99)
  { code: "R51", description: "Headache", category: "Symptoms" },
  { code: "R10.9", description: "Unspecified abdominal pain", category: "Symptoms" },
  { code: "R50.9", description: "Fever, unspecified", category: "Symptoms" },
  { code: "R05.9", description: "Cough, unspecified", category: "Symptoms" },
  { code: "R07.9", description: "Chest pain, unspecified", category: "Symptoms" },
  { code: "R69", description: "Unknown causes of morbidity", category: "Symptoms" },

  // Infectious (A00-B99)
  { code: "A41.9", description: "Sepsis, unspecified organism", category: "Infectious" },
  { code: "B97.2", description: "Coronavirus as the cause of diseases classified elsewhere", category: "Infectious" },
  { code: "U07.1", description: "COVID-19, virus identified", category: "Infectious" },

  // Factors influencing health (Z00-Z99)
  { code: "Z00.00", description: "Encounter for general adult medical examination without abnormal findings", category: "Health Status" },
  { code: "Z79.4", description: "Long term (current) use of insulin", category: "Health Status" },
  { code: "Z79.01", description: "Long term (current) use of anticoagulants", category: "Health Status" },
];

/**
 * Curated Code-First / Use-Additional-Code rules.
 * Keyed by a stable rule id. The validator consumes this list.
 */
export interface CodeFirstRule {
  rule_id: string;
  description_en: string;
  description_ar: string;
  /** If the trigger code appears, this rule fires. */
  trigger_codes: string[];
  /** Codes that should accompany the trigger (suggested). */
  companion_codes: string[];
  /** Codes that should be re-ordered (placed earlier than the trigger). */
  code_first_codes?: string[];
  /** Clinical pattern keywords that activate the rule even without exact code match. */
  pattern_keywords?: string[];
}

export const CODE_FIRST_RULES: CodeFirstRule[] = [
  {
    rule_id: "DIABETES_WITH_FOOT_ULCER",
    description_en: "When diabetes is documented with a foot ulcer, the diabetes-with-foot-ulcer combination code (E11.621 or E13.621) is used FIRST; the ulcer code (L97.4) is added as secondary.",
    description_ar: "عند توثيق السكري مع قرحة القدم، يُستخدم رمز السكري المركب أولاً (E11.621) ثم يُضاف رمز القرحة (L97.4) كثانوي.",
    trigger_codes: ["E11.621", "E13.621", "E10.621"],
    companion_codes: ["L97.4", "L97.9"],
    pattern_keywords: ["diabetic foot", "foot ulcer", "diabetes with ulcer"],
  },
  {
    rule_id: "DIABETES_WITH_NEUROPATHY",
    description_en: "DM2 with diabetic neuropathy should use the combination code E11.40 (not E11.9 + separate neuropathy).",
    description_ar: "السكري من النوع الثاني مع اعتلال الأعصاب يجب أن يستخدم الرمز المركب E11.40 (وليس E11.9 + رمز مستقل لاعتلال الأعصاب).",
    trigger_codes: ["E11.40", "E11.42", "E10.40"],
    companion_codes: [],
    pattern_keywords: ["diabetic neuropathy", "diabetes with neuropathy"],
  },
  {
    rule_id: "POISONING_EXTERNAL_CAUSE",
    description_en: "For poisoning (T36-T50), code the poisoning FIRST, then add the external cause code (X40-X49, etc.) with 7th character.",
    description_ar: "في حالات التسمم (T36-T50)، يُرمز التسمم أولاً ثم يُضاف رمز السبب الخارجي (X40-X49) مع الحرف السابع.",
    trigger_codes: ["T36.0X1A", "T39.0X1A", "T50.9X1A"],
    companion_codes: [],
    pattern_keywords: ["poisoning", "overdose", "intoxication"],
  },
  {
    rule_id: "HTN_WITH_CKD",
    description_en: "Hypertension with chronic kidney disease uses I12.9 (or I12.0 with heart failure), not I10 + N18.x separately.",
    description_ar: "ارتفاع ضغط الدم مع المرض الكلوي المزمن يستخدم I12.9 (أو I12.0 مع فشل القلب) بدلاً من I10 + N18.x منفصلين.",
    trigger_codes: ["I12.9", "I12.0"],
    companion_codes: ["N18.9"],
    pattern_keywords: ["hypertensive ckd", "htn with ckd"],
  },
];
