/**
 * Personal-history / family-history condition rules (Sprint 1, Idea E).
 *
 * Why this exists: notes say "history of stroke", "s/p DVT", "family
 * history of breast cancer". Naive keyword matching then wrongly fires
 * the ACTIVE disease rule (I63.9 cerebral infarction, C50.- breast
 * cancer, E11.- diabetes) even though the episode is historical.
 *
 * Correct ICD-10-CM practice:
 *  - resolved EPISODIC conditions get personal-history Z codes
 *    (stroke -> Z86.73, VTE -> Z86.718, pneumonia -> Z87.09,
 *    peptic ulcer -> Z87.11, cancer -> Z85.-)
 *  - "old MI" is coded I25.2 (Old myocardial infarction), not Z86.7
 *  - chronic ONGOING conditions documented in the PMH ("history of
 *    diabetes / asthma / COPD") remain ACTIVE codes — they are only
 *    converted to Z codes when explicitly resolved; this engine simply
 *    leaves them untouched (no personal-history rule = no strip)
 *  - "family history of X" gets Z80/Z82/Z83 codes and must never
 *    activate the patient's own disease code
 *
 * Chained lists are supported per-condition:
 *   "family history of breast cancer and diabetes" -> Z80.3 + Z83.3,
 * and only the conditions that RESOLVE to a history rule are stripped
 * from the matching text; unmatched conditions stay untouched.
 *
 * Safety guards before a span is stripped / a Z code emitted:
 *  1. negation guard   — "no history of stroke" is ignored
 *  2. active-care guard — "history of breast cancer now on chemotherapy"
 *     keeps ACTIVE coding (skip strip, skip Z code)
 *
 * Only codes verified against the ICD-10-CM tabular/index are used here.
 */

export interface HistoryFinding {
  code: string;
  description: string;
  label_en: string;
  label_ar: string;
  /** The matched condition text, e.g. "stroke". */
  condition: string;
  /** True when derived from "family history of ...". */
  family: boolean;
}

interface HistoryRule {
  id: string;
  label_en: string;
  label_ar: string;
  /** Condition aliases; single words match on word boundaries. */
  aliases: string[];
  /** Personal-history code; omit when a personal history should stay an ACTIVE code (e.g. diabetes). */
  code?: string;
  description?: string;
  /** Family-history code (Z80/Z82/Z83); omit when not applicable. */
  familyCode?: string;
  familyDescription?: string;
}

export const HISTORY_CONDITION_RULES: HistoryRule[] = [
  {
    id: "stroke",
    label_en: "History of stroke / TIA",
    label_ar: "سابقة جلطة دماغية",
    aliases: ["stroke", "cva", "cerebral infarction", "tia", "transient ischemic"],
    code: "Z86.73",
    description:
      "Personal history of transient ischemic attack (TIA), and cerebral infarction without residual deficits",
    familyCode: "Z82.49",
    familyDescription:
      "Family history of ischemic heart disease and other diseases of the circulatory system",
  },
  {
    id: "vte",
    label_en: "History of venous thrombosis / embolism",
    label_ar: "سابقة خثار وريدي",
    aliases: ["dvt", "pe", "venous thrombosis", "deep vein thrombosis", "pulmonary embolism"],
    code: "Z86.718",
    description: "Personal history of other venous thrombosis and embolism",
  },
  {
    id: "mi",
    label_en: "Old myocardial infarction",
    label_ar: "احتشاء قلبي سابق",
    aliases: ["mi", "myocardial infarction", "heart attack"],
    code: "I25.2",
    description: "Old myocardial infarction",
  },
  {
    id: "cancer",
    label_en: "Personal history of malignancy",
    label_ar: "سابقة ورم خبيث",
    aliases: ["cancer", "carcinoma", "malignancy", "lymphoma", "leukemia", "melanoma", "sarcoma", "tumor", "tumour"],
    code: "Z85.9",
    description: "Personal history of unspecified malignant neoplasm",
    familyCode: "Z80.9",
    familyDescription: "Family history of malignant neoplasm, unspecified",
  },
  {
    id: "pneumonia",
    label_en: "History of pneumonia",
    label_ar: "سابقة ذات رئة",
    aliases: ["pneumonia"],
    code: "Z87.09",
    description: "Personal history of other diseases of respiratory system",
  },
  {
    id: "peptic-ulcer",
    label_en: "History of peptic ulcer",
    label_ar: "سابقة قرحة هضمية",
    aliases: ["peptic ulcer", "stomach ulcer", "duodenal ulcer"],
    code: "Z87.11",
    description: "Personal history of peptic ulcer disease",
  },
  // ---- Family-history-only rules: personal "history of X" stays ACTIVE ----
  {
    id: "diabetes-family",
    label_en: "Family history of diabetes mellitus",
    label_ar: "تاريخ عائلي للسكري",
    aliases: ["diabetes", "diabetic", "sugar"],
    familyCode: "Z83.3",
    familyDescription: "Family history of diabetes mellitus",
  },
  {
    id: "asthma-family",
    label_en: "Family history of asthma",
    label_ar: "تاريخ عائلي للربو",
    aliases: ["asthma", "reactive airway"],
    familyCode: "Z83.4",
    familyDescription: "Family history of asthma and other chronic lower respiratory diseases",
  },
  {
    id: "heart-family",
    label_en: "Family history of ischemic heart disease",
    label_ar: "تاريخ عائلي لمرض القلب",
    aliases: ["heart disease", "coronary artery disease", "cad"],
    familyCode: "Z82.49",
    familyDescription:
      "Family history of ischemic heart disease and other diseases of the circulatory system",
  },
];

