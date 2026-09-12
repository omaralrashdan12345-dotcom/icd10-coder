/**
 * CVA (stroke) late-effect engine (Sprint 4, Idea S).
 *
 * ICD-10-CM Official Guidelines I.C.6.a (Sequelae of cerebrovascular
 * disease): when a late effect of a cerebrovascular event is documented,
 * TWO codes are generally required:
 *
 *   1. FIRST  — the code for the underlying cerebrovascular condition
 *               (I60-I67: the original stroke)
 *   2. THEN   — the I69.- code for the residual (late-effect) condition
 *
 * Example: "left hemiparesis after an ischemic stroke last year"
 *   ->  I63.9 (cerebral infarction, unspecified) FIRST,
 *       then I69.354 (hemiplegia/hemiparesis following cerebral infarction
 *            affecting left non-dominant side).
 *
 * FY2026 dataset note (verified against the bundled public/icd10cm/ DB):
 * the I69.4- family ("sequelae of stroke, not specified as hemorrhage or
 * infarction") is NOT present in the FY2026 order file — the family jumps
 * from I69.3- to I69.8-. Strokes documented only as "stroke/CVA" (type
 * unspecified) therefore map to the I69.9- family (sequelae of
 * unspecified cerebrovascular disease), NEVER to I69.4-.
 *
 * Dominance convention (verified FY2026 descriptions, x5 ladders):
 *   .x51 affecting right dominant side
 *   .x52 affecting left dominant side
 *   .x53 affecting right non-dominant side
 *   .x54 affecting left non-dominant side
 *   .x59 affecting unspecified side
 * When the note does not state hand dominance, the patient is presumed
 * right-hand dominant (the usual coding default): a right-sided deficit
 * is then "right dominant" (.x51) and a left-sided one "left
 * non-dominant" (.x54).
 */

export interface StrokeResidualHit {
  id: string;
  code: string;
  description: string;
  confidence: number;
}

export interface StrokeSequelaResult {
  /** Underlying cerebrovascular condition code (I60.-/I61.-/I62.-/I63.-/I64.-). */
  underlyingCode: string;
  underlyingDescription: string;
  /** The I69 family matching the underlying type, e.g. "I69.3". */
  i69Family: string;
  /** Human label of the documented stroke type, e.g. "ischemic stroke". */
  typeLabel: string;
  residuals: StrokeResidualHit[];
}

export type PresentFn = (keyword: string) => boolean;

type StrokeType = "sah" | "ich" | "other_ich" | "infarction" | "nos";

interface FamilyLayout {
  underlyingCode: string;
  underlyingDescription: string;
  i69Family: string;
  typeLabel: string;
}

/** Underlying-code -> I69-family mapping per FY2026 (I69.4- retired from dataset). */
const FAMILY_BY_TYPE: Record<StrokeType, FamilyLayout> = {
  sah: {
    underlyingCode: "I60.9",
    underlyingDescription: "Subarachnoid hemorrhage, unspecified",
    i69Family: "I69.0",
    typeLabel: "subarachnoid hemorrhage",
  },
  ich: {
    underlyingCode: "I61.9",
    underlyingDescription: "Nontraumatic intracerebral hemorrhage, unspecified",
    i69Family: "I69.1",
    typeLabel: "intracerebral hemorrhage",
  },
  other_ich: {
    underlyingCode: "I62.9",
    underlyingDescription: "Nontraumatic intracranial hemorrhage, unspecified",
    i69Family: "I69.2",
    typeLabel: "intracranial hemorrhage",
  },
  infarction: {
    underlyingCode: "I63.9",
    underlyingDescription: "Cerebral infarction, unspecified",
    i69Family: "I69.3",
    typeLabel: "cerebral infarction (ischemic stroke)",
  },
  nos: {
    underlyingCode: "I64.9",
    underlyingDescription: "Stroke, not specified as hemorrhage or infarction",
    i69Family: "I69.9",
    typeLabel: "unspecified stroke",
  },
};

const STROKE_TYPE_CUES: { type: StrokeType; cues: string[] }[] = [
  {
    type: "sah",
    cues: ["subarachnoid", "sah", "ruptured aneurysm", "aneurysm rupture"],
  },
  {
    type: "ich",
    cues: [
      "intracerebral hemorrhage",
      "intracerebral bleed",
      "brain bleed",
      "bleed in the brain",
      "hemorrhagic stroke",
      "brain hemorrhage",
    ],
  },
  {
    type: "other_ich",
    cues: ["intracranial hemorrhage", "intracranial bleed"],
  },
  {
    type: "infarction",
    cues: ["ischemic", "infarct", "embolic stroke", "thrombotic stroke", "cva"],
  },
];

