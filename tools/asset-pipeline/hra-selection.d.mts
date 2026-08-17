/**
 * Types for `hra-selection.mjs` — see the note in `ta2.d.mts` for why the
 * pipeline has declaration files at all.
 */

import type { AnatomicalSystem } from "../../src/lib/schemas";

export interface HraSource {
  version: string;
  url: string;
  metadata: string;
  license: string;
  licenseUrl: string;
}

export interface HraStructure {
  /** The glTF node name in the source. Unique, and the key for everything. */
  node: string;
  /** The organ_id in the female manifest. */
  id: string;
  /** A Terminologia Anatomica 2 English term, verified at build time. */
  term: string;
  /**
   * Distinguishes structures the HRA splits and TA2 does not — each hip bone
   * into compact and spongy tissue, the bladder fundus into dome and base.
   */
  qualifier?: string;
  side: "left" | "right" | null;
  /** Anatomical ancestry, outermost first. */
  path: string[];
}

export const SOURCE: HraSource;
/** Node name to the reason TA2 does not list it. */
export const NOT_IN_TA2: Record<string, string>;
/** Node name to a description of how the source contradicts itself there. */
export const KNOWN_SOURCE_ERRATA: Record<string, string>;
export const STRUCTURES: HraStructure[];
export const SYSTEM_OF: Map<string, AnatomicalSystem>;
