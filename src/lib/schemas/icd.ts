import { z } from "zod";

/**
 * ICD-10-CM Structured Output Schemas
 * Mirrors the Pydantic models in the original design spec.
 */

export const ICDCodeDetailSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(10)
    .describe("The exact ICD-10-CM code including 7th character if applicable (e.g. S80.01XA, E11.9, W55.03XA)"),
  description: z.string().describe("Official English description of the code as it appears in the ICD-10-CM Tabular List"),
  rationale: z.string().describe("Clinical reasoning for selecting this code and placing it at this level (Primary / Secondary / Tertiary). Should reference the source clinical text."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score from 0 to 1 reflecting how certain the coder is that this code and level are correct"),
  laterality: z
    .enum(["right", "left", "bilateral", "unspecified", "not_applicable"])
    .optional()
    .describe("Laterality if relevant to the code (right/left/bilateral)"),
  acuity: z
    .enum(["acute", "chronic", "acute_on_chronic", "unspecified", "not_applicable"])
    .optional()
    .describe("Acuity of the condition"),
  seventh_character: z
    .enum(["A", "D", "S", "not_required", "missing"])
    .optional()
    .describe("7th character value: A=initial encounter, D=subsequent, S=sequela. 'missing' means required but not provided. 'not_required' means the code does not take a 7th character."),
});

export const ClinicalCodingResponseSchema = z.object({
  primary_icd10: ICDCodeDetailSchema.describe("The principal diagnosis — the chief complaint / main reason for the encounter"),
  secondary_icd10: z
    .array(ICDCodeDetailSchema)
    .default([])
    .describe(
      "ALL co-existing conditions that affect patient care during this encounter (UHDDS 'other diagnoses' / OGCR Section III) — chronic AND acute. " +
      "Includes chronic comorbidities (diabetes, hypertension, CKD, COPD, AF, hypothyroidism, hyperlipidemia, osteoporosis, …) AND other active conditions " +
      "requiring clinical evaluation, therapeutic treatment, diagnostic procedures, or monitoring (e.g. dehydration, anemia, hypoglycemia). " +
      "External cause codes (V/W/X/Y) do NOT belong here — they are supplemental and go last."
    ),
  tertiary_icd10: z
    .array(ICDCodeDetailSchema)
    .default([])
    .describe(
      "Supplemental codes reported AFTER all diagnosis codes: external cause codes (V/W/X/Y — how the injury happened), place of occurrence (Y92), " +
      "activity (Y93), external cause status (Y99), acute complications of the primary, and accompanying symptoms/findings. " +
      "Per ICD-10-CM Chapter 20 guidelines, external cause codes are NEVER the principal/first-listed diagnosis."
    ),
  summary: z.string().optional().describe("Optional short narrative summary of the encounter and coding rationale"),
  entities_extracted: z
    .array(
      z.object({
        entity: z.string(),
        type: z.enum(["disease", "symptom", "laterality", "acuity", "external_cause", "chronic_condition", "procedure", "medication"]),
        value: z.string(),
      })
    )
    .default([])
    .describe("Clinical entities extracted from the source text via NER"),
});

export type ICDCodeDetail = z.infer<typeof ICDCodeDetailSchema>;
export type ClinicalCodingResponse = z.infer<typeof ClinicalCodingResponseSchema>;

/**
 * Validation issue raised by the Validation Engine.
 */
export const ValidationIssueSchema = z.object({
  level: z.enum(["error", "warning", "info"]),
  code: z.string().optional(),
  rule: z.string().describe("Machine-readable rule id, e.g. SEVENTH_CHAR_REQUIRED, CODE_FIRST_DIABETES_NEUROPATHY"),
  message_en: z.string(),
  message_ar: z.string(),
  suggestion_en: z.string().optional(),
  suggestion_ar: z.string().optional(),
});

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

/**
 * Final API response returned by /api/code
 */
export const CodingApiResponseSchema = z.object({
  ok: z.boolean(),
  model: z.string(),
  raw_response: ClinicalCodingResponseSchema,
  validation_issues: z.array(ValidationIssueSchema).default([]),
  rag_context: z
    .array(
      z.object({
        code: z.string(),
        description: z.string(),
        score: z.number(),
        source: z.enum(["nlm", "vector_db", "builtin"]),
      })
    )
    .default([]),
  latency_ms: z.number(),
});

export type CodingApiResponse = z.infer<typeof CodingApiResponseSchema>;
