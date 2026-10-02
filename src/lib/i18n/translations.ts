/**
 * Bilingual (English / Arabic) UI strings.
 * Lightweight inline i18n — no next-intl complexity needed for two languages.
 * English is the DEFAULT locale (since v0.3).
 */

export type Locale = "en";

export const LOCALE_STORAGE_KEY = "icd10_locale_v2";

export const translations = {
  en: {
    dir: "ltr" as const,
    app_title: "ICD-10-CM AI Coding Agent",
    app_subtitle: "Convert clinical text into ICD-10-CM codes ranked dynamically (Primary / Secondary / Supplemental)",
    language_toggle: "العربية",
    model_label: "LLM Model",
    model_help: "Choose the model used for coding. Auto tries free online models then falls back to the Smart Offline Coder.",
    input_label: "Clinical Note",
    input_placeholder: "Type or paste the clinical note here. Example: Patient came to ER with cat scratch on his right lower leg today, controlled type 2 diabetes.",
    sample_cases: "Sample cases",
    analyze_button: "Analyze & Code",
    analyzing: "Analyzing…",
    clear_button: "Clear",
    results_title: "Coding Results",
    no_results: "Enter a clinical note and click Analyze to see results here.",
    primary: "Principal Diagnosis",
    secondary: "Secondary Diagnoses",
    secondary_hint: "All co-existing conditions that affect care during this encounter — chronic AND acute (per UHDDS / ICD-10-CM Official Guidelines Section III). Examples: diabetes, hypertension, CKD, anemia, dehydration.",
    tertiary: "Supplemental Codes",
    tertiary_hint: "External cause codes (V/W/X/Y) describing HOW an injury happened, place of occurrence, activity, and other supporting codes. Per Chapter 20 rules these are reported LAST — never as the principal diagnosis.",
    confidence: "Confidence",
    rationale: "Clinical Rationale",
    laterality: "Laterality",
    acuity: "Acuity",
    seventh_char: "7th Char",
    validation_title: "Validation Alerts",
    no_validation: "No alerts — all codes passed validation.",
    errors: "errors",
    warnings: "warnings",
    info: "info",
    rag_context_title: "RAG Context (retrieved codes)",
    rag_empty: "No codes retrieved from RAG.",
    nlm_status_ok: "NLM API: online",
    nlm_status_fail: "NLM API: unreachable — using local DB",
    export_button: "Export PDF",
    export_help: "Open the print dialog then choose \"Save as PDF\"",
    latency: "Latency",
    ms: "ms",
    entities_title: "Extracted Clinical Entities (NER)",
    raw_json: "Raw JSON",
    summary: "Summary",
    level_primary: "Primary",
    level_secondary: "Secondary",
    level_tertiary: "Supplemental",
    not_applicable: "N/A",
    right: "Right",
    left: "Left",
    bilateral: "Bilateral",
    unspecified: "Unspecified",
    acute: "Acute",
    chronic: "Chronic",
    acute_on_chronic: "Acute on chronic",
    char_a: "A — initial encounter",
    char_b: "B — initial, open fx (Gustilo I/II)",
    char_c: "C — initial, open fx (Gustilo III)",
    char_d: "D — subsequent",
    char_s: "S — sequela",
    char_g: "G — delayed healing",
    char_k: "K — nonunion",
    char_p: "P — malunion",
    char_not_required: "not required",
    char_missing: "MISSING (!)",
    footer: "Experimental coding agent for educational use — do not use for diagnosis or billing without human review.",
    snomed_attribution: "SNOMED CT® is licensed material — embedded here as a validated 598-concept demo subset; production deployment requires an appropriate SNOMED CT license (SNOMED International affiliate or US NLM UMLS).",
    snomed_panel_title: "SNOMED CT Concepts",
    snomed_panel_desc: "Concepts autonomously mapped by the embedded SNOMED CT® engine (598-concept validated demo subset).",
    snomed_concept_id: "Concept ID",
    snomed_pt: "Preferred Term",
    snomed_no_auto: "No auto-chosen concept — review candidates",
    snomed_review: "review",
    snomed_map_label: "ICD-10-CM map",
    snomed_map_mismatch: "Cross-check: a chosen concept maps to ICD-10-CM codes not present in the ICD-10 coding - review for a possible missed code.",
    history_title: "History",
    history_empty: "No saved analyses yet - every analyze is autosaved here on this machine.",
    history_restore: "Restore",
    history_delete: "Delete",
    history_clear: "Clear all",
    copy_json: "Copy JSON",
    copied: "Copied",
    copy_code: "Copy code",
    search_title: "ICD-10-CM Lookup",
    search_placeholder: "Search 74,000+ codes — e.g. \"epigastric pain\" or \"S82.2\"…",
    search_no_results: "No matching codes.",
    search_full_db_on: "Full offline DB",
    search_curated_only: "Curated DB",
    search_hint_full: "Searching the full ICD-10-CM database offline.",
    search_hint_curated: "Full database not loaded yet — searching the curated set.",
    search_hint_nlm: "NLM cross-check when online.",
    offline_db_title: "Offline Database",
    offline_db_desc: "The complete ICD-10-CM code set (~74,000 codes) stored in your browser. Works fully offline.",
    offline_db_status: "Status",
    offline_db_ready: "Ready",
    offline_db_loading: "Loading…",
    offline_db_error: "Error",
    offline_db_not_loaded: "Not loaded",
    offline_db_codes: "Codes",
    offline_db_source: "Source",
    offline_db_source_bundled: "Bundled snapshot (this release)",
    offline_db_source_live: "Live NLM refresh",
    offline_db_version: "Data version",
    offline_db_load_btn: "Load full database",
    offline_db_refresh_btn: "Refresh from NLM",
    offline_db_refresh_hint: "Pull the latest code set directly from the NLM Clinical Tables API (~1–2 min).",
    offline_db_refreshing: "Downloading from NLM…",
    offline_db_clear: "Clear",
    offline_db_footnote: "Refresh pulls all codes from NLM and stores them in your browser — useful when the annual code update ships before a new app release.",
    offline_db_billable_short: "billable",
    code_verified: "Verified in ICD-10-CM",
    code_category_only: "Category code — needs full specificity",
    code_not_found: "Not found in ICD-10-CM — verify manually",
    welcome: "Welcome",
    login_title: "Sign In",
    login_subtitle: "Enter your credentials to access the coding agent",
    username_label: "Username",
    password_label: "Password",
    login_button: "Sign In",
    logging_in: "Signing in…",
    logout_button: "Sign Out",
    login_error: "Invalid credentials. Please try again.",
    demo_hint: "Demo: username omar / password omar123",
    signed_in_as: "Current user",
    session_protected: "This page is protected. Sign in to continue.",
    // --- Theme & display settings ---
    appearance: "Appearance",
    theme_label: "Color theme",
    theme_emerald: "Emerald (default)",
    theme_ocean: "Ocean",
    theme_violet: "Violet",
    theme_rose: "Rose",
    theme_amber: "Amber",
    theme_mono: "Slate Mono",
    mode_light: "Light",
    mode_dark: "Dark",
    mode_system: "System",
    font_size_label: "Text size",
    font_small: "Small",
    font_normal: "Normal",
    font_large: "Large",
    font_xl: "Extra large",
    appearance_reset: "Reset",
    // --- Mobile ---
    codes_summary: "Codes",
    copy_all_codes: "Copy all codes",
    offline_ready: "Works offline",
    error_title: "Analysis failed",
    try_prefix: "Try:",
    try_auto: "Switch to Auto (online + offline fallback)",
    try_offline: "Switch to Smart Offline Coder",
    try_retry: "Retry",
    how_get_keys: "How to get free API keys?",
    free_badge: "FREE",
    ready_badge: "ready",
  },
} as const;

