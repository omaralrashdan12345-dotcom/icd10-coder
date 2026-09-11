/**
 * Chronic / co-existing condition matchers (UHDDS "other diagnoses").
 *
 * This is the single source of truth used by:
 *  - the Smart Offline Coder (mock.ts) to populate Secondary Diagnoses
 *  - the Validation Engine (validation.ts) SECONDARY_MISSING rule
 *
 * Per ICD-10-CM Official Guidelines Section III + UHDDS, a co-existing
 * condition is reportable as a secondary diagnosis when it affects patient
 * care during the encounter: clinical evaluation, therapeutic treatment,
 * diagnostic procedures, extended length of stay, or increased nursing
 * care and monitoring. Chronic conditions treated on an ongoing basis
 * should be coded and reported on EVERY relevant encounter.
 */

export interface ChronicConditionMatcher {
  /** Human-readable label (EN) for validation messages. */
  label_en: string;
  label_ar: string;
  /** Keywords (lowercase) matched with negation awareness against the note. */
  keywords: string[];
  /** ICD-10-CM code prefixes that would satisfy (cover) this condition. */
  code_prefixes: string[];
  /** Default code to assign when the offline coder activates this matcher. */
  default_code: string;
  /** Official short description for the default code. */
  description: string;
  /**
   * Optional refinement: returns a more specific code based on the note
   * (e.g. diabetes type / complication). Receives the lowercased note.
   */
  refine?: (note: string) => { code: string; description: string } | null;
  /** Relative specificity — higher wins when multiple matchers overlap. */
  specificity?: number;
}

