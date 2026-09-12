/**
 * Poisoning intent disambiguation (Sprint 4, Idea P).
 *
 * ICD-10-CM Official Guidelines I.C.19.e: poisoning codes in T36-T50
 * carry the INTENT of the event as the 4th/5th character:
 *
 *   .X1 / .1  accidental (unintentional)
 *   .X2 / .2  intentional self-harm
 *   .X3 / .3  assault
 *   .X4 / .4  undetermined
 *   (X5 adverse effect, X6 underdosing — not handled here)
 *
 * I.C.19.e also requires the intent to be DOCUMENTED: when the intent of
 * taking the drug is unknown or cannot be determined, the code for
 * UNDETERMINED is used. This engine therefore never guesses "accidental"
 * for a bare "overdose" — it emits X4/undetermined and the validation
 * layer nudges the coder to document intent (info-level rule).
 *
 * The matching external-cause code (chapter XX) must carry the SAME
 * intent: X44 (accidental), X64 (self-harm), X85 (assault), Y10/Y11/Y13
 * (undetermined intent — Y-family picked by drug class).
 *
 * FY2026 dataset note (verified against the bundled public/icd10cm/ DB):
 * intent encodings differ per agent family —
 *   T39.1X1-4A  acetaminophen      (X placeholder + intent digit)
 *   T39.011-014A aspirin           (intent as 3rd digit)
 *   T39.311-314A ibuprofen family  (intent as 3rd digit)
 *   T39.91-94XA unspecified NSAID  (intent as 2nd digit, X placeholder)
 *   T40.1X / T40.2X / T40.3X / T40.5X1-4A heroin/opioids/methadone/cocaine
 *   T50.901-904A unspecified drugs (intent as 3rd digit)
 * The X40-X49/X60-X69/Y10-Y19 external-cause codes are NOT present in the
 * bundled FY2026 order-file extract (pipeline data gap, tracked separately);
 * external causes are therefore emitted as fixed template strings,
 * consistent with the pre-existing X44.XXXA rule behavior.
 */

export type PoisoningIntent = "accidental" | "self_harm" | "assault" | "undetermined";

export interface PoisoningIntentResult {
  intent: PoisoningIntent;
  /** Human label, e.g. "accidental (unintentional)". */
  intentLabel: string;
  intentDigit: "1" | "2" | "3" | "4";
  /** The intent cue matched, or "" when defaulted to undetermined. */
  cue: string;
  /** The agent alias matched ("" = unspecified drug). */
  agent: string;
  /** Poisoning T-code with documented intent, initial encounter. */
  tcode: string;
  tdesc: string;
  /** External-cause code carrying the SAME intent. */
  extCode: string;
  extDesc: string;
}

export type PresentFn = (keyword: string) => boolean;

/** Strong encounter cues: a poisoning EVENT is being documented. */
const ENCOUNTER_CUES = ["overdose", "poisoning", "poisoned", "overdose of", "drug ingestion"];
/**
 * Weak cues only count when a drug agent is also documented
 * ("accidentally ingested too many Tylenol" — no word "overdose").
 */
const WEAK_ENCOUNTER_CUES = ["ingested", "swallowed", "took too many", "took too much", "extra doses", "double dose", "forced to take"];

/** Spans that mention a PAST overdose event must not trigger this engine. */
const PAST_OVERDUE_RE = /\b(history of|past|previous|prior|remote|old)\b[^.;\n]{0,24}\boverdose\b/i;