export type TranslationKey = keyof typeof translations["en"];

export function t(locale: Locale, key: TranslationKey): string {
  return translations[locale][key];
}

export function detectDefaultLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === "en") return saved;
  } catch {
    // localStorage may be blocked — ignore
  }
  return "en";
}

export const SAMPLE_CASES: { label_en: string; text: string }[] = [
  {
    label_en: "Cat scratch + DM2",
    text: "Patient came to ER with cat scratch on his right lower leg today, controlled type 2 diabetes.",
  },
  {
    label_en: "DM2 foot ulcer",
    text: "55-year-old male with long-standing type 2 diabetes presents with a non-healing ulcer on the right heel for 6 weeks. No gangrene. Hypertension well-controlled on lisinopril.",
  },
  {
    label_en: "COPD exacerbation",
    text: "62-year-old female with COPD presenting with increased dyspnea, purulent sputum, and wheeze for 3 days. No fever. Home nebulizer ineffective.",
  },
  {
    label_en: "Dog bite, left hand",
    text: "Patient presents with dog bite on left hand sustained this morning. Wound is clean, no tendon involvement. Td vaccine up to date.",
  },
  {
    label_en: "HTN + CKD follow-up",
    text: "Follow-up visit for chronic kidney disease stage 3 and essential hypertension. Creatinine stable. No edema. Patient also has hyperlipidemia.",
  },
  {
    label_en: "Fall + fractures (bilateral OA, anemia)",
    text: "78-year-old woman tripped on the stairs at home and fell onto her left side this morning. Left wrist pain and deformity, X-ray shows distal radius fracture. Also known bilateral knee osteoarthritis and chronic anemia. No head strike, no loss of consciousness.",
  },
  {
    label_en: "Open fracture (Gustilo II)",
    text: "41-year-old construction worker presents after falling from a ladder with an open fracture of the right tibia, Gustilo type II. Wound 4 cm, no vascular deficit. Tetanus given.",
  },
  {
    label_en: "Rule-out + history coding",
    text: "68-year-old man for medication review. History of stroke with no residual deficits, family history of diabetes. Cough for 3 days, probable pneumonia. Denies fever. On aspirin.",
  },
];