export const CHRONIC_CONDITION_MATCHERS: ChronicConditionMatcher[] = [
  // ---------------- Diabetes family ----------------
  {
    label_en: "Type 2 diabetes mellitus",
    label_ar: "السكري من النوع الثاني",
    keywords: [
      "type 2 diabetes", "t2dm", "dm2", "diabetes mellitus type 2",
      "type ii diabetes", "controlled diabetes", "uncontrolled diabetes",
      "poorly controlled diabetes", "diabetic", "diabetes",
    ],
    code_prefixes: ["E11"],
    default_code: "E11.9",
    description: "Type 2 diabetes mellitus without complications",
    refine: (note) => {
      const type1 = /\btype\s*1\b|\bt1dm\b|\bdm1\b|\btype\s*i\b/.test(note);
      if (type1) return null; // handled by the T1DM matcher
      const uncontrolled =
        note.includes("uncontrolled") ||
        note.includes("poorly controlled") ||
        note.includes("hyperglycemia") ||
        note.includes("high blood sugar") ||
        note.includes("elevated glucose");
      const neuropathy = note.includes("neuropathy") || note.includes("numbness") || note.includes("tingling");
      const nephropathy = note.includes("nephropathy") || note.includes("ckd") || note.includes("kidney disease");
      const retinopathy = note.includes("retinopathy");
      const footUlcer = note.includes("foot ulcer") || note.includes("ulcer on") || note.includes("non-healing ulcer");
      if (footUlcer) return { code: "E11.621", description: "Type 2 diabetes mellitus with foot ulcer" };
      if (retinopathy) return { code: "E11.319", description: "Type 2 diabetes mellitus with unspecified diabetic retinopathy without macular edema" };
      if (nephropathy) return { code: "E11.22", description: "Type 2 diabetes mellitus with diabetic chronic kidney disease" };
      if (neuropathy) return { code: "E11.40", description: "Type 2 diabetes mellitus with diabetic neuropathy, unspecified" };
      if (uncontrolled) return { code: "E11.65", description: "Type 2 diabetes mellitus with hyperglycemia" };
      return null;
    },
    specificity: 9,
  },
  {
    label_en: "Type 1 diabetes mellitus",
    label_ar: "السكري من النوع الأول",
    keywords: ["type 1 diabetes", "t1dm", "dm1", "diabetes mellitus type 1", "type i diabetes", "juvenile diabetes"],
    code_prefixes: ["E10"],
    default_code: "E10.9",
    description: "Type 1 diabetes mellitus without complications",
    specificity: 9,
  },

  // ---------------- Cardiovascular ----------------
  {
    label_en: "Essential hypertension",
    label_ar: "ارتفاع ضغط الدم الأساسي",
    keywords: ["hypertension", "htn", "high blood pressure", "htn on", "bp elevated chronically", "antihypertensive"],
    code_prefixes: ["I10", "I11", "I12", "I13", "I15"],
    default_code: "I10",
    description: "Essential (primary) hypertension",
    refine: (note) => {
      // HTN + CKD combination rule
      const ckd = note.includes("ckd") || note.includes("chronic kidney") || note.includes("renal disease");
      const chf = note.includes("heart failure") || note.includes("chf");
      if (ckd) return { code: "I12.9", description: "Hypertensive chronic kidney disease with stage 1-4 or unspecified CKD" };
      if (chf) return { code: "I11.0", description: "Hypertensive heart disease with heart failure" };
      return null;
    },
    specificity: 8,
  },
  {
    label_en: "Chronic kidney disease",
    label_ar: "المرض الكلوي المزمن",
    keywords: ["chronic kidney disease", "ckd", "chronic renal failure", "renal insufficiency", "ckd stage"],
    code_prefixes: ["N18", "I12", "I13"],
    default_code: "N18.9",
    description: "Chronic kidney disease, unspecified",
    refine: (note) => {
      if (note.includes("stage 5") || note.includes("esrd") || note.includes("end stage") || note.includes("dialysis")) {
        return { code: "N18.6", description: "End stage renal disease" };
      }
      if (note.includes("stage 4")) return { code: "N18.4", description: "Chronic kidney disease, stage 4" };
      if (note.includes("stage 3b")) return { code: "N18.32", description: "Chronic kidney disease, stage 3b" };
      if (note.includes("stage 3a")) return { code: "N18.31", description: "Chronic kidney disease, stage 3a" };
      if (note.includes("stage 3")) return { code: "N18.3", description: "Chronic kidney disease, stage 3-unspecified" };
      if (note.includes("stage 2")) return { code: "N18.2", description: "Chronic kidney disease, stage 2" };
      return null;
    },
    specificity: 7,
  },
  {
    label_en: "Congestive heart failure",
    label_ar: "فشل القلب الاحتقاني",
    keywords: ["heart failure", "chf", "congestive heart failure", "hfref", "hfpef", "reduced ejection fraction"],
    code_prefixes: ["I50"],
    default_code: "I50.9",
    description: "Heart failure, unspecified",
    specificity: 8,
  },
  {
    label_en: "Atrial fibrillation",
    label_ar: "الرجفان الأذيني",
    keywords: ["atrial fibrillation", "afib", "a-fib", "af ", "paroxysmal af"],
    code_prefixes: ["I48"],
    default_code: "I48.91",
    description: "Unspecified atrial fibrillation",
    specificity: 8,
  },
  {
    label_en: "Ischemic heart disease / prior MI",
    label_ar: "مرض الشريان الإكليلي / احتشاء سابق",
    keywords: ["coronary artery disease", "cad", "ischemic heart disease", "prior mi", "previous heart attack", "history of mi", "stent", "angioplasty history"],
    code_prefixes: ["I25"],
    default_code: "I25.10",
    description: "Atherosclerotic heart disease of native coronary artery without angina pectoris",
    specificity: 7,
  },
  {
    label_en: "History of stroke / cerebral infarction",
    label_ar: "سابقة جلطة دماغية",
    keywords: ["stroke history", "prior stroke", "history of stroke", "previous cva", "old cva", "cerebral infarction history"],
    code_prefixes: ["Z86.7", "I69"],
    default_code: "Z86.73",
    description: "Personal history of transient ischemic attack (TIA), and cerebral infarction without residual deficits",
    specificity: 7,
  },
  {
    label_en: "Deep vein thrombosis / pulmonary embolism history",
    label_ar: "سابقة خثار وريدي عميق / صمامة رئوية",
    keywords: ["dvt history", "prior dvt", "pulmonary embolism history", "previous pe", "vte history", "dvt on anticoagulation"],
    code_prefixes: ["Z86.7", "I82"],
    default_code: "Z86.718",
    description: "Personal history of venous thrombosis and embolism",
    specificity: 7,
  },

  // ---------------- Respiratory ----------------
  {
    label_en: "COPD",
    label_ar: "المرض الرئوي الانسدادي المزمن",
    keywords: ["copd", "chronic obstructive pulmonary", "chronic bronchitis with", "emphysema"],
    code_prefixes: ["J44"],
    default_code: "J44.9",
    description: "Chronic obstructive pulmonary disease, unspecified",
    refine: (note) => {
      const exac = note.includes("exacerbation") || note.includes("acute on chronic");
      if (exac) return { code: "J44.1", description: "Chronic obstructive pulmonary disease with (acute) exacerbation" };
      return null;
    },
    specificity: 8,
  },
  {
    label_en: "Asthma",
    label_ar: "الربو",
    keywords: ["asthma", "reactive airway"],
    code_prefixes: ["J45"],
    default_code: "J45.909",
    description: "Unspecified asthma, uncomplicated",
    specificity: 8,
  },
  {
    label_en: "Obstructive sleep apnea",
    label_ar: "انقطاع النفس النومي الانسدادي",
    keywords: ["sleep apnea", "cpap", "osa"],
    code_prefixes: ["G47.3"],
    default_code: "G47.33",
    description: "Obstructive sleep apnea (adult) (pediatric)",
    specificity: 7,
  },

  // ---------------- Endocrine / metabolic ----------------
  {
    label_en: "Hypothyroidism",
    label_ar: "قصور الغدة الدرقية",
    keywords: ["hypothyroid", "underactive thyroid", "levothyroxine", "low thyroid"],
    code_prefixes: ["E03", "E89"],
    default_code: "E03.9",
    description: "Hypothyroidism, unspecified",
    specificity: 7,
  },
  {
    label_en: "Hyperlipidemia",
    label_ar: "ارتفاع الدهون في الدم",
    keywords: ["hyperlipidemia", "high cholesterol", "dyslipidemia", "hypercholesterolemia", "statin"],
    code_prefixes: ["E78"],
    default_code: "E78.5",
    description: "Hyperlipidemia, unspecified",
    specificity: 6,
  },
  {
    label_en: "Obesity",
    label_ar: "السمنة",
    keywords: ["obesity", "obese", "bmi over 30", "morbid obesity"],
    code_prefixes: ["E66", "Z68.4"],
    default_code: "E66.9",
    description: "Obesity, unspecified",
    specificity: 6,
  },

  // ---------------- Hematology ----------------
  {
    label_en: "Anemia",
    label_ar: "فقر الدم",
    keywords: ["anemia", "anaemia", "low hemoglobin", "low hb", "iron deficiency"],
    code_prefixes: ["D50", "D51", "D52", "D53", "D54", "D55", "D56", "D57", "D58", "D59", "D60", "D61", "D62", "D63", "D64"],
    default_code: "D64.9",
    description: "Anemia, unspecified",
    refine: (note) => {
      if (note.includes("iron deficiency")) return { code: "D50.9", description: "Iron deficiency anemia, unspecified" };
      if (note.includes("sickle cell")) return { code: "D57.00", description: "Hb-SS disease without crisis" };
      if (note.includes("thalassemia")) return { code: "D56.9", description: "Thalassemia, unspecified" };
      if (note.includes("ckd") || note.includes("chronic kidney") || note.includes("renal")) {
        return { code: "D63.1", description: "Anemia in chronic kidney disease" };
      }
      if (note.includes("acute blood loss") || note.includes("hemorrhagic")) {
        return { code: "D62", description: "Acute posthemorrhagic anemia" };
      }
      return null;
    },
    specificity: 6,
  },

  // ---------------- Musculoskeletal ----------------
  {
    label_en: "Osteoarthritis",
    label_ar: "الخشونة / الفصال العظمي",
    keywords: ["osteoarthritis", "degenerative joint disease", "djd", "oa of", "arthritis knee", "arthritis hip"],
    code_prefixes: ["M15", "M16", "M17", "M18", "M19"],
    default_code: "M19.90",
    description: "Unspecified osteoarthritis, unspecified site",
    refine: (note) => {
      const knee = note.includes("knee");
      const hip = note.includes("hip");
      const bilateral = /\bbilateral\b|both knees|both hips/.test(note);
      const right = /\bright\b/.test(note) && !bilateral;
      const left = /\bleft\b/.test(note) && !bilateral;
      if (knee && bilateral) return { code: "M17.0", description: "Bilateral primary osteoarthritis of knee" };
      if (knee && right) return { code: "M17.11", description: "Unilateral primary osteoarthritis, right knee" };
      if (knee && left) return { code: "M17.12", description: "Unilateral primary osteoarthritis, left knee" };
      if (knee) return { code: "M17.9", description: "Osteoarthritis of knee, unspecified" };
      if (hip && bilateral) return { code: "M16.0", description: "Bilateral primary osteoarthritis of hip" };
      if (hip && right) return { code: "M16.11", description: "Unilateral primary osteoarthritis, right hip" };
      if (hip && left) return { code: "M16.12", description: "Unilateral primary osteoarthritis, left hip" };
      return null;
    },
    specificity: 6,
  },
  {
    label_en: "Osteoporosis",
    label_ar: "هشاشة العظام",
    keywords: ["osteoporosis", "low bone density", "osteopenia"],
    code_prefixes: ["M80", "M81", "M82"],
    default_code: "M81.80",
    description: "Other osteoporosis without current pathological fracture, unspecified site",
    specificity: 7,
  },

  // ---------------- Mental health ----------------
  {
    label_en: "Depression",
    label_ar: "الاكتئاب",
    keywords: ["depression", "depressive disorder", "mdd", "major depressive"],
    code_prefixes: ["F32", "F33"],
    default_code: "F33.9",
    description: "Major depressive disorder, recurrent, unspecified",
    specificity: 7,
  },
  {
    label_en: "Anxiety disorder",
    label_ar: "اضطراب القلق",
    keywords: ["anxiety", "gad", "panic disorder", "anxious"],
    code_prefixes: ["F41"],
    default_code: "F41.9",
    description: "Anxiety disorder, unspecified",
    specificity: 7,
  },
  {
    label_en: "PTSD",
    label_ar: "اضطراب ما بعد الصدمة",
    keywords: ["ptsd", "post-traumatic stress", "post traumatic stress"],
    code_prefixes: ["F43.1"],
    default_code: "F43.10",
    description: "Post-traumatic stress disorder, unspecified",
    specificity: 7,
  },
  {
    label_en: "Dementia / cognitive impairment",
    label_ar: "الخرف / ضعف الإدراك",
    keywords: ["dementia", "alzheimer", "cognitive impairment", "memory loss chronic"],
    code_prefixes: ["F03", "G30", "F01", "F02"],
    default_code: "F03.90",
    description: "Unspecified dementia, unspecified severity, without behavioral disturbance",
    specificity: 7,
  },

  // ---------------- GI / GU ----------------
  {
    label_en: "GERD",
    label_ar: "الجزر المعدي المريئي",
    keywords: ["gerd", "gastro-esophageal reflux", "gastroesophageal reflux", "reflux disease"],
    code_prefixes: ["K21"],
    default_code: "K21.9",
    description: "Gastro-esophageal reflux disease without esophagitis",
    specificity: 6,
  },
  {
    label_en: "Benign prostatic hyperplasia",
    label_ar: "تضخم البروستاتا الحميد",
    keywords: ["bph", "benign prostatic", "prostate enlargement", "enlarged prostate"],
    code_prefixes: ["N40"],
    default_code: "N40.1",
    description: "Benign prostatic hyperplasia with lower urinary tract symptoms",
    specificity: 6,
  },
  {
    label_en: "Cirrhosis / chronic liver disease",
    label_ar: "تليف الكبد / مرض الكبد المزمن",
    keywords: ["cirrhosis", "chronic liver disease", "hepatic insufficiency chronic"],
    code_prefixes: ["K70", "K71", "K72", "K73", "K74"],
    default_code: "K74.60",
    description: "Unspecified cirrhosis of liver",
    specificity: 7,
  },

  // ---------------- Misc chronic ----------------
  {
    label_en: "Cancer history / active malignancy",
    label_ar: "سابقة أو نشاط ورم خبيث",
    keywords: ["cancer", "carcinoma", "lymphoma", "leukemia", "malignancy", "on chemotherapy", "tumor"],
    code_prefixes: ["C", "Z85"],
    default_code: "Z85.9",
    description: "Personal history of unspecified malignant neoplasm",
    specificity: 6,
  },
  {
    label_en: "Tobacco use disorder",
    label_ar: "استخدام التبغ",
    keywords: ["smoker", "smoking", "tobacco use", "cigarette use", "pack-years", "vapes", "vaping"],
    code_prefixes: ["F17", "Z72.0", "Z87.891"],
    default_code: "F17.210",
    description: "Nicotine dependence, cigarettes, uncomplicated",
    specificity: 5,
  },
  {
    label_en: "Rheumatoid arthritis",
    label_ar: "التهاب المفاصل الروماتويدي",
    keywords: ["rheumatoid", "ra ", "ra.", "seropositive arthritis"],
    code_prefixes: ["M05", "M06"],
    default_code: "M06.9",
    description: "Rheumatoid arthritis, unspecified",
    specificity: 7,
  },
  {
    label_en: "Gout",
    label_ar: "النقرس",
    keywords: ["gout", "gouty arthritis", "hyperuricemia chronic"],
    code_prefixes: ["M10"],
    default_code: "M10.9",
    description: "Gout, unspecified",
    specificity: 7,
  },
  {
    label_en: "HIV",
    label_ar: "فيروس نقص المناعة",
    keywords: ["hiv", "aids", "antiretroviral"],
    code_prefixes: ["B20", "Z21"],
    default_code: "Z21",
    description: "Asymptomatic human immunodeficiency virus infection status",
    specificity: 8,
  },
  {
    label_en: "Hepatitis B/C chronic",
    label_ar: "التهاب كبدي مزمن",
    keywords: ["hepatitis b", "hepatitis c", "hbv", "hcv"],
    code_prefixes: ["B16", "B17", "B18"],
    default_code: "B18.9",
    description: "Unspecified viral hepatitis without hepatic coma",
    specificity: 7,
  },
];