const INTENT_CUES: { intent: PoisoningIntent; digit: "1" | "2" | "3" | "4"; label: string; cues: string[] }[] = [
  {
    intent: "self_harm",
    digit: "2",
    label: "intentional self-harm",
    cues: [
      "suicide attempt", "attempted suicide", "suicidal", "intentional self-harm", "self-harm",
      "self-inflicted", "to harm himself", "to harm herself", "to end his life", "to end her life",
      "to kill himself", "to kill herself", "intentionally took", "deliberately took",
    ],
  },
  {
    intent: "assault",
    digit: "3",
    label: "assault",
    cues: ["assault", "forced him to take", "forced her to take", "poisoned by another", "given without consent", "slipped into"],
  },
  {
    intent: "accidental",
    digit: "1",
    label: "accidental (unintentional)",
    cues: [
      "accidental", "accidentally", "unintentional", "unintentionally", "mistakenly", "by mistake",
      "got into the", "got into her", "got into his", "child ingestion", "ingested by a child", "in error",
    ],
  },
  {
    intent: "undetermined",
    digit: "4",
    label: "undetermined",
    cues: ["undetermined", "intent unclear", "unknown intent", "unclear whether intentional", "unclear if intentional"],
  },
];

interface AgentRule {
  id: string;
  aliases: string[];
  /** Build the initial-encounter poisoning code for an intent digit. */
  build: (digit: string) => string;
  agentDesc: string;
  /** Y-family for undetermined-intent external cause. */
  yCode: string;
  yDesc: string;
}

const AGENT_RULES: AgentRule[] = [
  {
    id: "acetaminophen",
    aliases: ["acetaminophen", "tylenol", "paracetamol"],
    build: (d) => `T39.1X${d}A`,
    agentDesc: "Poisoning by 4-aminophenol derivatives (acetaminophen)",
    yCode: "Y10.XXXA",
    yDesc: "Poisoning by and exposure to nonopioid analgesics, antipyretics and antirheumatics, undetermined intent",
  },
  {
    id: "aspirin",
    aliases: ["aspirin", "salicylate", "asasa"],
    build: (d) => `T39.01${d}A`,
    agentDesc: "Poisoning by aspirin (salicylates)",
    yCode: "Y10.XXXA",
    yDesc: "Poisoning by and exposure to nonopioid analgesics, antipyretics and antirheumatics, undetermined intent",
  },
  {
    id: "propionic-acid",
    aliases: ["ibuprofen", "advil", "motrin", "naproxen", "aleve", "naprosyn", "ketoprofen"],
    build: (d) => `T39.31${d}A`,
    agentDesc: "Poisoning by propionic acid derivatives (ibuprofen/naproxen)",
    yCode: "Y10.XXXA",
    yDesc: "Poisoning by and exposure to nonopioid analgesics, antipyretics and antirheumatics, undetermined intent",
  },
  {
    id: "nsaid-unspecified",
    aliases: ["nsaid", "diclofenac", "voltaren", "celecoxib", "celebrex", "meloxicam", "mobic", "indomethacin", "piroxicam", "etodolac"],
    build: (d) => `T39.9${d}XA`,
    agentDesc: "Poisoning by unspecified nonopioid analgesics, antipyretics and antirheumatics (NSAID)",
    yCode: "Y10.XXXA",
    yDesc: "Poisoning by and exposure to nonopioid analgesics, antipyretics and antirheumatics, undetermined intent",
  },
  {
    id: "heroin",
    aliases: ["heroin"],
    build: (d) => `T40.1X${d}A`,
    agentDesc: "Poisoning by heroin",
    yCode: "Y11.XXXA",
    yDesc: "Poisoning by and exposure to narcotics and psychodysleptics, undetermined intent",
  },
  {
    id: "methadone",
    aliases: ["methadone", "dolophine"],
    build: (d) => `T40.3X${d}A`,
    agentDesc: "Poisoning by methadone",
    yCode: "Y11.XXXA",
    yDesc: "Poisoning by and exposure to narcotics and psychodysleptics, undetermined intent",
  },
  {
    id: "opioids",
    aliases: [
      "opioid", "opiate", "opioids", "morphine", "oxycodone", "oxycontin", "hydrocodone",
      "hydromorphone", "fentanyl", "tramadol", "percocet", "vicodin", "dilaudid", "codeine",
    ],
    build: (d) => `T40.2X${d}A`,
    agentDesc: "Poisoning by other opioids",
    yCode: "Y11.XXXA",
    yDesc: "Poisoning by and exposure to narcotics and psychodysleptics, undetermined intent",
  },
  {
    id: "cocaine",
    aliases: ["cocaine", "crack cocaine"],
    build: (d) => `T40.5X${d}A`,
    agentDesc: "Poisoning by cocaine",
    yCode: "Y11.XXXA",
    yDesc: "Poisoning by and exposure to narcotics and psychodysleptics, undetermined intent",
  },
  {
    id: "unspecified-drugs",
    aliases: ["unknown pills", "unknown medication", "unknown medications", "unknown drugs", "unknown substance", "unknown tablets", "pills", "tablets", "medications", "prescription drugs"],
    build: (d) => `T50.90${d}A`,
    agentDesc: "Poisoning by unspecified drugs, medicaments and biological substances",
    yCode: "Y13.XXXA",
    yDesc: "Poisoning by and exposure to other and unspecified drugs, medicaments and biological substances, undetermined intent",
  },
];

