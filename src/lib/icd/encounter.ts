/**
 * Episode-of-care detection (Sprint 3).
 *
 * Shared by the offline coder (mock.ts) and the validation engine
 * (validation.ts). Determines WHICH encounter of an injury episode the
 * note documents, which drives the ICD-10-CM 7th character:
 *
 *   initial    -> A (closed) / B, C (open fracture, Gustilo I-II / III)
 *   subsequent -> D (routine healing) / G (delayed) / K (nonunion) /
 *                 P (malunion) — plus open-fracture variants B, C on
 *                 categories that support them
 *   sequela    -> S (late effects / residual conditions)
 *
 * External-cause codes (V/W/X/Y) and injury codes (S/T) must share the
 * SAME episode-of-care 7th character within one encounter.
 */

export type EncounterType = "initial" | "subsequent" | "sequela";

/**
 * Sequela cues. A cue that appears inside a negated phrase
 * ("history of stroke with NO residual deficits") must NOT classify the
 * encounter as a sequela visit — a small look-back window guards this.
 */
const SEQUELA_CUES = [
  "sequela",
  "late effect",
  "residual",
  "old injury",
  "old fracture",
  "permanent damage from",
];

const SEQUELA_NEGATIONS = /\b(no|not|without|denies|negative for|free of)\b/i;

function cuePresentNotNegated(t: string, cue: string): boolean {
  let i = t.indexOf(cue);
  while (i !== -1) {
    const window = t.slice(Math.max(0, i - 30), i);
    if (!SEQUELA_NEGATIONS.test(window)) return true;
    i = t.indexOf(cue, i + 1);
  }
  return false;
}

const SUBSEQUENT_CUES = [
  "follow-up",
  "follow up",
  "followup",
  "recheck",
  "suture removal",
  "post-op",
  "postop",
  "post op",
  "cast check",
  "wound check",
  "routine healing",
  "return visit",
  "review of",
  "re-evaluation",
  "reevaluation",
];

export function detectEncounterType(text: string): EncounterType {
  const t = text.toLowerCase();
  if (SEQUELA_CUES.some((cue) => cuePresentNotNegated(t, cue))) {
    return "sequela";
  }
  if (SUBSEQUENT_CUES.some((cue) => t.includes(cue))) {
    return "subsequent";
  }
  return "initial";
}

/** 7th character for the episode-of-care, before open-fracture / healing refinements. */
export const ENCOUNTER_CHAR: Record<EncounterType, "A" | "D" | "S"> = {
  initial: "A",
  subsequent: "D",
  sequela: "S",
};

export const ENCOUNTER_DESC: Record<EncounterType, string> = {
  initial: "initial",
  subsequent: "subsequent",
  sequela: "sequela",
};
