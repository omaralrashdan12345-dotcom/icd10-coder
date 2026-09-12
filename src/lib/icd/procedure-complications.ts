/**
 * Procedure-complication engine (Sprint 5, Idea K).
 *
 * Peri-procedural / postprocedural complications of surgical and medical
 * care (ICD-10-CM chapter 19 block T80-T88) with their Chapter-20
 * external-cause pairing (Y62-Y84), per Official Guidelines I.C.20.d:
 *  - The complication code is sequenced FIRST when the encounter is FOR
 *    the complication (I.C.20.d.1 style sequencing).
 *  - An external cause code identifying the procedure (Y83 surgical
 *    operations / Y84 other medical procedures) or the misadventure
 *    (Y62 failure of sterile precautions) or the implicated device
 *    (Y70-Y79 device families) is reported as a SUPPLEMENTAL code.
 *  - Y62-Y84 external-cause codes DO NOT take a 7th character (verified
 *    against the bundled FY2026 extract: rows are 4-5 characters, e.g.
 *    Y83.9, Y79.2, Y84.8), while the complication T-codes take the
 *    episode-of-care 7th character A/D/S (verified rows: T81.40XA/XD/XS,
 *    T81.9XXA, T84.51XA, ...).
 *
 * FY2026 EXTRACT FACTS (spot-checked against public/icd10cm chunks):
 *  - PRESENT: T81.3- wound disruption (30 rows), T81.4- postprocedural
 *    infection incl. T81.44 "Sepsis following a procedure" (25 rows),
 *    T81.5- foreign body accidentally left (206 rows), T81.7- vascular
 *    complications (22 rows), T80.x infusion/transfusion complications,
 *    T88.3 malignant hyperthermia, T88.8/T88.9 fallbacks, device families
 *    T82/T83/T84/T85 (mechanical + infection subfamilies), Y62/Y70-Y79/
 *    Y83/Y84 external causes, R65.20/R65.21.
 *  - ABSENT (engine must NEVER emit these): T81.0- "Hemorrhage and
 *    hematoma complicating a procedure" (0 rows), the pre-FY2019
 *    "accidental puncture or laceration during a procedure" layout
 *    (0 description hits), R57.2 "Septic shock" (0 rows — septic shock
 *    codes to R65.21 in FY2026). These gaps are recorded for the future
 *    data pass that re-derives the extract from the CDC order file.
 *
 * Every code emitted by this module is a verified DB row (see
 * scripts/regression_sprint5.ts DB-presence sweep).
 */

export interface ExternalCauseHit {
  code: string;
  description: string;
}

export interface ProcedureComplicationHit {
  /** Machine-readable kind, e.g. "device_infection", "wound_disruption". */
  kind: string;
  /** Human label used in the response summary. */
  label: string;
  /** Complete complication code INCLUDING the episode 7th character. */
  tcode: string;
  /** Official-style description including the encounter phrase. */
  tdesc: string;
  /** Matched cue (for rationale + validation messages). */
  cue: string;
  /** Paired external cause (Y62/Y70-Y79/Y83/Y84) — null when none applies. */
  ext: ExternalCauseHit | null;
  confidence: number;
}

/** 7th character for complication codes: sequela -> S, documented complication follow-up -> D, else A. */
export function complicationEpisode(note: string): "A" | "D" | "S" {
  const t = note.toLowerCase();
  if (/\bsequela\b|\blate (?:effect|complication)\b|\bresidual\b/.test(t)) return "S";
  if (
    /\b(?:follow-?up|return visit|recheck)\b[^.]*\b(?:infection|dehiscence|complication|wound)\b/.test(t) ||
    /\b(?:infection|dehiscence|complication)\b[^.]*\b(?:follow-?up|recheck)\b/.test(t)
  ) {
    return "D";
  }
  return "A";
}

