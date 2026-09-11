/**
 * Validation Engine — runs after the LLM produces a coding response.
 *
 * Checks:
 * 1. 7th Character Completeness: S/T/W/X/Y chapter codes that require a
 *    7th character must have one (A/D/S). If "missing", raise an error.
 * 2. Code-First / Use-Additional-Code rules from CODE_FIRST_RULES.
 * 3. Confidence flag: codes with confidence < 0.6 emit a warning suggesting
 *    human review.
 * 4. Duplicate-code detection across the three levels.
 * 5. External-cause ordering: V/W/X/Y codes must come AFTER all diagnosis
 *    codes (supplemental, per ICD-10-CM Chapter 20 guidelines).
 * 6. Missing-secondary detection: if the note documents a common chronic
 *    condition (UHDDS "other diagnoses") but no Secondary code covers it,
 *    emit a warning. This is the #1 real-world miss in AI coding.
 */

import type {
  ClinicalCodingResponse,
  ICDCodeDetail,
  ValidationIssue,
} from "@/lib/schemas/icd";
import { BUILTIN_ICD10, CODE_FIRST_RULES } from "./data";
import { CHRONIC_CONDITION_MATCHERS } from "./chronic-conditions";

/**
 * ICD-10-CM code categories that ALWAYS require a 7th character.
 * Source: ICD-10-CM Tabular List — most S, T chapter subcategories, and
 * many W/X/Y external cause codes.
 *
 * Heuristic: if the code starts with one of these prefixes AND has fewer
 * than 7 characters, it likely needs a 7th character.
 *
 * This is intentionally conservative. Real systems use the full Tabular
 * List to determine 7th-char requirements per category.
 */
const SEVENTH_CHAR_PREFIXES: RegExp[] = [
  /^[S]\d/,   // Injury chapter — most subcategories require 7th char
  /^[T](?!(30|31|32))\d{2}/, // Injury/poisoning — except T30-T32 (burn extent) which take no 7th char
  /^[W]\d/,   // External causes — most W codes take 7th char
  /^[X]\d/,   // External causes — exposure
  /^[Y](?!(92|93|99))\d/, // External causes — except Y92/Y93/Y99 (place/activity/status: no 7th char)
];

/**
 * Codes in the built-in dataset that we know require a 7th character.
 * Used as an authoritative source.
 */
const BUILTIN_REQUIRES_7TH: Set<string> = new Set(
  BUILTIN_ICD10.filter((e) => e.requires_seventh_char).map((e) => e.code)
);

/**
 * The "stem" of a code with 7th char stripped. e.g. S80.01XA -> S80.01
 */
function stem(code: string): string {
  // 7th character is the last char if the code is 7+ chars and the last
  // char is A/D/S and the char before is the 6th (letter or digit).
  if (code.length >= 7) {
    const last = code[code.length - 1];
    if (last === "A" || last === "D" || last === "S") {
      return code.slice(0, -1).replace(/\.?$/, "");
    }
  }
  return code;
}

/**
 * Negation-aware detection of a keyword in a clinical note.
 * Returns true when the keyword is present and NOT negated within the
 * preceding text — the window stops at sentence boundaries (. ! ? ; and
 * newlines) so "No gangrene. Hypertension..." does NOT negate hypertension.
 */
