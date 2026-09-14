/**
 * Shared types for the embedded SNOMED CT coder.
 */

export interface Icd10CmTarget {
  code: string;
  name: string;
}

export interface SnomedConcept {
  /** SNOMED CT concept identifier (numeric string) */
  id: string;
  /** Preferred term (international release) */
  pt: string;
  /** Fully specified name when available (may include the semantic tag) */
  fsn?: string;
  /** Synonyms: official description terms + curated aliases used by the matcher */
  synonyms: string[];
  /** SNOMED semantic tag: disorder | finding | procedure | body structure | organism | product | situation */
  tag: string;
  /** Default coding-role hint when the LLM does not override */
  role: 'primary' | 'secondary' | 'supplemental';
  /** Curated + validated ICD-10-CM map targets (production: refset 60206000) */
  icd10cm: Icd10CmTarget[];
  /** How the build script resolved this concept (provenance) */
  resolvedBy: string;
}

export interface SubsetFile {
  meta: {
    builtAt: string;
    what: string;
    snomedEdition: string;
    icdTarget: string;
    mapRefsetProduction: string;
    license: string;
    conceptCount: number;
    droppedCount: number;
    withIcdMap: number;
  };
  concepts: SnomedConcept[];
}

/** One candidate returned by the lexical matcher. */
export interface Candidate {
  conceptId: string;
  pt: string;
  fsn?: string;
  tag: string;
  synonyms: string[];
  icd10cm: Icd10CmTarget[];
  /** lexical score (unbounded, higher = better) */
  score: number;
  /** normalized confidence 0..1 */
  confidence: number;
  /** which surface form produced the best score */
  matchedOn: string;
  matchedField: 'pt' | 'synonym' | 'fsn';
}

/** A clinical concept extracted from the note + its SNOMED candidates. */
export interface CodedTerm {
  /** LLM-normalized English term used for matching */
  term: string;
  /** verbatim snippet from the source note (any language) */
  original: string;
  category: 'diagnosis' | 'symptom' | 'procedure' | 'medication' | 'organism' | 'other';
  role: 'primary' | 'secondary' | 'supplemental';
  candidates: Candidate[];
  /** conceptId chosen automatically (lexical or LLM tie-break) */
  chosen: string | null;
  /** how the choice was made */
  chosenBy: 'lexical' | 'llm' | 'none';
}

export interface CodingResult {
  results: CodedTerm[];
  meta: {
    model: string;
    llmExtractMs: number;
    matchMs: number;
    disambiguateMs: number;
    disambiguated: number;
    subset: { conceptCount: number; withIcdMap: number; builtAt: string };
  };
}