const EPISODE_WORD: Record<"A" | "D" | "S", string> = {
  A: "initial",
  D: "subsequent",
  S: "sequela",
};

const STERILE_FAILURE_RE =
  /failure of sterile precautions|broke(?:n)? sterile (?:technique|field)|sterile (?:technique|field) (?:was )?(?:breached|contaminated)|lapse in sterile technique|contaminated surgical field/i;

/** Append the episode 7th character to a stem that already contains X placeholders. */
function withEnc(stem: string, ep: "A" | "D" | "S"): string {
  return stem + ep;
}

function desc(base: string, ep: "A" | "D" | "S"): string {
  return `${base}, ${EPISODE_WORD[ep]} encounter`;
}

const EXT = {
  sterileSurgery: { code: "Y62.0", description: "Failure of sterile precautions during surgical operation" },
  sterileInfusion: { code: "Y62.1", description: "Failure of sterile precautions during infusion or transfusion" },
  sterileDialysis: { code: "Y62.2", description: "Failure of sterile precautions during kidney dialysis" },
  sterileCath: { code: "Y62.6", description: "Failure of sterile precautions during aspiration, puncture or other catheterization" },
  sterileOther: { code: "Y62.8", description: "Failure of sterile precautions during other surgery and medical care" },
  cardioDevice: { code: "Y71.2", description: "Prosthetic and other implants, materials and cardiovascular devices associated with adverse incidents" },
  neuroDevice: { code: "Y75.2", description: "Prosthetic and other implants, materials and neurological devices associated with adverse incidents" },
  orthoDevice: { code: "Y79.2", description: "Prosthetic and other implants, materials and orthopedic devices associated with adverse incidents" },
  surgery: { code: "Y83.9", description: "Surgical procedure, unspecified, as the cause of abnormal reaction or later complication, without mention of misadventure" },
  cardiacCath: { code: "Y84.0", description: "Cardiac catheterization as the cause of abnormal reaction or later complication, without mention of misadventure" },
  dialysis: { code: "Y84.1", description: "Kidney dialysis as the cause of abnormal reaction or later complication, without mention of misadventure" },
  urinaryCath: { code: "Y84.6", description: "Urinary catheterization as the cause of abnormal reaction or later complication, without mention of misadventure" },
  otherMedical: { code: "Y84.8", description: "Other medical procedures as the cause of abnormal reaction or later complication, without mention of misadventure" },
} as const;

type ExtKey = keyof typeof EXT;

/**
 * Sentence-level guards (Sprint 5 conventions: negation-aware + suspect-
 * guarded + family-history-proof):
 *  - a sentence starting with/containing a negation ("no signs of wound
 *    infection") or unconfirmed language ("suspected wound infection") is
 *    discarded;
 *  - sentences mentioning family members ("mother had a retained sponge")
 *    are discarded so historical/family events never code the patient.
 */
const SENTENCE_NEGATION_RE =
  /\b(?:no|not|without|denies|denied|negative for|free of|clear of|absent|rule out|ruled out|suspected|presumed|probable|possible|risk for|risk of|cannot rule out)\b/i;
const FAMILY_HISTORY_RE =
  /\b(?:family history|mother|father|brother|sister|grandmother|grandfather|uncle|aunt|son|daughter)\b/i;

function complicationSentences(note: string): string {
  return note
    .split(/[.!?;\n]/)
    .filter((s) => !SENTENCE_NEGATION_RE.test(s))
    .filter((s) => !FAMILY_HISTORY_RE.test(s))
    .join(". ")
    .toLowerCase();
}

