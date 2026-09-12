/**
 * Severe-sepsis ladder (Sprint 5, Idea L).
 *
 * Extends the Sprint-2 sepsis engine (underlying infection coded FIRST,
 * A41.- follows) with the organ-dysfunction / septic-shock layer:
 *
 *   R65.20  Severe sepsis WITHOUT septic shock  (I.C.1.d.7)
 *   R65.21  Severe sepsis WITH septic shock     (I.C.1.d.8)
 *
 * Official-guideline rules implemented here:
 *  - Severe sepsis REQUIRES an underlying acute organ dysfunction to be
 *    documented (or the equivalent lactate criterion). SIRS without acute
 *    organ dysfunction does NOT meet the severe-sepsis definition — the
 *    engine must keep coding plain sepsis (A41.-) only.
 *  - R65.2- is NEVER the principal diagnosis: it follows the underlying
 *    infection / sepsis code (enforced by the caller and validated in
 *    validation.ts section 16).
 *  - Septic shock in FY2026 codes to R65.21 — R57.2 was retired and is
 *    ABSENT from the bundled FY2026 extract (verified; 0 rows).
 *
 * Shock proxies (any of): "septic shock", vasopressor dependence
 * (norepinephrine/levophed/vasopressors/pressors), hypotension refractory
 * to fluids. A documented lactate >= 2 mmol/L counts as an organ-dysfunction
 * criterion (tissue hypoperfusion) and, at >= 4 with the sepsis context, as
 * a shock proxy — conservative thresholds, documented in the harness.
 *
 * Acute organ-dysfunction cues -> companion codes (all verified DB rows):
 *   acute kidney injury / acute renal failure -> N17.9
 *   ARDS / acute respiratory distress syndrome -> J80
 *   acute respiratory failure -> J96.00
 *   DIC / disseminated intravascular coagulation -> D65
 *   thrombocytopenia / low platelets -> D69.59 (other secondary)
 *   metabolic encephalopathy -> G93.41 (wins over plain AMS)
 *   altered mental status / delirium / confusion -> R41.82
 */

export interface OrganDysfunctionHit {
  id: string;
  code: string;
  description: string;
}

export interface SevereSepsisHit {
  /** "R65.20" (without shock) or "R65.21" (with septic shock). */
  r65: "R65.20" | "R65.21";
  r65Desc: string;
  /** True when shock criteria are documented (drives R65.21). */
  shock: boolean;
  /** Acute organ dysfunction codes to report alongside R65.2-. */
  organs: OrganDysfunctionHit[];
  /** Matched cues, for rationale + validation messages. */
  cues: string[];
  /** Documented lactate value, when parseable. */
  lactate: number | null;
}

const SEPSIS_CONTEXT_RE =
  /\bsepsis\b|\bseptic\b|\bsepticemia\b|\bbacteremia\b|\burosepsis\b|\bsirs\b|\binfection\b/i;

const SHOCK_RE =
  /\bseptic shock\b|\bsepsis[- ]induced shock\b|\bsepsis[- ]associated shock\b|\bshock\b/i;
const VASOPRESSOR_RE =
  /\bvasopressors?\b|\bnorepinephrine\b|\blevophed\b|\bpressors\b|\bdopamine (?:drip|infusion)\b|\bepinephrine (?:drip|infusion)\b/i;
const FLUID_REFRACTORY_RE =
  /\bhypotension\b[^.]{0,80}\b(?:refractory|unresponsive|not responding) to (?:fluid|iv fluid|crystalloid)/i;

const ORGAN_RULES: { id: string; re: RegExp; code: string; description: string }[] = [
  {
    id: "metabolic_encephalopathy",
    re: /\bmetabolic (?:toxic )?encephalopathy\b|\bsepsis[- ]associated encephalopathy\b/i,
    code: "G93.41",
    description: "Metabolic encephalopathy",
  },
  {
    id: "acute_kidney_injury",
    re: /\bacute (?:kidney injury|renal failure)\b|\baki\b(?![a-z])/i,
    code: "N17.9",
    description: "Acute kidney failure, unspecified",
  },
  {
    id: "ards",
    re: /\bards\b|acute respiratory distress syndrome/i,
    code: "J80",
    description: "Acute respiratory distress syndrome",
  },
  {
    id: "acute_respiratory_failure",
    re: /\bacute (?:respiratory failure|hypox(?:emic)? respiratory failure)\b/i,
    code: "J96.00",
    description: "Acute respiratory failure, unspecified with hypoxia or hypercapnia",
  },
  {
    id: "dic",
    re: /\bdic\b|disseminated intravascular coagulation/i,
    code: "D65",
    description: "Disseminated intravascular coagulation",
  },
  {
    id: "thrombocytopenia",
    re: /\bthrombocytopenia\b|\blow platelets\b|\bplatelet count (?:of |is )?(?:low|decreased|dropped)/i,
    code: "D69.59",
    description: "Other secondary thrombocytopenia",
  },
  {
    id: "altered_mental_status",
    re: /\baltered mental status\b|\bdelirium\b|\bconfusion\b|\bencephalopathy\b/i,
    code: "R41.82",
    description: "Altered mental status, unspecified",
  },
];

/** Parse "lactate 4.2", "lactate of 5", "lactate is 3.1", "lactate level 6". */
function parseLactate(note: string): number | null {
  const m = note.match(/\blactate(?:\s+(?:is|of|level|level is))?\s*(?:is\s*)?(≥|>=|>)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  return m ? parseFloat(m[2]) : null;
}

/**
 * Detect the severe-sepsis layer for a note ALREADY in a sepsis context
 * (sepsis/urosepsis/septicemia/bacteremia/septic shock documented and not
 * negated — checked here so callers can pass any note).
 */
export function detectSevereSepsis(note: string): SevereSepsisHit | null {
  if (!SEPSIS_CONTEXT_RE.test(note)) return null;
  const cues: string[] = [];
  const organs: OrganDysfunctionHit[] = [];

  for (const rule of ORGAN_RULES) {
    if (rule.re.test(note)) {
      // metabolic encephalopathy wins over plain altered-mental-status
      if (rule.id === "altered_mental_status" && /\b(?:metabolic|sepsis[- ]associated) (?:toxic )?encephalopathy\b/i.test(note)) {
        continue;
      }
      organs.push({ id: rule.id, code: rule.code, description: rule.description });
      cues.push(rule.id);
    }
  }

  const lactate = parseLactate(note);
  if (lactate !== null && lactate >= 2) {
    cues.push(`lactate ${lactate}`);
  }

  const pressors = VASOPRESSOR_RE.test(note);
  const fluidRefractory = FLUID_REFRACTORY_RE.test(note);
  const shock = SHOCK_RE.test(note) || pressors || fluidRefractory;
  if (shock) cues.push(pressors ? "vasopressor dependence" : fluidRefractory ? "fluid-refractory hypotension" : "shock documented");

  const hasDysfunction = organs.length > 0 || (lactate !== null && lactate >= 2);
  if (!hasDysfunction && !shock) return null; // plain sepsis / SIRS only — no R65.2-

  return {
    r65: shock ? "R65.21" : "R65.20",
    r65Desc: shock ? "Severe sepsis with septic shock" : "Severe sepsis without septic shock",
    shock,
    organs,
    cues,
    lactate,
  };
}

/** Acute organ-dysfunction code families that companion R65.2- codes. */
export function isOrganDysfunctionCode(code: string): boolean {
  return /^(N17\.|J96\.0|J80|D65|D69\.59|R41\.82|G93\.41)/.test(code.toUpperCase());
}
