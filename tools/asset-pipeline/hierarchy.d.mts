/**
 * Types for `hierarchy.mjs`.
 *
 * The asset pipeline is plain ESM and never bundled, but the test suite reads
 * this module: the nervous hierarchy is a claim about anatomy, and a claim
 * about anatomy in an atlas deserves to be asserted rather than trusted.
 */

/** One structure as the manifest holds it, in the fields this module reads. */
export interface PlacedOrgan {
  organ_id: string;
  ta2_latin: string;
  system: string;
  path: string[];
  [key: string]: unknown;
}

/** Where each misfiled nervous structure belongs, by its TA2 Latin term. */
export const NERVOUS_PATHS: Record<string, string[]>;

/** Visceral groups the source offers and this pipeline declines, with the reason. */
export const DECLINED_VISCERAL_GROUPS: Record<string, string>;

/** The blend snapshot in `vendor/inspect.json`, in the fields this module reads. */
export interface BlendSnapshot {
  objects: { name: string; collections: string[] }[];
  collections: { name: string; path: string }[];
}

/**
 * Give back the visceral groups whose membership is complete.
 *
 * Only ever adds a path to a structure that has none.
 */
export function recoverVisceralPaths<T extends PlacedOrgan>(
  organs: T[],
  inspect: BlendSnapshot,
): { organs: T[]; recovered: number };

/**
 * Refile the structures Z-Anatomy's collection nesting places wrongly.
 *
 * Throws if an entry in `NERVOUS_PATHS` matches nothing, which means it is
 * stale and should be deleted rather than left looking authoritative.
 */
export function repairHierarchy<T extends PlacedOrgan>(
  organs: T[],
): { organs: T[]; corrected: number; propagated: number };