/** History cue: a PREVIOUS cerebrovascular event (negation-guarded by caller). */
const STROKE_HISTORY_CUES = [
  "history of stroke",
  "history of cva",
  "prior stroke",
  "previous stroke",
  "old stroke",
  "old cva",
  "past stroke",
  "stroke years ago",
  "stroke last year",
  "post-stroke",
  "after his stroke",
  "after her stroke",
  "after a stroke",
  "since his stroke",
  "since her stroke",
  "sequela of stroke",
  "sequelae of stroke",
  "stroke with residual",
  "cva with residual",
  "stroke history",
];

/**
 * Past-context patterns covering phrasings the literal cues miss —
 * e.g. "since his brain bleed six months ago", "following an intracranial
 * hemorrhage in 2024". Both matchers verify the event word is preceded by
 * a past marker; a small look-back window guards negation ("no history of
 * stroke") and family history ("family history of stroke").
 */
const HISTORY_CUE_RE =
  /\b(?:history of|prior|previous|old|past|since|after|following|remote)\b[^.;\n]{0,40}\b(?:stroke|cva|sah|subarachnoid|brain bleed|intracerebral|intracranial hemorrhage|infarct|hemorrhagic stroke)\b/i;
const AGO_CUE_RE = /\b(?:stroke|cva|bleed|hemorrhage|infarct)\b[^.;\n]{0,24}\bago\b/i;
const NEGATION_RE = /\b(?:no|not|without|denies|negative for|free of)\b/i;

function pastCueNotNegated(raw: string, re: RegExp): boolean {
  const m = raw.search(re);
  if (m === -1) return false;
  const window = raw.slice(Math.max(0, m - 40), m);
  if (NEGATION_RE.test(window)) return false;
  if (/\bfamily history\b/i.test(window)) return false;
  return true;
}

interface DeficitRule {
  id: string;
  cues: string[];
  /** Suffix within the I69 family (e.g. "20" -> I69.320 for the I69.3 family). */
  suffix: string;
  /** Paralysis ladders take side+dominance as the last digit instead. */
  paralysis?: boolean;
  description: (typeLabel: string) => string;
  confidence: number;
  specificity: number;
}

const DEFICIT_RULES: DeficitRule[] = [
  {
    id: "hemiplegia",
    cues: ["hemiplegia", "hemiparesis", "one side of the body is weak", "half of the body is weak"],
    suffix: "5",
    paralysis: true,
    description: (t) => `Hemiplegia and hemiparesis following ${t}`,
    confidence: 0.88,
    specificity: 9,
  },
  {
    id: "monoplegia-arm",
    cues: ["monoplegia of upper limb", "monoplegia upper limb", "monoplegia of the arm"],
    suffix: "3",
    paralysis: true,
    description: (t) => `Monoplegia of upper limb following ${t}`,
    confidence: 0.85,
    specificity: 9,
  },
  {
    id: "monoplegia-leg",
    cues: ["monoplegia of lower limb", "monoplegia lower limb", "monoplegia of the leg"],
    suffix: "4",
    paralysis: true,
    description: (t) => `Monoplegia of lower limb following ${t}`,
    confidence: 0.85,
    specificity: 9,
  },
  {
    id: "aphasia",
    cues: ["aphasia", "cannot speak", "unable to speak", "loss of speech"],
    suffix: "20",
    description: (t) => `Aphasia following ${t}`,
    confidence: 0.86,
    specificity: 8,
  },
  {
    id: "dysphasia",
    cues: ["dysphasia", "difficulty finding words", "word-finding difficulty"],
    suffix: "21",
    description: (t) => `Dysphasia following ${t}`,
    confidence: 0.84,
    specificity: 8,
  },
  {
    id: "dysarthria",
    cues: ["dysarthria", "slurred speech"],
    suffix: "22",
    description: (t) => `Dysarthria following ${t}`,
    confidence: 0.85,
    specificity: 8,
  },
  {
    id: "memory",
    cues: ["memory deficit", "memory problems", "memory loss", "forgetful"],
    suffix: "11",
    description: (t) => `Memory deficit following ${t}`,
    confidence: 0.8,
    specificity: 6,
  },
  {
    id: "attention",
    cues: ["attention deficit", "concentration deficit", "cannot concentrate"],
    suffix: "10",
    description: (t) => `Attention and concentration deficit following ${t}`,
    confidence: 0.78,
    specificity: 6,
  },
  {
    id: "neglect",
    cues: ["visual neglect", "spatial neglect", "neglect of the left", "neglect of the right"],
    suffix: "12",
    description: (t) => `Visual and spatial neglect following ${t}`,
    confidence: 0.8,
    specificity: 7,
  },
  {
    id: "apraxia",
    cues: ["apraxia"],
    suffix: "90",
    description: (t) => `Apraxia following ${t}`,
    confidence: 0.8,
    specificity: 7,
  },
  {
    id: "dysphagia",
    cues: ["dysphagia", "difficulty swallowing", "trouble swallowing", "swallowing difficulty"],
    suffix: "91",
    description: (t) => `Dysphagia following ${t}`,
    confidence: 0.84,
    specificity: 8,
  },
  {
    id: "facial-weakness",
    cues: ["facial droop", "drooping of the face", "facial weakness", "droopy face"],
    suffix: "92",
    description: (t) => `Facial weakness following ${t}`,
    confidence: 0.84,
    specificity: 8,
  },
  {
    id: "ataxia",
    cues: ["ataxia", "balance problems", "poor coordination", "unsteady gait"],
    suffix: "93",
    description: (t) => `Ataxia following ${t}`,
    confidence: 0.8,
    specificity: 7,
  },
];

