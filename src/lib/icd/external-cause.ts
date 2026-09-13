import type { ClinicalCodingResponse, ICDCodeDetail } from "@/lib/schemas/icd";

/**
 * External Cause of Morbidity (Chapter 20, V/W/X/Y) enforcement.
 *
 * Implements the ICD-10-CM Official Guidelines (Section I.A. and Chapter 19):
 *  - External cause codes are NEVER first-listed / principal.
 *  - They are supplemental codes reported BESIDES the injury (S/T) code.
 *  - The 7th character (A/D/S) must MATCH the injury code's 7th character.
 *  - Companion codes (Y92 place, Y93 activity, Y99 status) are initial-encounter only.
 *
 * This module guarantees that any encounter whose Primary is an S/T injury code
 * also carries at least one external cause code (V/W/X/Y) in tertiary.
 */

const MECHANISM_RULES: { keywords: string[]; code: string; description: string; confidence: number }[] = [
  { keywords: ["cat scratch", "cat bite", "clawed", "fell from cat", "other contact with cat"], code: "W55.03XA", description: "Other contact with cat, initial encounter", confidence: 0.88 },
  { keywords: ["dog bite", "bitten by dog", "dog attack", "bit by dog"], code: "W54.0XXA", description: "Bitten by dog, initial encounter", confidence: 0.9 },
  { keywords: ["fall", "fell", "slipped", "trip", "tripped", "stumbled", "lost balance"], code: "W19.XXXA", description: "Unspecified fall, initial encounter", confidence: 0.86 },
  { keywords: ["motor vehicle accident", "mva", "car accident", "car crash", "auto accident", "vehicle collision", "traffic accident"], code: "V89.2XXA", description: "Person injured in unspecified motor-vehicle accident, traffic, initial encounter", confidence: 0.82 },
  { keywords: ["pedestrian struck", "hit by car", "hit by vehicle"], code: "V09.2XXA", description: "Pedestrian injured in unspecified traffic accident, initial encounter", confidence: 0.78 },
  { keywords: ["burn", "scalded", "scald", "hot water", "boiling water"], code: "X10.1XXA", description: "Contact with hot water, initial encounter", confidence: 0.8 },
  { keywords: ["knife", "cut by", "sharp object", "glass", "laceration"], code: "W26.XXXA", description: "Contact with other sharp object, initial encounter", confidence: 0.72 },
];

const GENERIC_EXTERNAL_CAUSE = {
  code: "W19.XXXA",
  description: "Unspecified fall, initial encounter",
  confidence: 0.5,
};

function isInjuryCode(primaryCode: string): boolean {
  const c = primaryCode.charAt(0).toUpperCase();
  return c === "S" || c === "T";
}

function isExternalCauseCode(code: string): boolean {
  const c = code.charAt(0).toUpperCase();
  return c === "V" || c === "W" || c === "X" || c === "Y";
}

/**
 * T36-T65 (poisoning T36-T50, toxic effects T51-T65) carry the EXTERNAL-CAUSE
 * INTENT inside the code itself: the 5th/6th character encodes accidental /
 * intentional self-harm / assault / undetermined, and the 7th character the
 * encounter. FY2027 Official Guidelines (I.C.19.b, I.C.20): Chapter 20
 * reporting is not nationally required, and external-cause status (Y99) is
 * explicitly "not applicable to poisonings, adverse effects, misadventures or
 * late effects" — the intent character IS the external-cause coding
 * (established in v0.8.2: no X/Y externals are emitted alongside T36-T50).
 *
 * Forcing the generic W19.XXXA "unspecified fall" fallback onto such
 * encounters fabricated a fall that never happened (v0.9.1 documented nuance:
 * live D1/D3/D5 carried W19@0.5 + LOW_CONFIDENCE purely from this path).
 */
export function isIntentBearingToxicEffect(code: string): boolean {
  return /^T(3[6-9]|4\d|5\d|6[0-5])/.test(code.toUpperCase());
}

/**
 * Ensure every injury encounter reports an external cause code.
 * Mutation strategy: returns a NEW tertiary array; the caller decides how to merge.
 */
export function computeExternalCause(
  primary: ICDCodeDetail,
  secondary: ICDCodeDetail[],
  tertiary: ICDCodeDetail[] | undefined,
  note: string
): ICDCodeDetail | null {
  if (!isInjuryCode(primary.code)) return null;
  // Poisoning / toxic-effect primaries: the intent character already IS the
  // external-cause coding — never fabricate a V/W/X/Y supplement (esp. the
  // W19 "unspecified fall" fallback) for these encounters.
  if (isIntentBearingToxicEffect(primary.code)) return null;
  // Already has an external cause code anywhere? Nothing to add.
  const allCodes = [primary, ...(secondary ?? []), ...(tertiary ?? [])];
  if (allCodes.some((d) => isExternalCauseCode(d.code))) return null;

  const text = note.toLowerCase();
  const matched = MECHANISM_RULES.find((r) => r.keywords.some((k) => text.includes(k)));
  const src = matched ?? GENERIC_EXTERNAL_CAUSE;

  // 7th character must match the injury code's 7th character (A/D/S).
  const injurySeventh = /[ADS]$/.test(primary.code) ? primary.code[primary.code.length - 1] : "A";

  const detail: ICDCodeDetail = {
    code: src.code,
    description: src.description,
    rationale: matched
      ? `External cause code (supplemental) matched from clinical text: "${matched.keywords.find((k) => text.includes(k))}". Reports how the injury occurred. 7th char ${injurySeventh} matches the injury code per ICD-10-CM guidelines.`
      : "External cause code (supplemental). Mechanism not explicitly documented, so the unspecified fall code W19.XXXA is used to comply with reporting external cause codes with injury codes.",
    confidence: src.confidence,
    laterality: "not_applicable",
    acuity: "not_applicable",
    seventh_character: injurySeventh as ICDCodeDetail["seventh_character"],
  };

  // Avoid duplicating a code that is already present (e.g. as primary injury)
  if (allCodes.some((d) => d.code === detail.code)) return null;
  return detail;
}

/**
 * Convenience wrapper: attaches the computed external cause to a parsed response.
 */
export function ensureExternalCause(resp: ClinicalCodingResponse, note: string): void {
  if (!resp?.primary_icd10) return;
  const extra = computeExternalCause(
    resp.primary_icd10,
    resp.secondary_icd10 ?? [],
    resp.tertiary_icd10,
    note
  );
  if (extra) {
    resp.tertiary_icd10 = [...(resp.tertiary_icd10 ?? []), extra];
  }
}