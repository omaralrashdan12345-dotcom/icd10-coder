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
import { extractUnconfirmedDiagnoses } from "./unconfirmed";
import { detectEncounterType } from "./encounter";
import { isSequelaInjuryCode, isResidualCode, detectResidualConditions } from "./sequela";
import { detectMedicationStatusCodes } from "./medication-conditions";

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
  // char is a valid 7th character (A/B/C/D/G/K/P/S).
  if (code.length >= 7) {
    const last = code[code.length - 1];
    if (/[ABCDGKPS]/.test(last)) {
      return code.slice(0, -1).replace(/\.?$/, "");
    }
  }
  return code;
}

/** Valid terminal 7th characters for S/T injury and V/W/X/Y external-cause codes. */
const VALID_SEVENTH = /^[ABCDGKPS]$/;

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
      if (seventh === "missing" || (seventh === "not_required" && !/[ABCDGKPS]$/.test(code.code))) {
        // The LLM should have appended a 7th character to the code string. If
        // the code ends without a valid 7th character, raise an error.
        const endsWithValid7th = /[ABCDGKPS]$/.test(code.code);
        if (!endsWithValid7th) {
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

      // Sprint 2 (idea H): sequencing check — when the rule declares
      // code_first_codes, those codes must appear EARLIER in the sequence
      // than the trigger code (official Tabular "code first" notes).
      if (rule.code_first_codes && rule.code_first_codes.length > 0) {
        const firstPresentIdx = rule.code_first_codes.reduce<number | null>((acc, cf) => {
          const idx = codes.findIndex(({ code }) => code.code.startsWith(stem(cf)));
          return acc === null ? (idx >= 0 ? idx : null) : Math.min(acc, idx >= 0 ? idx : acc);
        }, null);
        const triggerIdx = codes.findIndex(({ code }) =>
          rule.trigger_codes.some((tc) => code.code.startsWith(stem(tc)))
        );
        if (firstPresentIdx !== null && triggerIdx > firstPresentIdx) {
          issues.push({
            level: "info",
            rule: `${rule.rule_id}_ORDER_OK`,
            message_en: `Sequencing check passed for "${rule.rule_id}": the code-first condition appears before the combination/secondary code, matching the official Tabular List note. ${rule.description_en}`,
            message_ar: `تحقق الترتيب للقاعدة "${rule.rule_id}": الرمز المطلوب أولاً يظهر قبل الرمز المركب، مطابقاً ملاحظات القائمة الجدولية الرسمية. ${rule.description_ar}`,
          });
        }
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

  // 7. Unconfirmed outpatient language (Sprint 1, Idea D).
  //    Section IV.B: probable / suspected / rule-out conditions are NOT coded
  //    in outpatient settings — the coder excluded them; tell the user why.
  if (clinicalNote) {
    const unconfirmed = extractUnconfirmedDiagnoses(clinicalNote);
    const unique = unconfirmed.filter(
      (u, i, arr) => arr.findIndex((x) => x.phrase.toLowerCase() === u.phrase.toLowerCase()) === i
    );
    for (const u of unique.slice(0, 3)) {
      issues.push({
        level: "info",
        rule: "UNCONFIRMED_OUTPATIENT",
        message_en: `Unconfirmed diagnosis language detected ("${u.phrase}"). Per ICD-10-CM Official Guidelines Section IV.B (outpatient), probable/suspected/rule-out conditions are NOT coded as if established — the coder excluded it and any confirmed symptoms were coded instead.`,
        message_ar: `تم اكتشاف تشخيص غير مؤكد ("${u.phrase}"). وفق القسم IV.B من الدليل الرسمي (العيادات الخارجية)، لا يُرمَّز التشخيص المحتمل/المشكوك فيه؛ استبعدته المرمِّزة وتم ترميز الأعراض المؤكدة بدلاً منه.`,
        suggestion_en: `If the condition is later confirmed in the medical record, replace the symptom code with the confirmed diagnosis code.`,
        suggestion_ar: `إذا تأكد التشخيص لاحقاً في السجل الطبي، استبدل رمز العَرَض برمز التشخيص المؤكد.`,
      });
    }
  }

  // 8. Specificity clues (Sprint 1, Idea A): documentation present in the
  //    note but not reflected in the assigned codes.
  issues.push(...specificityClueIssues(clinicalNote ?? "", codes));

  // 9. Code format validity (Sprint 1, Idea I): placeholder X rules, invalid
  //    characters, incomplete external-cause codes, invalid 7th chars,
  //    3-char codes with known subdivided children.
  issues.push(...formatIssues(codes));

  // 10. Episode-of-care 7th-character grammar (Sprint 3, Idea B).
  //     a) the note's encounter type must match the injury code's 7th
  //        character (follow-up -> D, sequela -> S, ER/initial -> A);
  //     b) within one encounter, the injury code and its external-cause
  //        code must carry the SAME episode character.
  if (clinicalNote) {
    const enc = detectEncounterType(clinicalNote);
    const char7 = (c: string) => (c.length >= 7 ? c[c.length - 1].toUpperCase() : "");
    const injuryEntries = codes.filter(
      ({ code }) => /^[ST]/.test(code.code) && !/^T3[0-2]/.test(code.code)
    );
    const extEntries = codes.filter(({ code }) => isExternalCause(code.code));
    if (enc !== "initial") {
      const expected = enc === "subsequent" ? "D" : "S";
      const expectedDesc =
        enc === "subsequent"
          ? "subsequent encounter (follow-up / cast check / wound check)"
          : "sequela encounter (late effect / residual condition)";
      for (const { code, level } of injuryEntries) {
        if (char7(code.code) === "A") {
          issues.push({
            level: "warning",
            code: code.code,
            rule: "SEVENTH_CHAR_EPISODE",
            message_en: `The note documents a ${expectedDesc}, but injury code ${code.code} (${level}) ends with 7th character "A" (initial encounter). Injury and external-cause codes must reflect the correct episode of care or the claim will be adjudicated as an inconsistent episode.`,
            message_ar: `يُوثّق النص زيارة ${enc === "subsequent" ? "متابعة" : "مضاعفات لاحقة"}، لكن رمز الإصابة ${code.code} (${level}) ينتهي بالحرف السابع "A" (الزيارة الأولى). يجب أن تعكس رموز الإصابة والأسباب الخارجية نوع الزيارة الصحيح وإلا سُيُرفضت المطالبة كحلقة غير متسقة.`,
            suggestion_en: `Replace the 7th character with "${expected}", e.g. ${stem(code.code)}${expected}.`,
            suggestion_ar: `استبدل الحرف السابع بـ "${expected}"، مثال: ${stem(code.code)}${expected}.`,
          });
        }
      }
    }
    const injChars = new Set(
      injuryEntries.map(({ code }) => char7(code.code)).filter((ch) => /[ABCDGKPS]/.test(ch))
    );
    const extChars = new Set(
      extEntries.map(({ code }) => char7(code.code)).filter((ch) => /[ABCDGKPS]/.test(ch))
    );
    if (injChars.size > 0 && extChars.size > 0 && ![...injChars].some((ch) => extChars.has(ch))) {
      issues.push({
        level: "warning",
        rule: "SEVENTH_CHAR_MISMATCH",
        message_en: `Episode-of-care mismatch: injury code 7th character(s) ${[...injChars].join("/")} vs external-cause 7th character(s) ${[...extChars].join("/")}. Within one encounter, the injury code and its external-cause code must carry the SAME 7th character (A/B/D/G/K/P/S).`,
        message_ar: `عدم تطابق نوع الزيارة: الحرف السابع لرمز الإصابة ${[...injChars].join("/")} بينما رمز السبب الخارجي ${[...extChars].join("/")}. في نفس الزيارة يجب أن يحمل رمز الإصابة ورمز السبب الخارجي نفس الحرف السابع.`,
        suggestion_en: `Align the 7th characters of the injury and external-cause codes to the same episode of care.`,
        suggestion_ar: `وحّد الحرف السابع لرموز الإصابة والأسباب الخارجية على نفس نوع الزيارة.`,
      });
    }
  }

  // 11. Sequela dual-coding (Sprint 3, Idea C) — Official Guidelines I.C.19.2:
  //     the residual condition is sequenced FIRST, then the injury code with
  //     7th character "S".
  const sequelaEntries = codes.filter(({ code }) => isSequelaInjuryCode(code.code));
  if (sequelaEntries.length > 0) {
    const firstSequelaIdx = codes.findIndex(({ code }) => isSequelaInjuryCode(code.code));
    const firstResidualIdx = codes.findIndex(({ code }) => isResidualCode(code.code));
    if (firstResidualIdx >= 0) {
      if (firstResidualIdx < firstSequelaIdx) {
        issues.push({
          level: "info",
          rule: "SEQUELA_DUAL_CODE_OK",
          message_en: `Sequela dual-coding correctly applied: the residual condition is sequenced BEFORE the injury code with 7th character "S" (${sequelaEntries.map((c) => c.code.code).join(", ")}), per ICD-10-CM Official Guidelines I.C.19.2.`,
          message_ar: `تم تطبيق الترميز المزدوج للمضاعفات بشكل صحيح: الحالة المتبقية مُسردة قبل رمز الإصابة ذي الحرف السابع "S"، وفق القسم I.C.19.2 من الدليل الرسمي.`,
        });
      } else {
        issues.push({
          level: "warning",
          code: sequelaEntries[0].code.code,
          rule: "SEQUELA_ORDER",
          message_en: `Sequela sequencing: the RESIDUAL condition must be listed FIRST, followed by the injury code with 7th character "S". Currently the S-tagged injury code (${sequelaEntries.map((c) => c.code.code).join(", ")}) appears before the residual-condition code.`,
          message_ar: `ترتيب المضاعفات: يجب إدراج الحالة المتبقية أولاً ثم رمز الإصابة ذا الحرف السابع "S". حالياً يظهر رمز الإصابة قبل رمز الحالة المتبقية.`,
          suggestion_en: `Move the residual-condition code (e.g. chronic pain, stiffness) ahead of the S-tagged injury code.`,
          suggestion_ar: `انقل رمز الحالة المتبقية (مثل الألم المزمن أو التيبس) ليسبق رمز الإصابة ذا الحرف S.`,
        });
      }
    } else if (clinicalNote) {
      const residualsInNote = detectResidualConditions(
        clinicalNote,
        (k) => keywordPresentNotNegated(clinicalNote, k),
        () => "unspecified"
      );
      if (residualsInNote.length > 0) {
        issues.push({
          level: "warning",
          code: sequelaEntries[0].code.code,
          rule: "SEQUELA_RESIDUAL_MISSING",
          message_en: `The injury code ${sequelaEntries[0].code.code} uses 7th character "S" (sequela) and the note documents residual condition(s) (${residualsInNote.map((r) => r.id).join(", ")}). Per I.C.19.2, TWO codes are required: the residual condition sequenced FIRST, then the S-tagged injury code.`,
          message_ar: `رمز الإصابة ${sequelaEntries[0].code.code} يحمل الحرف السابع "S" والملاحظة توثّق حالة متبقية. وفق I.C.19.2 يلزم رمزان: الحالة المتبقية أولاً ثم رمز الإصابة.`,
          suggestion_en: `Add the residual-condition code first, e.g. ${residualsInNote[0].code} (${residualsInNote[0].description}), keeping ${sequelaEntries[0].code.code} second.`,
          suggestion_ar: `أضف رمز الحالة المتبقية أولاً، مثال: ${residualsInNote[0].code}، مع إبقاء ${sequelaEntries[0].code.code} ثانياً.`,
        });
      }
    }
  }

  // 12. Medication-status Z-codes (Sprint 3, Idea G) — Official Guidelines
  //     I.C.21.c: long-term drug therapy (Z79.-) and drug-allergy status
  //     (Z88.-) affect patient care and must be reported; therapeutic drug
  //     level monitoring encounters take Z51.81.
  if (clinicalNote) {
    const expectedMeds = detectMedicationStatusCodes(clinicalNote);
    for (const f of expectedMeds) {
      const present = codes.some(({ code }) => code.code.toUpperCase().startsWith(f.code));
      if (present) continue;
      const ruleId =
        f.kind === "long_term"
          ? "MED_ZCODE_MISSING"
          : f.kind === "allergy"
            ? "ALLERGY_ZCODE_MISSING"
            : "DRUG_MONITORING_MISSING";
      issues.push({
        level: "warning",
        code: f.code,
        rule: ruleId,
        message_en:
          f.kind === "long_term"
            ? `The note documents long-term use of "${f.drug}", but no ${f.code} (${f.description}) code was assigned. Long-term (current) drug therapy affects patient care and must be reported as a secondary diagnosis (I.C.21.c).`
            : f.kind === "allergy"
              ? `The note documents a drug allergy ("${f.drug}"), but no ${f.code} (${f.description}) code was assigned. Allergy status must be reported so downstream providers avoid the drug.`
              : `The note documents therapeutic drug level monitoring ("${f.drug}"), but no Z51.81 (Encounter for therapeutic drug level monitoring) code was assigned.`,
        message_ar:
          f.kind === "long_term"
            ? `يُوثّق النص استخدام دواء طويل الأمد ("${f.drug}") لكن لم يُسند رمز ${f.code}. العلاج الدوائي طويل الأمد يؤثر على رعاية المريض ويجب إبلاغه كتشخيص ثانوي.`
            : f.kind === "allergy"
              ? `يُوثّق النص حساسية دوائية ("${f.drug}") لكن لم يُسند رمز ${f.code}. يجب إبلاغ حالة الحساسية لتفادي الدواء مستقبلاً.`
              : `يُوثّق النص متابعة مستوى دوائي ("${f.drug}") لكن لم يُسند رمز Z51.81 (زيارة لمتابعة مستوى الدواء العلاجي).`,
        suggestion_en: `Add ${f.code} (${f.description}) to Secondary Diagnoses.`,
        suggestion_ar: `أضف ${f.code} إلى التشخيصات الثانوية.`,
      });
    }
  }

  return issues;
}

function isExternalCause(code: string): boolean {
  const c = code.charAt(0).toUpperCase();
  return c === "V" || c === "W" || c === "X" || c === "Y";
}

const FRACTURE_PREFIX_RE = /^(?:S(?:02|12|22|32|42|52|62|72|82|92))/;

/** Laterality-sensitive families where the character after the prefix is 9 = unspecified side. */
const LATERAL_FAMILIES = [
  "M17.1", "M16.1", "M25.51", "M25.52", "M25.53", "M25.54", "M25.55", "M25.56", "M25.57",
  "M79.60", "M79.63", "M79.67", "G56.0", "M75.4", "M20.1",
];

function specificityClueIssues(note: string, codes: { code: ICDCodeDetail; level: string }[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const n = note ?? "";
  if (!n) return issues;

  const hasBilateral = /\bbilateral\b|both\s+(?:knees|hips|sides)/i.test(n);
  const hasOpenFx = /\bopen\s+(?:fracture|fx\b)|compound\s+(?:fracture|fx\b)|gustilo/i.test(n);
  const hasUncontrolled = /uncontrolled|poorly\s+controlled|hyperglycem|high\s+blood\s+sugar|elevated\s+glucose/i.test(n);
  const hasSide = /\b(left|right)\b/i.test(n);

  for (const { code, level } of codes) {
    const c = code.code.toUpperCase();
    // A.1 bilateral documented but unilateral/unspecified OA code assigned
    if (hasBilateral && /^(?:M17\.9|M17\.1[12]|M16\.9|M16\.1[12])$/.test(c)) {
      const target = c.startsWith("M17") ? "M17.0" : "M16.0";
      issues.push({
        level: "warning",
        code: c,
        rule: "SPECIFICITY_BILATERAL",
        message_en: `The note documents a BILATERAL condition but ${c} (${level}) is a unilateral/unspecified code. Bilateral primary osteoarthritis of the knee/hip has its own code (${target}).`,
        message_ar: `النص يوثّق إصابة ثنائية الجانب بينما الرمز ${c} (${level}) لجهة واحدة أو غير محدد. الخشونة الثنائية للركبة/الورك لها رمز خاص (${target}).`,
        suggestion_en: `Replace ${c} with ${target} (bilateral primary osteoarthritis).`,
        suggestion_ar: `استبدل ${c} بالرمز ${target} (خشونة أولية ثنائية الجانب).`,
      });
    }
    // A.2 open fracture documented but closed 7th char (A) assigned
    if (hasOpenFx && FRACTURE_PREFIX_RE.test(c) && /A$/.test(c)) {
      issues.push({
        level: "warning",
        code: c,
        rule: "SEVENTH_CHAR_OPEN_FRACTURE",
        message_en: `The note documents an OPEN fracture but ${c} (${level}) ends with 7th character "A" (initial encounter for CLOSED fracture). Per ICD-10-CM, "A" is only for closed fractures.`,
        message_ar: `النص يوثّق كسراً مفتوحاً بينما الرمز ${c} (${level}) ينتهي بالحرف السابع "A" (زيارة أولى لكسر مغلق). وفق ICD-10-CM حرف "A" للكسور المغلقة فقط.`,
        suggestion_en: `Use "B" (open fracture, Gustilo grade I/II) or "C" (Gustilo grade III), e.g. ${c.slice(0, -1)}B.`,
        suggestion_ar: `استخدم "B" (كسر مفتوح درجة I/II) أو "C" (درجة III)، مثال: ${c.slice(0, -1)}B.`,
      });
    }
    // A.3 uncontrolled diabetes documented but uncomplicated code assigned
    if (hasUncontrolled && /^(?:E11\.9|E10\.9)$/.test(c)) {
      const target = c.startsWith("E11") ? "E11.65" : "E10.65";
      issues.push({
        level: "warning",
        code: c,
        rule: "SPECIFICITY_UNCONTROLLED_DM",
        message_en: `The note documents uncontrolled/poorly-controlled diabetes but ${c} (${level}) is "without complications". Hyperglycemia is a documented complication.`,
        message_ar: `النص يذكر سكري غير مضبوط بينما الرمز ${c} (${level}) يعني "بدون مضاعفات". فرط سكر الدم مضاعفة موثّقة.`,
        suggestion_en: `Use ${target} (diabetes with hyperglycemia) instead of ${c}.`,
        suggestion_ar: `استخدم ${target} (السكري مع فرط سكر الدم) بدلاً من ${c}.`,
      });
    }
    // A.4 laterality documented but unspecified-side (9) code assigned
    if (hasSide) {
      for (const fam of LATERAL_FAMILIES) {
        if (c.startsWith(fam) && c.length > fam.length && c.charAt(fam.length) === "9") {
          issues.push({
            level: "warning",
            code: c,
            rule: "SPECIFICITY_LATERALITY",
            message_en: `The note documents a side (left/right) but ${c} (${level}) ends in "9" = unspecified side.`,
            message_ar: `النص يحدد الجانب (أيسر/أيمن) بينما الرمز ${c} (${level}) ينتهي بـ "9" أي جانب غير محدد.`,
            suggestion_en: `Prefer the right/left-specific code (character 1 = right, 2 = left) when the note supports it.`,
            suggestion_ar: `يُفضّل استخدام الرمز المحدد للجانب (الرقم 1 = أيمن، 2 = أيسر) عندما يدعم النص ذلك.`,
          });
          break;
        }
      }
    }
  }
  return issues;
}

function formatIssues(codes: { code: ICDCodeDetail; level: string }[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { code, level } of codes) {
    const c = code.code.toUpperCase();

    // I.1 invalid characters: ICD-10-CM never uses the letters I or O
    const stem = c.length >= 7 && VALID_SEVENTH.test(c[c.length - 1]) ? c.slice(0, -1) : c;
    // Strip the chapter letter (leading char) before the I/O test — chapter
    // "I" (I00-I99, circulatory) is a legitimate first character.
    if (/[IO]/.test(stem.replace(".", "").slice(1))) {
      issues.push({
        level: "warning",
        code: c,
        rule: "INVALID_CODE_CHARACTER",
        message_en: `Code ${c} (${level}) contains the letter I or O. ICD-10-CM codes never use these letters (they are confused with the digits 1 and 0).`,
        message_ar: `الرمز ${c} (${level}) يحتوي على الحرف I أو O. رموز ICD-10-CM لا تستخدم هذين الحرفين أبداً (للخلط بينهما والرقمين 1 و 0).`,
        suggestion_en: `Double-check the code against the Tabular List and correct the letter.`,
        suggestion_ar: `تحقق من الرمز مقابل القائمة التفصيلية وصحّح الحرف.`,
      });
    }

    // I.2 T36-T50 poisoning codes must use the placeholder X in the 5th position
    if (/^T(?:3[6-9]|4[0-9]|50)\./.test(c) && /^T(?:3[6-9]|4[0-9]|50)\.\d{2}/.test(stem)) {
      issues.push({
        level: "warning",
        code: c,
        rule: "POISONING_PLACEHOLDER_X",
        message_en: `Poisoning code ${c} (${level}) appears to be missing the placeholder "X". T36-T50 poisoning codes fill the unused 5th character with X (e.g. T39.1X1A, not T39.11A).`,
        message_ar: `رمز التسمم ${c} (${level}) يبدو ناقصاً حرف الحشو "X". رموز التسمم T36-T50 تملأ الحرف الخامس غير المستخدم بـ X (مثال: T39.1X1A وليس T39.11A).`,
        suggestion_en: `Insert the placeholder X, e.g. T39.1X1A.`,
        suggestion_ar: `أضف حرف الحشو X، مثال: T39.1X1A.`,
      });
    }

    // I.3 external-cause codes with a 7th char must fill unused positions with X
    if (isExternalCause(c) && c.length >= 5 && c.length < 7 && VALID_SEVENTH.test(c[c.length - 1])) {
      issues.push({
        level: "warning",
        code: c,
        rule: "EXTERNAL_CAUSE_INCOMPLETE",
        message_en: `External-cause code ${c} (${level}) is incomplete. V/W/X/Y codes with a 7th character must fill unused characters with X (e.g. W19.XXXA, V89.2XXA).`,
        message_ar: `رمز السبب الخارجي ${c} (${level}) غير مكتمل. رموز V/W/X/Y ذات الحرف السابع تملأ المواضع غير المستخدمة بـ X (مثال: W19.XXXA و V89.2XXA).`,
        suggestion_en: `Pad the unused positions with X before the 7th character.`,
        suggestion_ar: `املأ المواضع غير المستخدمة بـ X قبل الحرف السابع.`,
      });
    }

    // I.4 invalid 7th character for S/T codes
    if (/^[ST]/.test(c) && c.length >= 7 && !VALID_SEVENTH.test(c[c.length - 1])) {
      issues.push({
        level: "warning",
        code: c,
        rule: "INVALID_SEVENTH_CHAR",
        message_en: `Injury code ${c} (${level}) ends with an invalid 7th character. Valid injury 7th characters are A/B/C (initial), D (subsequent), G/K/P (healing complications), S (sequela).`,
        message_ar: `رمز الإصابة ${c} (${level}) ينتهي بحرف سابع غير صالح. الحروف السابعة الصالحة: A/B/C (أولى)، D (لاحقة)، G/K/P (مضاعفات الالتئام)، S (مضاعفات).`,
        suggestion_en: `Replace the final character with a valid 7th character.`,
        suggestion_ar: `استبدل الحرف الأخير بحرف سابع صالح.`,
      });
    }

    // I.5 3-character category code that has subdivided children in the built-in dataset
    if (/^[A-TV-Z]\d{2}$/.test(c)) {
      const hasChildren = BUILTIN_ICD10.some((e) => e.code.startsWith(c + "."));
      if (hasChildren) {
        issues.push({
          level: "warning",
          code: c,
          rule: "NOT_CODED_TO_FULL_SPECIFICITY",
          message_en: `Code ${c} (${level}) is a category heading with subdivided child codes. ICD-10-CM requires coding to the highest level of specificity documented (combine with the note for a billable code).`,
          message_ar: `الرمز ${c} (${level}) عنوان فئة له رموز فرعية. يتطلب ICD-10-CM الترميز لأعلى مستوى تحديد موثّق (للحصول على رمز قابل للفوترة).`,
          suggestion_en: `Add the subdivision characters documented in the note, e.g. ${c}.9 only when no greater specificity exists.`,
          suggestion_ar: `أضف خانات التحديد الموثقة في النص، مثال: ${c}.9 فقط عند غياب أي تحديد أدق.`,
        });
      }
    }
  }
  return issues;
}
