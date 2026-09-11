/**
 * Unconfirmed-diagnosis language handling (Sprint 1, Idea D).
 *
 * ICD-10-CM Official Guidelines for Coding and Reporting, Section IV.B
 * (Outpatient Services): "Probable", "suspected", "questionable",
 * "rule out", "working diagnosis" and comparable terms indicating
 * uncertainty are NOT to be coded as if established. The coder should
 * report the confirmed sign(s) / symptom(s) instead. (Inpatient rules
 * differ — Section II.H allows coding such conditions as if established.)
 *
 * This module is shared by:
 *  - the offline coder (mock.ts) which STRIPS unconfirmed spans before
 *    rule matching, so symptoms still code but the unconfirmed
 *    diagnosis does not
 *  - the Validation Engine (validation.ts) which emits an `info`
 *    message quoting the exact unconfirmed phrase it found
 */

export interface UnconfirmedSpan {
  /** Marker that introduced the uncertainty, e.g. "probable". */
  marker: string;
  /** The condition text that followed the marker. */
  condition: string;
  /** Full "marker + condition" phrase as it appears in the note. */
  phrase: string;
}

/**
 * Matches uncertainty markers followed by a short condition phrase.
 * The phrase ends at sentence/clause punctuation or at contrastive
 * connectives ("and", "but", "however") so symptoms listed in the same
 * sentence survive stripping.
 */
const UNCONFIRMED_RE =
  /\b(probable|presumed|suspected|questionable|possible|working\s+diagnosis|rule\s*-?\s*out|r\/o)\b\s*[:]?\s*([a-z][a-z0-9'\-\s]{1,60}?)(?=[,.;:()\n]|\band\b|\bbut\b|\bhowever\b|$)/gi;

/** Extract every unconfirmed-diagnosis phrase from the note. */
export function extractUnconfirmedDiagnoses(text: string): UnconfirmedSpan[] {
  const out: UnconfirmedSpan[] = [];
  const re = new RegExp(UNCONFIRMED_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const marker = m[1].replace(/\s+/g, " ").trim();
    const condition = (m[2] ?? "").trim().replace(/\s+/g, " ");
    if (condition.length < 3) continue;
    out.push({ marker, condition, phrase: `${marker} ${condition}` });
  }
  return out;
}

/**
 * Return a copy of the note with unconfirmed-diagnosis phrases removed.
 * Symptoms and confirmed diagnoses elsewhere in the text are untouched.
 */
export function stripUnconfirmedDiagnoses(text: string): string {
  const re = new RegExp(UNCONFIRMED_RE.source, "gi");
  return text.replace(re, (_full, _marker, _cond) => " ").replace(/\s{2,}/g, " ");
}
