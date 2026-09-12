/**
 * ICD-10-CM chapter table (21 chapters) with bilingual labels.
 * Used to tag full-database search results with their chapter.
 */

export interface IcdChapter {
  id: number;
  /** Inclusive code range (string compare on normalized codes). */
  from: string;
  to: string;
  label_en: string;
  label_ar: string;
}

export const ICD10CM_CHAPTERS: IcdChapter[] = [
  { id: 1, from: "A00", to: "B99", label_en: "Certain infectious and parasitic diseases", label_ar: "الأمراض المعدية والطفيلية" },
  { id: 2, from: "C00", to: "D49", label_en: "Neoplasms", label_ar: "الأورام" },
  { id: 3, from: "D50", to: "D89", label_en: "Diseases of the blood and blood-forming organs", label_ar: "أمراض الدم" },
  { id: 4, from: "E00", to: "E89", label_en: "Endocrine, nutritional and metabolic diseases", label_ar: "أمراض الغدد والتمثيل الغذائي" },
  { id: 5, from: "F01", to: "F99", label_en: "Mental, behavioral and neurodevelopmental disorders", label_ar: "الاضطرابات النفسية والسلوكية" },
  { id: 6, from: "G00", to: "G99", label_en: "Diseases of the nervous system", label_ar: "أمراض الجهاز العصبي" },
  { id: 7, from: "H00", to: "H59", label_en: "Diseases of the eye and adnexa", label_ar: "أمراض العين" },
  { id: 8, from: "H60", to: "H95", label_en: "Diseases of the ear and mastoid process", label_ar: "أمراض الأذن" },
  { id: 9, from: "I00", to: "I99", label_en: "Diseases of the circulatory system", label_ar: "أمراض الدورة الدموية" },
  { id: 10, from: "J00", to: "J99", label_en: "Diseases of the respiratory system", label_ar: "أمراض الجهاز التنفسي" },
  { id: 11, from: "K00", to: "K95", label_en: "Diseases of the digestive system", label_ar: "أمراض الجهاز الهضمي" },
  { id: 12, from: "L00", to: "L99", label_en: "Diseases of the skin and subcutaneous tissue", label_ar: "أمراض الجلد" },
  { id: 13, from: "M00", to: "M99", label_en: "Diseases of the musculoskeletal system and connective tissue", label_ar: "أمراض العضلات والعظام" },
  { id: 14, from: "N00", to: "N99", label_en: "Diseases of the genitourinary system", label_ar: "أمراض الجهاز البولي التناسلي" },
  { id: 15, from: "O00", to: "O9A", label_en: "Pregnancy, childbirth and the puerperium", label_ar: "الحمل والولادة والنفاس" },
  { id: 16, from: "P00", to: "P96", label_en: "Certain conditions originating in the perinatal period", label_ar: "حالات ما حول الولادة" },
  { id: 17, from: "Q00", to: "QA1", label_en: "Congenital malformations, deformations and chromosomal abnormalities (Q00-QA1, incl. genetic neurodevelopmental and neoplasm-predisposition disorders)", label_ar: "التشوهات الخلقية" },
  { id: 18, from: "R00", to: "R99", label_en: "Symptoms, signs and abnormal clinical findings", label_ar: "الأعراض والعلامات" },
  { id: 19, from: "S00", to: "T88", label_en: "Injury, poisoning and certain other consequences of external causes", label_ar: "الإصابات والتسمم" },
  { id: 20, from: "V00", to: "Y99", label_en: "External causes of morbidity", label_ar: "الأسباب الخارجية" },
  { id: 21, from: "Z00", to: "Z99", label_en: "Factors influencing health status and contact with health services", label_ar: "عوامل مؤثرة على الحالة الصحية" },
];

/** Normalize a code for comparison: uppercase, trim. */
export function normCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Find the ICD-10-CM chapter a code belongs to. */
export function chapterOfCode(code: string): IcdChapter | null {
  const c = normCode(code);
  // Codes are matched on their first 3 chars against chapter ranges.
  const stem = c.slice(0, 3);
  for (const ch of ICD10CM_CHAPTERS) {
    if (stem >= ch.from && stem <= ch.to) return ch;
  }
  return null;
}