export function detectProcedureComplication(rawNote: string): ProcedureComplicationHit | null {
  const t = complicationSentences(rawNote);
  if (!t) return null;
  const ep = complicationEpisode(t);
  const sterileFailure = STERILE_FAILURE_RE.test(t);
  const side = /\bleft\b|\blt\b|\bl\b/.test(t) ? "left" : /\bright\b|\brt\b|\br\b/.test(t) ? "right" : "unspecified";

  const hit = (
    kind: string,
    label: string,
    tcode: string,
    tdesc: string,
    cue: string,
    ext: ExternalCauseHit,
    confidence = 0.84
  ): ProcedureComplicationHit => ({ kind, label, tcode, tdesc, cue, ext, confidence });

  // ---- 1. Device infections (most specific — check first) ---------------
  // Internal joint prosthesis infection (T84.5-, side-aware) + Y79.2
  if (/infected (?:internal )?(?:right |left )?(?:hip|knee) (?:prosthesis|replacement|implant)|prosthetic (?:hip|knee) (?:joint )?infection|(?:hip|knee) (?:prosthesis|replacement|implant) infection/.test(t)) {
    const joint = /hip/.test(t) ? "hip" : "knee";
    const code =
      joint === "hip"
        ? side === "right" ? "T84.51X" : side === "left" ? "T84.52X" : "T84.50X"
        : side === "right" ? "T84.53X" : side === "left" ? "T84.54X" : "T84.50X";
    const base = `Infection and inflammatory reaction due to internal ${side !== "unspecified" ? `${side} ` : ""}${joint} prosthesis`;
    return hit("device_infection", `infected ${joint} prosthesis`, withEnc(code, ep), desc(base, ep), `infected ${joint} prosthesis`, EXT.orthoDevice);
  }
  // Internal fixation device infection (T84.6-) + Y79.2
  if (/infected (?:internal )?fixation (?:device )?(?:plate|screw|rod|nail|pin)|infected (?:plate|screw|rod|nail|pin|orif|open reduction)/.test(t)) {
    return hit("device_infection", "infected internal fixation device", withEnc("T84.60X", ep), desc("Infection and inflammatory reaction due to internal fixation device of unspecified site", ep), "infected fixation hardware", EXT.orthoDevice);
  }
  // Cardiac valve prosthesis infection (T82.6-) + Y71.2
  if (/infected (?:heart )?valve prosthesis|infection (?:of|around) (?:the )?(?:heart )?valve prosthesis|prosthetic valve (?:endocarditis|infection)/.test(t)) {
    return hit("device_infection", "infected heart valve prosthesis", withEnc("T82.6XX", ep), desc("Infection and inflammatory reaction due to cardiac valve prosthesis", ep), "infected valve prosthesis", EXT.cardioDevice);
  }
  // Cardiac electronic device infection (T82.7-) + Y71.2
  if (/infected (?:pacemaker|defibrillator|icd|cardiac (?:electronic )?device)|pacemaker (?:pocket |site )?infection/.test(t)) {
    return hit("device_infection", "infected pacemaker/cardiac device", withEnc("T82.7XX", ep), desc("Infection and inflammatory reaction due to other cardiac and vascular devices, implants and grafts", ep), "infected cardiac device", EXT.cardioDevice);
  }
  // Ventricular (VP) shunt infection (T85.730-) + Y75.2
  if (/(?:vp |ventriculoperitoneal |ventricular )shunt infection|infected (?:vp |ventriculoperitoneal |ventricular )shunt/.test(t)) {
    return hit("device_infection", "infected ventricular shunt", withEnc("T85.730", ep), desc("Infection and inflammatory reaction due to ventricular intracranial (communicating) shunt", ep), "infected ventricular shunt", EXT.neuroDevice);
  }
  // Peritoneal dialysis catheter infection (T85.71X-) + Y84.1 / Y62.2
  if (/dialysis catheter infection|infected (?:peritoneal )?dialysis catheter|peritonitis (?:due to|from|related to) (?:the )?dialysis catheter/.test(t)) {
    return hit("device_infection", "infected dialysis catheter", withEnc("T85.71X", ep), desc("Infection and inflammatory reaction due to peritoneal dialysis catheter", ep), "infected dialysis catheter", sterileFailure ? EXT.sterileDialysis : EXT.dialysis);
  }
  // Central venous catheter bloodstream infection (T80.211-) + Y84.8 / Y62.6
  if (/central line(?:-| )?associated (?:bloodstream )?infection|central line(?:-| )?related (?:bloodstream )?infection|\bclabsi\b|bloodstream infection due to (?:a )?central venous catheter/.test(t)) {
    return hit("device_infection", "central line bloodstream infection", withEnc("T80.211", ep), desc("Bloodstream infection due to central venous catheter", ep), "central line bloodstream infection", sterileFailure ? EXT.sterileCath : EXT.otherMedical);
  }
  // Urinary catheter-associated UTI (T83.51x-) + Y84.6 / Y62.8
  if (/catheter(?:-| )?(?:associated|related) (?:uti|urinary tract infection)|uti (?:due|secondary|related) to (?:an |the )?(?:indwelling )?(?:urinary )?catheter/.test(t)) {
    const code = /indwelling urethral|urethral catheter/.test(t) ? "T83.511" : "T83.518";
    const base = /indwelling urethral|urethral catheter/.test(t)
      ? "Infection and inflammatory reaction due to indwelling urethral catheter"
      : "Infection and inflammatory reaction due to other urinary catheter";
    return hit("device_infection", "catheter-associated urinary tract infection", withEnc(code, ep), desc(base, ep), "catheter-associated UTI", sterileFailure ? EXT.sterileOther : EXT.urinaryCath);
  }

  // ---- 2. Postprocedural / surgical-site infection (T81.4-) -------------
  if (/postoperative sepsis|post-?op sepsis|sepsis (?:after|following) (?:the )?(?:surgery|procedure|operation)|sepsis following a procedure/.test(t)) {
    return hit("postprocedural_sepsis", "sepsis following a procedure", withEnc("T81.44X", ep), desc("Sepsis following a procedure", ep), "postoperative sepsis", sterileFailure ? EXT.sterileSurgery : EXT.surgery);
  }
  if (/(?:surgical site|surgical wound|incision|post-?op(?:erative)? wound|sternal) (?:infection|is infected)|infected (?:surgical|sternal) wound|superficial (?:surgical site )?infection|deep (?:surgical site )?infection|wound infection/.test(t)) {
    const code = /superficial/.test(t) ? "T81.41X" : /deep(?! vein)/.test(t) ? "T81.42X" : "T81.40X";
    const base =
      code === "T81.41X"
        ? "Infection following a procedure, superficial incisional surgical site"
        : code === "T81.42X"
          ? "Infection following a procedure, deep incisional surgical site"
          : "Infection following a procedure, unspecified";
    return hit("infection", "postprocedural wound infection", withEnc(code, ep), desc(base, ep), "postprocedural wound infection", sterileFailure ? EXT.sterileSurgery : EXT.surgery);
  }

  // ---- 3. Wound disruption (T81.3-) -------------------------------------
  if (/anastomotic (?:leak|dehiscence|disruption)|dehiscence of (?:the )?(?:bowel|colon|rectal|gastrointestinal|gi) (?:anastomosis|repair|closure)/.test(t)) {
    return hit("wound_disruption", "GI anastomotic disruption", withEnc("T81.320", ep), desc("Disruption and dehiscence of gastrointestinal tract anastomosis, repair or closure", ep), "anastomotic leak", EXT.surgery);
  }
  if (/wound dehiscence|dehiscence of (?:the )?(?:surgical|operation) wound|wound (?:has )?(?:reopened|separated|burst open)|staples? (?:have )?(?:come|popped) (?:apart|off)|sutures? (?:have )?(?:come|popped) apart/.test(t)) {
    return hit("wound_disruption", "surgical wound dehiscence", withEnc("T81.31X", ep), desc("Disruption of external operation (surgical) wound, not elsewhere classified", ep), "wound dehiscence", EXT.surgery);
  }

  // ---- 4. Foreign body accidentally left during procedure (T81.5-) ------
  if (/retained surgical (?:item|sponge|gauze|instrument|needle|object)|foreign body (?:accidentally )?left (?:behind|in (?:the )?(?:body|abdomen|pelvis)) (?:during|after|following)|gossypiboma/.test(t)) {
    return hit("retained_fb", "foreign body accidentally left during procedure", withEnc("T81.500", ep), desc("Unspecified complication of foreign body accidentally left in body following surgical operation", ep), "retained surgical item", EXT.surgery);
  }

  // ---- 5. Vascular complications following a procedure (T81.7-) ---------
  if (
    /pseudoaneurysm/i.test(t) ||
    /arterial (?:bleed|bleeding|injury) (?:after|following) (?:the )?(?:catheterization|angiography|procedure)/i.test(t)
  ) {
    const cath = /cardiac cath(?:eterization)?|angiography|angiogram/.test(t);
    return hit("vascular", "arterial complication following a procedure", withEnc("T81.718", ep), desc("Complication of artery following a procedure, not elsewhere classified", ep), "pseudoaneurysm/arterial complication after procedure", cath ? EXT.cardiacCath : EXT.surgery);
  }

  // ---- 6. Infusion / transfusion complications (T80.x) ------------------
  if (/extravasation of (?:vesicant )?(?:antineoplastic |chemotherapy )?(?:agent|drug)|chemotherapy (?:infiltration|extravasation)|extravasation injury/.test(t)) {
    const code = /chemo|antineoplastic|doxorubicin|vincristine|vesicant/.test(t) ? "T80.810" : "T80.818";
    const base = code === "T80.810" ? "Extravasation of vesicant antineoplastic chemotherapy" : "Extravasation of other vesicant agent";
    return hit("transfusion_infusion", "extravasation of vesicant agent", withEnc(code, ep), desc(base, ep), "extravasation", sterileFailure ? EXT.sterileInfusion : EXT.otherMedical);
  }
  if (/hemolytic transfusion reaction/.test(t)) {
    return hit("transfusion_infusion", "acute hemolytic transfusion reaction", withEnc("T80.910", ep), desc("Acute hemolytic transfusion reaction, unspecified incompatibility", ep), "hemolytic transfusion reaction", EXT.otherMedical);
  }
  if (/abo incompatibility (?:reaction)?/.test(t)) {
    return hit("transfusion_infusion", "ABO incompatibility reaction", withEnc("T80.30X", ep), desc("ABO incompatibility reaction due to transfusion of blood or blood products, unspecified", ep), "ABO incompatibility", EXT.otherMedical);
  }
  if (/air embolism (?:after|following|during) (?:a )?(?:transfusion|infusion|injection)/.test(t)) {
    return hit("transfusion_infusion", "air embolism following infusion/transfusion", withEnc("T80.0XX", ep), desc("Air embolism following infusion, transfusion and therapeutic injection", ep), "air embolism", EXT.otherMedical);
  }
  if (/transfusion reaction|reaction to (?:the )?(?:blood )?transfusion|infusion (?:reaction|complication)/.test(t)) {
    return hit("transfusion_infusion", "complication following infusion/transfusion", withEnc("T80.90X", ep), desc("Unspecified complication following infusion and therapeutic injection", ep), "transfusion/infusion reaction", sterileFailure ? EXT.sterileInfusion : EXT.otherMedical);
  }

  // ---- 7. Anesthesia complication (T88.3) -------------------------------
  if (/malignant hyperthermia/.test(t)) {
    return hit("anesthesia", "malignant hyperthermia due to anesthesia", withEnc("T88.3XX", ep), desc("Malignant hyperthermia due to anesthesia", ep), "malignant hyperthermia", EXT.surgery);
  }

  // ---- 8. Device mechanical complications (T82.1x / T84.0x / T82.7xx) ---
  if (/(?:broken|fractured) (?:internal )?(?:right |left |unsp(?:ecified)? )?(?:hip|knee) (?:prosthesis|replacement|implant)/.test(t)) {
    const joint = /hip/.test(t) ? "hip" : "knee";
    const code =
      joint === "hip"
        ? side === "right" ? "T84.010" : side === "left" ? "T84.011" : "T84.019"
        : side === "right" ? "T84.012" : side === "left" ? "T84.013" : "T84.019";
    const base = `Broken internal ${side !== "unspecified" ? `${side} ` : ""}${joint} prosthesis`;
    return hit("device_mechanical", `broken ${joint} prosthesis`, withEnc(code, ep), desc(base, ep), `broken ${joint} prosthesis`, EXT.orthoDevice);
  }
  if (/(?:dislocated|dislocation of) (?:internal )?(?:right |left |unsp(?:ecified)? )?(?:hip )?(?:prosthesis|replacement|implant)/.test(t)) {
    const code = side === "right" ? "T84.020" : side === "left" ? "T84.021" : "T84.029";
    const base = `Dislocation of internal ${side !== "unspecified" ? `${side} ` : ""}hip prosthesis`;
    return hit("device_mechanical", "dislocated hip prosthesis", withEnc(code, ep), desc(base, ep), "dislocated prosthesis", EXT.orthoDevice);
  }
  if (/pacemaker (?:battery )?failure|battery failure (?:of )?(?:the )?pacemaker/.test(t)) {
    return hit("device_mechanical", "pacemaker battery failure", withEnc("T82.111", ep), desc("Breakdown (mechanical) of cardiac pulse generator (battery)", ep), "pacemaker battery failure", EXT.cardioDevice);
  }
  if (/(?:displaced|displacement of) (?:pacemaker |defibrillator )?lead/.test(t)) {
    return hit("device_mechanical", "displaced pacemaker lead", withEnc("T82.120", ep), desc("Displacement of cardiac electrode", ep), "displaced cardiac lead", EXT.cardioDevice);
  }
  if (/pacemaker malfunction|defibrillator malfunction|cardiac (?:electronic )?device malfunction/.test(t)) {
    return hit("device_mechanical", "cardiac electronic device malfunction", withEnc("T82.119", ep), desc("Breakdown (mechanical) of unspecified cardiac electronic device", ep), "cardiac device malfunction", EXT.cardioDevice);
  }

  // ---- 9. Unspecified fallbacks (T81.9 / T88.9 / device unsp) -----------
  if (/(?:complication|complications) (?:of|following|from) (?:the )?(?:surgery|surgical procedure|procedure|operation)|post-?op(?:erative)? complication|surgical complication/.test(t)) {
    return hit("unspecified", "unspecified complication of procedure", withEnc("T81.9XX", ep), desc("Unspecified complication of procedure", ep), "unspecified surgical complication", EXT.surgery);
  }
  if (/complication (?:of|from) (?:the )?(?:medical care|hospitalization|treatment)|adverse (?:reaction|event) of medical care/.test(t)) {
    return hit("unspecified", "complication of surgical and medical care, unspecified", withEnc("T88.9XX", ep), desc("Complication of surgical and medical care, unspecified", ep), "unspecified medical-care complication", EXT.otherMedical);
  }

  return null;
}

/**
 * True when the code belongs to the T80-T88 complications-of-medical-care
 * block (T86 transplant failure excluded — it has its own sequencing rules).
 */
export function isComplicationCode(code: string): boolean {
  return /^T(80|81|8[2-5]|88)\./.test(code.toUpperCase());
}

/**
 * True when the code is a Y62-Y84 procedural external cause (no 7th char).
 */
export function isProceduralExternalCause(code: string): boolean {
  return /^Y(6[2-9]|7[0-9]|8[0-4])(\.|$)/.test(code.toUpperCase());
}
