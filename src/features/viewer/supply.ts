import * as THREE from "three";

import type { AnatomicalSystem } from "@/lib/schemas";

/**
 * Folding an organ's blood supply — or its innervation — into the study set.
 *
 * # The gap this closes
 *
 * The atlas is organised **by system**; anatomy is studied **by territory**.
 * Isolating the heart brings its seventeen parts, because they are its
 * descendants in the hierarchy. It does not bring the coronary arteries: those
 * live under *Systemic arteries*, an entirely different branch. A heart without
 * its coronaries is not what anybody studies, and no amount of walking the tree
 * fixes that — the relationship is spatial, not taxonomic.
 *
 * # Why proximity is the right rule here, and would not be elsewhere
 *
 * Because the atlas **segments vessels anatomically**. There is no single
 * metre-long aorta: there is `Aorta ascendens`, `Arcus aortae`, `Aorta
 * thoracica` and `Aorta abdominalis`, and the middle cerebral artery is split
 * into its M1 and M3 parts. So asking "which vessel segments reach this organ"
 * brings the ascending aorta and the arch to the heart and leaves the abdominal
 * aorta behind — which is the answer an anatomist would give.
 *
 * Had the vessels been modelled as single continuous meshes this approach would
 * be worthless, and a curated table of Latin name stems would have been the only
 * honest option.
 *
 * # What it gets wrong
 *
 * A bounding box is not a shape. A vessel that merely passes close by will be
 * caught along with the ones that serve the organ. That is deliberate rather
 * than hidden: every member of a study set already has its own ✕, so a false
 * positive costs one click, while a false *negative* costs the student
 * something they never learn was missing.
 */

export type SupplyKind = "vascular" | "neural";

/** Which system each request draws from. */
export const SUPPLY_SYSTEM: Record<SupplyKind, AnatomicalSystem> = {
  vascular: "cardiovascular",
  neural: "nervous",
};

/** What to call it in the interface. */
export const SUPPLY_LABEL: Record<SupplyKind, string> = {
  vascular: "vessels",
  neural: "nerves",
};

/**
 * How far beyond the study set a structure may sit and still count as serving
 * it, as a fraction of the set's own largest dimension.
 *
 * Proportional rather than absolute so it means the same thing at every scale:
 * a few millimetres around a heart, a fraction of one around an eye. An
 * absolute margin would be either useless on the small structures or
 * indiscriminate on the large ones.
 */
export const REACH = 0.04;

/**
 * The volume the study set occupies, with that margin already added.
 *
 * `null` when nothing in the set has been measured — which is not the same as
 * an empty answer, and the caller has to tell the two apart: it means the
 * meshes have not arrived, not that there is nothing nearby.
 */
export function studyEnvelope(
  ids: Iterable<string>,
  boxes: Map<string, THREE.Box3>,
): THREE.Box3 | null {
  const envelope = new THREE.Box3();
  let measured = false;
  for (const id of ids) {
    const box = boxes.get(id);
    if (!box) continue;
    envelope.union(box);
    measured = true;
  }
  if (!measured) return null;

  const size = envelope.getSize(new THREE.Vector3());
  return envelope.expandByScalar(Math.max(size.x, size.y, size.z) * REACH);
}

/**
 * The structures that reach the study set.
 *
 * Members of the set itself are never returned: the caller is adding to a set,
 * and a structure already in it is not an addition.
 */
export function collectSupply(
  studyIds: string[],
  candidateIds: Iterable<string>,
  boxes: Map<string, THREE.Box3>,
): string[] {
  const envelope = studyEnvelope(studyIds, boxes);
  if (!envelope) return [];

  const already = new Set(studyIds);
  const found: string[] = [];
  for (const id of candidateIds) {
    if (already.has(id)) continue;
    const box = boxes.get(id);
    if (!box) continue;
    if (box.intersectsBox(envelope)) found.push(id);
  }
  return found;
}

/**
 * Whether a system's meshes have arrived yet.
 *
 * The button that asks for vessels also switches the cardiovascular system on,
 * and the meshes stream in afterwards. Until at least one of them has been
 * measured there is nothing to test against, and answering "none found" then
 * would be a lie the reader has no way to see through.
 */
export function isSystemMeasured(
  candidateIds: Iterable<string>,
  boxes: Map<string, THREE.Box3>,
): boolean {
  for (const id of candidateIds) {
    if (boxes.has(id)) return true;
  }
  return false;
}