/** Site refinements for cancer history (checked before the generic rule). */
const CANCER_SITE_REFINEMENTS: {
  site: string;
  personal: string;
  personalDesc: string;
  family: string;
  familyDesc: string;
}[] = [
  {
    site: "breast",
    personal: "Z85.3",
    personalDesc: "Personal history of malignant neoplasm of breast",
    family: "Z80.3",
    familyDesc: "Family history of malignant neoplasm of breast",
  },
  {
    site: "prostate",
    personal: "Z85.46",
    personalDesc: "Personal history of malignant neoplasm of prostate",
    family: "Z80.9",
    familyDesc: "Family history of malignant neoplasm, unspecified",
  },
  {
    site: "lung",
    personal: "Z85.2",
    personalDesc:
      "Personal history of malignant neoplasm of other respiratory and intrathoracic organs",
    family: "Z80.9",
    familyDesc: "Family history of malignant neoplasm, unspecified",
  },
];

/**
 * History markers. Kept deliberately conservative:
 *  - explicit "history / hx / fhx / fh / h/o" (family prefix detected separately)
 *  - "status post / s/p / prior / previous / remote"
 *  - "old" ONLY before a small fixed condition list ("old CVA") to avoid
 *    swallowing "50-year-old man"
 * The condition phrase runs to sentence/clause punctuation; chained
 * conditions joined by "and" are split and resolved individually.
 */
