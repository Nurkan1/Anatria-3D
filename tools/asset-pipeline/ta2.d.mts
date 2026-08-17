/**
 * Types for `ta2.mjs`.
 *
 * The asset pipeline is plain ESM, run by node and never bundled — it has no
 * business being TypeScript. But the test suite imports it, because the
 * nomenclature table is the one part of this project where a typo becomes a
 * false statement about anatomy rather than a crash, and it deserves to be
 * covered. This file is what lets `tsc --noEmit` see across that boundary.
 */

export interface Ta2Term {
  /** The English term, as TA2 spells it. */
  en: string;
  /** The Latin term. Empty for the handful of TA2 rows that carry none. */
  la: string;
}

/** A replacement for one field of one row, keyed by English as the file spells it. */
export type Ta2Correction = Partial<Ta2Term>;

/** Typographical faults in the vendored file, against terms TA2 published. */
export const TA2_CORRECTIONS: Record<string, Ta2Correction>;

/** Faults in the rows the vendored file added past the end of TA2. */
export const ADDED_TERM_CORRECTIONS: Record<string, Ta2Correction>;

/** Added-term rows left uncorrected, mapped to what is wrong with each. */
export const ADDED_TERM_OPEN_QUESTIONS: Record<string, string>;

/** English term, lower-cased, to its TA2 entry. First occurrence wins. */
export function parseTa2(text: string): Map<string, Ta2Term>;

export function slugify(name: string): string;
