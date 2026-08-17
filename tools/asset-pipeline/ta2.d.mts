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

/** English term, lower-cased, to its TA2 entry. First occurrence wins. */
export function parseTa2(text: string): Map<string, Ta2Term>;

export function slugify(name: string): string;