export function keywordPresentNotNegated(text: string, keyword: string): boolean {
  const t = text.toLowerCase();
  const k = keyword.toLowerCase();
  const NEGATIONS = [
    "no ", "not ", "denies", "denied", "without ", "negative for",
    "ruled out", "rule out", "free of", "absent ", "unremarkable",
    "clear of", "never had", "history negative",
  ];

  // Short pure-alphanumeric keywords (acronyms like "tia", "sob", "uti")
  // must match on word boundaries — otherwise "tia" matches inside
  // "essential". Longer keywords keep substring semantics ("cat scratch",
  // "type 2 diabetes").
  const positions: number[] = [];
  if (k.length <= 5 && /^[a-z0-9]+$/i.test(k)) {
    const re = new RegExp(`\\b${k}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) positions.push(m.index);
  } else {
    let i = t.indexOf(k);
    while (i !== -1) {
      positions.push(i);
      i = t.indexOf(k, i + 1);
    }
  }

  for (const idx of positions) {
    const windowStart = Math.max(0, idx - 60);
    let window = t.slice(windowStart, idx);
    // Only the current sentence counts — negation does not cross
    // sentence-ending punctuation.
    const lastSentenceBreak = Math.max(
      window.lastIndexOf("."),
      window.lastIndexOf("!"),
      window.lastIndexOf("?"),
      window.lastIndexOf(";"),
      window.lastIndexOf("\n")
    );
    if (lastSentenceBreak !== -1) window = window.slice(lastSentenceBreak + 1);
    const negated = NEGATIONS.some((n) => window.includes(n));
    if (!negated) return true;
  }
  return false;
}

function codeRequires7th(code: string): boolean {
  // Check built-in dataset (authoritative)
  for (const c of BUILTIN_REQUIRES_7TH) {
    if (c.startsWith(stem(code)) || stem(c) === stem(code)) return true;
  }
  // Fall back to prefix heuristic
  return SEVENTH_CHAR_PREFIXES.some((re) => re.test(code));
}

function allCodes(resp: ClinicalCodingResponse): { code: ICDCodeDetail; level: string }[] {
  return [
    { code: resp.primary_icd10, level: "primary" },
    ...resp.secondary_icd10.map((c) => ({ code: c, level: "secondary" })),
    ...resp.tertiary_icd10.map((c) => ({ code: c, level: "tertiary" })),
  ];
}

export function validateResponse(resp: ClinicalCodingResponse, clinicalNote?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const codes = allCodes(resp);

  // 1. 7th char check
  for (const { code, level } of codes) {
    const requires7th = codeRequires7th(code.code);
    const seventh = code.seventh_character ?? "not_required";
    if (requires7th) {
      if (seventh === "missing" || (seventh === "not_required" && !/[ADS]$/.test(code.code))) {
        // The LLM should have appended A/D/S to the code string. If the code
        // ends without A/D/S, raise an error.
        const endsWithADS = /[ADS]$/.test(code.code);
        if (!endsWithADS) {
          issues.push({
            level: "error",
            code: code.code,
            rule: "SEVENTH_CHAR_REQUIRED",
            message_en: `Code ${code.code} (${level}) belongs to a category that requires a 7th character (A=initial, D=subsequent, S=sequela). The submitted code does not include one and will be rejected by claim adjudication.`,
            message_ar: `الرمز ${code.code} (${level}) ينتمي إلى فئة تتطلب الحرف السابع (A للزيارة الأولى، D للمتابعة، S للمضاعفات). الرمز المُقدَّم لا يحتوي عليه وسيُرفض من نظام المطالبات المالية.`,
            suggestion_en: `Append the appropriate 7th character. For an ER / first-visit note, use "A" (e.g. ${stem(code.code)}A).`,
            suggestion_ar: `أضف الحرف السابع المناسب. لزيارة الطوارئ/الزيارة الأولى استخدم "A" (مثال: ${stem(code.code)}A).`,
          });
        }
      }
    }
  }

  // 1b. External cause as Primary check (V/W/X/Y codes are NEVER primary)
  const primaryFirstChar = resp.primary_icd10.code.charAt(0).toUpperCase();
  if (["V", "W", "X", "Y"].includes(primaryFirstChar)) {
    issues.push({
      level: "error",
      code: resp.primary_icd10.code,
      rule: "EXTERNAL_CAUSE_AS_PRIMARY",
      message_en: `Primary diagnosis ${resp.primary_icd10.code} is an External Cause code (chapter V/W/X/Y). External cause codes describe HOW an injury happened, not the injury itself. They must be Secondary or Tertiary — never Primary. The Primary should be the actual injury/condition code (e.g. an S-code for the wound).`,
      message_ar: `التشخيص الرئيسي ${resp.primary_icd10.code} هو رمز سبب خارجي (فصل V/W/X/Y). رموز الأسباب الخارجية تصف كيف حدث الإصابة وليس الإصابة نفسها. يجب أن تكون ثانوية أو ثالثية — وليست رئيسية أبداً. يجب أن يكون الرمز الرئيسي هو رمز الإصابة/الحالة الفعلية (مثال: رمز S للجرح).`,
      suggestion_en: `Move ${resp.primary_icd10.code} to tertiary, and add the actual injury code (e.g. S81.811A for laceration of right lower leg, or S80.01XA for contusion) as Primary.`,
      suggestion_ar: `انقل ${resp.primary_icd10.code} إلى الثالثي، وأضف رمز الإصابة الفعلي (مثال: S81.811A للجرح في الساق اليمنى، أو S80.01XA للكدمة) كرئيسي.`,
    });
  }

  // 2. Code-First / Use-Additional rules
  for (const rule of CODE_FIRST_RULES) {
    const triggered = codes.some(({ code }) =>
      rule.trigger_codes.some((tc) => code.code.startsWith(stem(tc)))
    );
    if (triggered) {
      // Check if ANY companion code is present (the rule is satisfied if at
      // least one of the suggested companions appears)
      const presentCompanions = rule.companion_codes.filter((c) =>
        codes.some(({ code }) => code.code.startsWith(stem(c)))
      );
      if (rule.companion_codes.length > 0 && presentCompanions.length === 0) {
        issues.push({
          level: "warning",
          rule: rule.rule_id,
          message_en: `Rule "${rule.rule_id}" triggered: ${rule.description_en}. None of the suggested companion code(s) are present: ${rule.companion_codes.join(", ")}.`,
          message_ar: `القاعدة "${rule.rule_id}" مُفعّلة: ${rule.description_ar}. لم يُذكر أيٌّ من الرموز المرافقة المقترحة: ${rule.companion_codes.join("، ")}.`,
          suggestion_en: `Add one of the suggested companion code(s): ${rule.companion_codes.join(", ")}.`,
          suggestion_ar: `أضف أحد الرموز المرافقة المقترحة: ${rule.companion_codes.join("، ")}.`,
        });
      } else {
        issues.push({
          level: "info",
          rule: rule.rule_id,
          message_en: `Code-First rule "${rule.rule_id}" correctly applied. Present companion: ${presentCompanions.join(", ") || "(no companion required)"}.`,
          message_ar: `تم تطبيق قاعدة "Code First" "${rule.rule_id}" بشكل صحيح. الرمز المرافق الموجود: ${presentCompanions.join("، ") || "(لا يوجد رمز مرافق مطلوب)"}.`,
        });
      }
    }
  }

  // 3. Low-confidence flag
  for (const { code, level } of codes) {
    if (typeof code.confidence === "number" && code.confidence < 0.6) {
      issues.push({
        level: "warning",
        code: code.code,
        rule: "LOW_CONFIDENCE",
        message_en: `Code ${code.code} (${level}) has low confidence (${(code.confidence * 100).toFixed(0)}%). Consider human review before submitting the claim.`,
        message_ar: `الرمز ${code.code} (${level}) ذو ثقة منخفضة (${(code.confidence * 100).toFixed(0)}%). يُوصى بالمراجعة البشرية قبل تقديم المطالبة.`,
        suggestion_en: `Review the clinical note and either confirm the code or replace it with a more specific one.`,
        suggestion_ar: `راجع النص الإكلينيكي وأكّد الرمز أو استبدله برمز أكثر دقة.`,
      });
    }
  }

  // 4. Duplicate detection
  const seen = new Map<string, string>();
  for (const { code, level } of codes) {
    const prev = seen.get(code.code);
    if (prev) {
      issues.push({
        level: "warning",
        code: code.code,
        rule: "DUPLICATE_CODE",
        message_en: `Code ${code.code} appears at both "${prev}" and "${level}" levels. Remove the duplicate.`,
        message_ar: `الرمز ${code.code} مكرر في المستويين "${prev}" و "${level}". احذف التكرار.`,
      });
    } else {
      seen.set(code.code, level);
    }
  }

  // 5. External-cause ordering: V/W/X/Y codes are supplemental and must come
  //    AFTER every A-Z/R/S/T diagnosis code (ICD-10-CM Chapter 20 guidelines).
  const orderedCodes = [
    ...resp.secondary_icd10.map((c, i) => ({ pos: i, code: c, level: "secondary" as const })),
    ...resp.tertiary_icd10.map((c, i) => ({ pos: i, code: c, level: "tertiary" as const })),
  ];
  const secondaryHasExternal = orderedCodes.some(
    (x) => x.level === "secondary" && isExternalCause(x.code.code)
  );
  if (secondaryHasExternal) {
    issues.push({
      level: "error",
      rule: "EXTERNAL_CAUSE_IN_SECONDARY",
      message_en:
        "An External Cause code (V/W/X/Y) was placed in Secondary Diagnoses. External cause codes are supplemental — they describe HOW an injury happened, not a co-existing condition. Per Chapter 20 guidelines they must be reported in the supplemental (last) section, after all diagnosis codes.",
      message_ar:
        "تم وضع رمز سبب خارجي (V/W/X/Y) ضمن التشخيصات الثانوية. رموز الأسباب الخارجية تكميلية — تصف كيف حدثت الإصابة وليست حالة مصاحبة. وفق قواعد الفصل 20 يجب أن تُبلَّغ في القسم التكميلي الأخير بعد جميع رموز التشخيص.",
      suggestion_en:
        "Move the V/W/X/Y code(s) from Secondary to the Supplemental section (tertiary), keeping them after all condition codes.",
      suggestion_ar:
        "انقل الرموز (V/W/X/Y) من الثانوية إلى القسم التكميلي (الثالثي) بحيث تأتي بعد جميع رموز الحالات.",
    });
  }

  // 6. Missing-secondary detection (UHDDS "other diagnoses" scan).
  //    If the note clearly documents a common chronic condition but no code
  //    anywhere covers its chapter, warn the coder.
  for (const cc of CHRONIC_CONDITION_MATCHERS) {
    const mentioned = cc.keywords.some((k) => keywordPresentNotNegated(clinicalNote ?? "", k));
    if (!mentioned) continue;
    const covered = codes.some(({ code }) =>
      cc.code_prefixes.some((p) => code.code.toUpperCase().startsWith(p.toUpperCase()))
    );
    if (!covered) {
      issues.push({
        level: "warning",
        rule: "SECONDARY_MISSING",
        message_en: `The note documents "${cc.label_en}" but no ${cc.code_prefixes.join(", ")} code was assigned. Per UHDDS / OGCR Section III, co-existing conditions that affect patient care (clinical evaluation, treatment, diagnostics, or monitoring) must be reported as secondary diagnoses every encounter where they are relevant.`,
        message_ar: `النص يذكر "${cc.label_ar}" لكن لم يُسند أي رمز من ${cc.code_prefixes.join("، ")}. وفق تعريف UHDDS والقسم الثالث من الدليل الرسمي، يجب ترميز الحالات المصاحبة المؤثرة على العلاج كتشخيصات ثانوية في كل زيارة.`,
        suggestion_en: `If "${cc.label_en}" is actively treated or monitored, add the appropriate ${cc.code_prefixes[0]}- code to Secondary Diagnoses. If it is historical/inactive, consider Z87.- personal history instead.`,
        suggestion_ar: `إذا كانت "${cc.label_ar}" تحت علاج أو متابعة فعّالة، أضف الرمز المناسب ${cc.code_prefixes[0]}- إلى التشخيصات الثانوية. وإذا كانت تاريخية/غير نشطة فكر في رمز Z87.- (تاريخ شخصي).`,
      });
    }
  }

  return issues;
}

function isExternalCause(code: string): boolean {
  const c = code.charAt(0).toUpperCase();
  return c === "V" || c === "W" || c === "X" || c === "Y";
}