const EXT_BY_INTENT: Record<"1" | "2" | "3", { code: string; desc: string }> = {
  "1": {
    code: "X44.XXXA",
    desc: "Accidental poisoning by and exposure to other and unspecified drugs, initial encounter",
  },
  "2": {
    code: "X64.XXXA",
    desc: "Intentional self-harm by other and unspecified drugs, initial encounter",
  },
  "3": {
    code: "X85.XXXA",
    desc: "Assault by other and unspecified drugs, initial encounter",
  },
};

function aliasPresent(t: string, alias: string): boolean {
  const re = new RegExp(`\\b${alias.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
  return re.test(t);
}

/**
 * Detect a documented poisoning encounter and its intent. Returns null
 * when the note is not an active poisoning presentation (pure history,
 * negated mentions, or no poisoning language at all).
 */
export function detectPoisoningIntent(
  note: string,
  present: PresentFn
): PoisoningIntentResult | null {
  const raw = note ?? "";
  if (!raw) return null;
  // Remove past-event spans so "history of overdose" never fires.
  const t = raw.replace(PAST_OVERDUE_RE, " ").toLowerCase();
  if (!t) return null;

  const strong = ENCOUNTER_CUES.some((cue) => present(cue));

  // Agent detection (most specific list wins).
  let agentRule: AgentRule | null = null;
  let agentAlias = "";
  for (const rule of AGENT_RULES) {
    for (const alias of rule.aliases) {
      if (aliasPresent(t, alias)) {
        agentRule = rule;
        agentAlias = alias;
        break;
      }
    }
    if (agentRule) break;
  }

  const weak = agentRule !== null && WEAK_ENCOUNTER_CUES.some((cue) => t.includes(cue));
  if (!strong && !weak) return null;

  // Intent: explicit cue wins; otherwise UNDETERMINED per I.C.19.e
  // (intent must be documented — it is never assumed accidental).
  let intent = INTENT_CUES[3]; // undetermined
  let cue = "";
  for (const rule of INTENT_CUES) {
    const matched = rule.cues.find((c) => t.includes(c));
    if (matched) {
      intent = rule;
      cue = matched;
      break;
    }
  }

  const rule = agentRule ?? AGENT_RULES[AGENT_RULES.length - 1];
  const tcode = rule.build(intent.digit);
  const tdesc = `${rule.agentDesc}, ${intent.label}, initial encounter`;
  const ext =
    intent.digit === "4"
      ? { code: rule.yCode, desc: rule.yDesc }
      : EXT_BY_INTENT[intent.digit];

  return {
    intent: intent.intent,
    intentLabel: intent.label,
    intentDigit: intent.digit,
    cue,
    agent: agentAlias,
    tcode,
    tdesc,
    extCode: ext.code,
    extDesc: ext.desc,
  };
}