const RE_HISTORY_MAIN =
  /\b(family\s+history|history|hx|fhx|fh|h\/o)\s*[:]?\s*(?:of\s+)?([a-z][a-z0-9'\-\s]{1,60}?)(?=[,.;:()\n]|$)/gi;
const RE_HISTORY_PRIOR =
  /\b(status\s+post|s\/p|prior|previous|remote)\s+([a-z][a-z0-9'\-\s]{1,60}?)(?=[,.;:()\n]|$)/gi;
const RE_HISTORY_OLD = /\bold\s+(cva|stroke|tia|mi|dvt|pe)\b/gi;

const NEGATION_WINDOW =
  /\b(no|not|denies|denied|without|negative for|ruled out|rule out|never had|free of)\b/i;

const ACTIVE_CARE_CUES =
  /\b(on\s+chemo(?:therapy)?|on\s+radiation|active\b|recurrence|recurrent|metastatic|metastases|newly\s+diagnosed|currently\s+(?:on|taking)|now\s+on)\b/i;

/** Word-boundary alias matching: single words use \b..\b, phrases use includes(). */
function aliasMatches(condition: string, alias: string): boolean {
  if (alias.includes(" ")) return condition.includes(alias);
  return new RegExp(`\\b${alias}\\b`, "i").test(condition);
}

function findRule(condition: string): HistoryRule | null {
  for (const rule of HISTORY_CONDITION_RULES) {
    if (rule.aliases.some((a) => aliasMatches(condition, a))) return rule;
  }
  return null;
}

/** Sentence/clause-window negation check before the marker. Commas bound
 * the window so "…no residual deficits, family history of diabetes" does not
 * leak the "no" from the previous clause into the next history marker. */
function spanIsNegated(text: string, start: number): boolean {
  const windowStart = Math.max(0, start - 50);
  let window = text.slice(windowStart, start);
  const lastBreak = Math.max(
    window.lastIndexOf("."),
    window.lastIndexOf("!"),
    window.lastIndexOf("?"),
    window.lastIndexOf(";"),
    window.lastIndexOf(","),
    window.lastIndexOf("\n"),
  );
  if (lastBreak !== -1) window = window.slice(lastBreak + 1);
  return NEGATION_WINDOW.test(window);
}

/** Active-care cues right after the span (same sentence). */
function spanHasActiveCare(text: string, end: number): boolean {
  const limit = Math.min(text.length, end + 80);
  let after = text.slice(end, limit);
  const nextBreak = after.search(/[.;\n]/);
  if (nextBreak !== -1) after = after.slice(0, nextBreak);
  return ACTIVE_CARE_CUES.test(after);
}

function resolveCode(rule: HistoryRule, condition: string, family: boolean): { code: string; description: string } | null {
  // Cancer site refinement runs FIRST so "family history of breast cancer"
  // resolves to Z80.3 rather than the generic Z80.9.
  if (rule.id === "cancer") {
    for (const site of CANCER_SITE_REFINEMENTS) {
      if (new RegExp(`\\b${site.site}\\b`, "i").test(condition)) {
        return family
          ? { code: site.family, description: site.familyDesc }
          : { code: site.personal, description: site.personalDesc };
      }
    }
  }
  if (family) {
    if (!rule.familyCode) return null;
    return { code: rule.familyCode, description: rule.familyDescription! };
  }
  if (!rule.code) return null; // personal history of a chronic condition stays ACTIVE
  return { code: rule.code, description: rule.description! };
}

interface RawSpan {
  start: number;
  end: number;
  /** Full matched text (marker + condition). */
  full: string;
  /** Raw condition capture, unmodified (used for offset math). */
  rawCondition: string;
  family: boolean;
}

function collectSpans(text: string): RawSpan[] {
  const spans: RawSpan[] = [];
  let m: RegExpExecArray | null;
  const re1 = new RegExp(RE_HISTORY_MAIN.source, "gi");
  while ((m = re1.exec(text)) !== null) {
    const cond = (m[2] ?? "").trim();
    if (cond.length >= 3) {
      spans.push({ start: m.index, end: m.index + m[0].length, full: m[0], rawCondition: m[2], family: /^\s*family/i.test(m[1] ?? "") });
    }
  }
  const re2 = new RegExp(RE_HISTORY_PRIOR.source, "gi");
  while ((m = re2.exec(text)) !== null) {
    const cond = (m[2] ?? "").trim();
    if (cond.length >= 3) {
      spans.push({ start: m.index, end: m.index + m[0].length, full: m[0], rawCondition: m[2], family: false });
    }
  }
  const re3 = new RegExp(RE_HISTORY_OLD.source, "gi");
  while ((m = re3.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, full: m[0], rawCondition: m[1], family: false });
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Scan the note, resolve history Z-codes, and return:
 *  - findings: codes to add (personal/family history)
 *  - stripped: the note with matched history phrases removed, so active
 *    disease rules (I63.-, C50.-, E11.- ...) do not fire from them
 */
export function extractHistoryFindings(note: string): { findings: HistoryFinding[]; stripped: string } {
  const findings: HistoryFinding[] = [];
  /** Absolute ranges to blank out, applied last (descending). */
  const cuts: { at: number; len: number }[] = [];

  for (const span of collectSpans(note)) {
    if (spanIsNegated(note, span.start)) continue;
    if (spanHasActiveCare(note, span.end)) continue;

    const condAbsStart = span.start + span.full.indexOf(span.rawCondition);
    const parts = span.rawCondition
      .split(/\s*\band\b\s*/i)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3);

    let cursor = 0; // offset within span.rawCondition
    let matchedAny = false;
    for (const part of parts) {
      const partIdx = span.rawCondition.toLowerCase().indexOf(part.toLowerCase(), cursor);
      cursor = partIdx + part.length;
      const hit = findRule(part);
      if (!hit) continue;
      const resolved = resolveCode(hit, part, span.family);
      if (!resolved) continue;
      findings.push({
        code: resolved.code,
        description: resolved.description,
        label_en: hit.label_en,
        label_ar: hit.label_ar,
        condition: part,
        family: span.family,
      });
      cuts.push({ at: condAbsStart + partIdx, len: part.length });
      matchedAny = true;
    }
    if (matchedAny) {
      // Strip the marker prefix ("family history of ...") together with the
      // first matched condition so no active rule re-triggers on the marker.
      cuts.push({ at: span.start, len: Math.max(0, condAbsStart - span.start) });
    }
  }

  let stripped = note;
  for (const c of cuts.sort((a, b) => b.at - a.at)) {
    stripped = stripped.slice(0, c.at) + " " + stripped.slice(c.at + c.len);
  }
  stripped = stripped.replace(/\s{2,}/g, " ");
  return { findings, stripped };
}
