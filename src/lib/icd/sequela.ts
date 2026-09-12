/**
 * Sequela dual-coding engine (Sprint 3, Idea C).
 *
 * ICD-10-CM Official Guidelines I.C.19.2 (Sequela): when a condition
 * arises as a late effect of a previous injury/illness, TWO codes are
 * generally required:
 *
 *   1. FIRST  — the code for the RESIDUAL condition (the current problem,
 *               e.g. chronic pain, stiffness, numbness, scar)
 *   2. THEN   — the original injury/condition code with 7th character "S"
 *
 * Example: "chronic right wrist pain, sequela of an old distal radius
 * fracture"  ->  M25.511 (pain in right wrist) FIRST,
 *                then S52.501S (fracture of right radius, sequela).
 *
 * This module documents-and-detects the RESIDUAL condition from the note.
 * All emitted codes were verified against the bundled FY2026 ICD-10-CM
 * dataset (public/icd10cm/). Laterality follows the standard convention
 * (1 = right, 2 = left, 9 = unspecified).
 */

export type ResidualSide = "right" | "left" | "bilateral" | "unspecified";

export interface ResidualHit {
  /** Stable id of the residual type, e.g. "joint-pain". */
  id: string;
  /** Fully resolved ICD-10-CM code (laterality applied). */
  code: string;
  description: string;
  confidence: number;
  specificity: number;
  side: ResidualSide;
}

export type PresentFn = (keyword: string) => boolean;
export type SideFn = (keywords: string[]) => ResidualSide;

/** Laterality digit per ICD-10-CM convention (bilateral falls back to 9). */
const SIDE_DIGIT: Record<ResidualSide, string> = {
  right: "1",
  left: "2",
  bilateral: "9",
  unspecified: "9",
};

const SIDE_DESC: Record<ResidualSide, string> = {
  right: "right",
  left: "left",
  bilateral: "bilateral",
  unspecified: "unspecified",
};

/** Joint-site word -> M25.5x (pain in joint) / M25.6x (stiffness of joint) family digit. */
const JOINT_FAMILIES: Record<string, string> = {
  shoulder: "1",
  elbow: "2",
  wrist: "3",
  hand: "4",
  hip: "5",
  knee: "6",
  ankle: "7",
  foot: "7",
};

/**
 * FY2026 M79.6 "pain in limb" layout (verified against the bundled DB):
 * M79.601/2/3 pain in arm right/left/unspecified,
 * M79.604/5/6 pain in leg right/left/unspecified.
 */
const LIMB_PAIN: Record<string, [string, string, string]> = {
  arm: ["M79.601", "M79.602", "M79.603"],
  leg: ["M79.604", "M79.605", "M79.606"],
};

function detectJointSite(t: string): string | null {
  for (const site of Object.keys(JOINT_FAMILIES)) {
    if (new RegExp(`\\b${site}\\b`, "i").test(t)) return site;
  }
  return null;
}

function detectLimbSite(t: string): string | null {
  for (const site of Object.keys(LIMB_PAIN)) {
    if (new RegExp(`\\b${site}\\b`, "i").test(t)) return site;
  }
  return null;
}

/**
 * Detect documented residual conditions of a sequela episode.
 *
 * `present` is the negation-aware keyword matcher supplied by the caller
 * (injected to avoid a circular import with validation.ts); `detectSide`
 * resolves laterality scoped to the residual keyword window.
 */