export interface SideDominance {
  side: "right" | "left" | "unspecified";
  dominance: "right" | "left" | "unknown";
}

/**
 * Digit for the x5 paralysis ladder:
 * 1 right dominant / 2 left dominant / 3 right non-dominant /
 * 4 left non-dominant / 9 unspecified side.
 * Dominance defaults to right-handed when not documented.
 */
export function paralysisDigit(sd: SideDominance): string {
  if (sd.side === "unspecified") return "9";
  const dom = sd.dominance === "unknown" ? "right" : sd.dominance;
  if (sd.side === "right") return dom === "right" ? "1" : "3";
  return dom === "left" ? "2" : "4";
}

function detectSideDominance(t: string, deficitCues: string[]): SideDominance {
  // Scope the search to a window around the deficit cue to avoid picking up
  // an unrelated side elsewhere in the note.
  let window = t;
  for (const cue of deficitCues) {
    const i = t.indexOf(cue);
    if (i !== -1) {
      window = t.slice(Math.max(0, i - 40), i + cue.length + 40);
      break;
    }
  }
  const side = /\bright\b/i.test(window)
    ? "right"
    : /\bleft\b/i.test(window)
      ? "left"
      : "unspecified";
  const dominance = /\bleft[- ]?handed\b|\bleft[- ]hand dominant\b|\bleft dominant\b/i.test(t)
    ? "left"
    : /\bright[- ]?handed\b|\bright[- ]hand dominant\b|\bright dominant\b|\bambidextrous\b/i.test(t)
      ? "right"
      : "unknown";
  return { side, dominance };
}

/**
 * Detect a stroke late-effect presentation: a PREVIOUS cerebrovascular
 * event (negation-guarded via `present`) plus at least one documented
 * residual deficit. Returns null when this is not a stroke-sequela note
 * (e.g. pure history without deficits, or an acute stroke).
 */
export function detectStrokeSequela(
  note: string,
  present: PresentFn
): StrokeSequelaResult | null {
  const t = (note ?? "").toLowerCase();
  if (!t) return null;

  const historyCued =
    STROKE_HISTORY_CUES.some((cue) => present(cue)) ||
    pastCueNotNegated(note, HISTORY_CUE_RE) ||
    pastCueNotNegated(note, AGO_CUE_RE);
  // "post-stroke X" / "after a stroke" also count even without the word
  // "history"; a bare acute "stroke" mention does NOT.
  if (!historyCued) return null;

  const type: StrokeType = (() => {
    for (const { type: ty, cues } of STROKE_TYPE_CUES) {
      if (cues.some((cue) => present(cue))) return ty;
    }
    return "nos";
  })();
  const layout = FAMILY_BY_TYPE[type];

  const residuals: StrokeResidualHit[] = [];
  for (const rule of DEFICIT_RULES) {
    if (!rule.cues.some((cue) => present(cue))) continue;
    let code: string;
    if (rule.paralysis) {
      const sd = detectSideDominance(t, rule.cues);
      code = `${layout.i69Family}${rule.suffix}${paralysisDigit(sd)}`;
    } else {
      code = `${layout.i69Family}${rule.suffix}`;
    }
    residuals.push({
      id: rule.id,
      code,
      description: `${rule.description(layout.typeLabel)} (late effect of prior ${layout.typeLabel})`,
      confidence: rule.confidence,
    });
  }

  if (residuals.length === 0) return null; // pure history -> Z86.73 path, no I69

  // Most specific first (paralysis before sensory/speech deficits).
  residuals.sort((a, b) => (a.code.length !== b.code.length ? b.code.length - a.code.length : 0));
  return {
    underlyingCode: layout.underlyingCode,
    underlyingDescription: layout.underlyingDescription,
    i69Family: layout.i69Family,
    typeLabel: layout.typeLabel,
    residuals,
  };
}