export function detectResidualConditions(
  note: string,
  present: PresentFn,
  detectSide: SideFn
): ResidualHit[] {
  const t = note.toLowerCase();
  if (!t) return [];
  const hits: ResidualHit[] = [];

  // 1. Joint stiffness (site-localized when possible) — M25.6-
  if (present("stiffness") || present("joint stiffness") || present("stiff joint")) {
    const site = detectJointSite(t);
    if (site) {
      const side = detectSide([site, "stiffness"]);
      const code = `M25.6${JOINT_FAMILIES[site]}${SIDE_DIGIT[side]}`;
      hits.push({
        id: "joint-stiffness",
        code,
        description: `Stiffness of ${SIDE_DESC[side]} ${site}, not elsewhere classified (residual of prior injury)`,
        confidence: 0.84,
        specificity: 8,
        side,
      });
    }
  }

  // 2. Pain — site/limb-localized, otherwise chronic-pain G89.29
  const painKw = ["chronic pain", "persistent pain", "ongoing pain", "residual pain", "pain"].find(
    (k) => present(k)
  );
  if (painKw) {
    const site = detectJointSite(t);
    const limb = detectLimbSite(t);
    const side = detectSide([painKw, ...(site ? [site] : []), ...(limb ? [limb] : [])]);
    if (site) {
      const code = `M25.5${JOINT_FAMILIES[site]}${SIDE_DIGIT[side]}`;
      hits.push({
        id: "joint-pain",
        code,
        description: `Chronic pain in ${SIDE_DESC[side]} ${site} (residual of prior injury)`,
        confidence: 0.86,
        specificity: 9,
        side,
      });
    } else if (limb) {
      const code = LIMB_PAIN[limb][side === "right" ? 0 : side === "left" ? 1 : 2];
      hits.push({
        id: "limb-pain",
        code,
        description: `Chronic pain in ${SIDE_DESC[side]} ${limb} (residual of prior injury)`,
        confidence: 0.84,
        specificity: 8,
        side,
      });
    } else {
      hits.push({
        id: "chronic-pain",
        code: "G89.29",
        description: "Other chronic pain (residual of prior injury)",
        confidence: 0.78,
        specificity: 6,
        side: "unspecified",
      });
    }
  }

  // 3. Numbness / tingling — R20.2
  if (present("numbness") || present("tingling") || present("pins and needles")) {
    hits.push({
      id: "numbness",
      code: "R20.2",
      description: "Paresthesia of skin (residual of prior injury)",
      confidence: 0.78,
      specificity: 5,
      side: detectSide(["numbness", "tingling"]),
    });
  }

  // 4. Weakness — M62.81
  if (present("weakness")) {
    hits.push({
      id: "weakness",
      code: "M62.81",
      description: "Muscle weakness (generalized) (residual of prior injury)",
      confidence: 0.78,
      specificity: 5,
      side: "unspecified",
    });
  }

  // 5. Headache (e.g. post-concussion) — R51.9
  if (present("headache")) {
    hits.push({
      id: "headache",
      code: "R51.9",
      description: "Headache, unspecified (residual of prior injury)",
      confidence: 0.78,
      specificity: 5,
      side: "unspecified",
    });
  }

  // 6. Scar / scarring — L90.5
  if (present("scar") || present("scarring")) {
    hits.push({
      id: "scar",
      code: "L90.5",
      description: "Scar conditions and fibrosis of skin (residual of prior injury)",
      confidence: 0.8,
      specificity: 6,
      side: "unspecified",
    });
  }

  // 7. Persistent swelling / edema — R60.9
  if (present("swelling") || present("persistent edema")) {
    hits.push({
      id: "swelling",
      code: "R60.9",
      description: "Edema, unspecified (residual of prior injury)",
      confidence: 0.72,
      specificity: 4,
      side: detectSide(["swelling"]),
    });
  }

  // 8. Gait abnormality / limping — R26.89
  if (present("limping") || present("limp") || present("gait abnormality") || present("difficulty walking")) {
    hits.push({
      id: "gait",
      code: "R26.89",
      description: "Other abnormalities of gait and mobility (residual of prior injury)",
      confidence: 0.76,
      specificity: 5,
      side: "unspecified",
    });
  }

  // Most specific first (site-localized + longer keyword match).
  hits.sort((a, b) => b.specificity - a.specificity);
  return hits;
}

/**
 * Code prefixes that represent RESIDUAL-condition codes per the library
 * above. Used by the validation engine to check sequela dual-coding.
 */
export const RESIDUAL_CODE_PREFIXES: string[] = [
  "M25.5", // pain in joint
  "M25.6", // stiffness of joint
  "M79.6", // pain in limb
  "G89.2", // chronic pain
  "R20.2", // paresthesia
  "M62.8", // muscle weakness
  "R51.9", // headache
  "L90.5", // scar
  "R60.9", // edema
  "R26.8", // gait abnormality
];

export function isResidualCode(code: string): boolean {
  const c = code.toUpperCase();
  return RESIDUAL_CODE_PREFIXES.some((p) => c.startsWith(p));
}

/**
 * True when `code` is an injury/poisoning code carrying the sequela 7th
 * character "S" (T30-T32 excluded — they take no 7th character).
 */
export function isSequelaInjuryCode(code: string): boolean {
  const c = code.toUpperCase();
  if (!/^[ST]/.test(c)) return false;
  if (/^T3[0-2]/.test(c)) return false;
  return c.length >= 7 && c.endsWith("S");
}
