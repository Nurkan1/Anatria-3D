import * as THREE from "three";

/**
 * Exploded view: push the parts of a group apart so you can see between them.
 *
 * # What it is for
 *
 * Isolating the heart shows seventeen parts stacked inside one another, and the
 * outermost ones hide the rest. Ghosting answers that by making tissue
 * see-through; exploding answers it by *moving the tissue out of the way*, which
 * is the answer whenever the reader needs to look at a surface rather than
 * through it — the articular facet of a vertebra, the inside of a valve cusp,
 * the face where two skull bones meet.
 *
 * # The rule: scale the arrangement about its own centre
 *
 * Every member moves along the line from the group's centre to its own centre,
 * by `factor` times the distance it already stood. Nothing else. That has three
 * properties worth the simplicity:
 *
 *   - **It is reversible and continuous.** Factor 0 is the anatomy, exactly.
 *     Sliding up never re-orders anything, so the reader keeps their bearings.
 *   - **Nothing is invented.** There is no chosen axis and no arbitrary spacing
 *     constant; the layout comes entirely from where the structures actually
 *     are.
 *   - **It cannot leave a part in the wrong place relative to another.** Every
 *     distance grows by the same ratio, so what was medial stays medial.
 *
 * The honest limitation of the same rule: **concentric structures do not
 * separate**. The tunics of the eyeball share a centre, so scaling about that
 * centre moves them nowhere. That case is what per-tissue transparency is for,
 * and the atlas already ghosts the cornea and the vitreous by default. An
 * exploded view separates things that are *arranged around* a centre — bones of
 * the skull, chambers of the heart, vertebrae, the carpals — and that is the
 * shape of nearly every group a student wants to take apart.
 */

/**
 * What the keyboard steps through. The panel has a continuous slider; the key
 * is for the reader who wants to knock it apart and back without aiming.
 */
export const EXPLODE_STOPS = [0, 0.35, 0.9, 1.8] as const;

/** The far end of the slider. Past this a body no longer fits any framing. */
export const MAX_EXPLODE = 2;

/** The next stop above the current amount, wrapping back to nothing. */
export function nextExplodeStop(current: number): number {
  // Compared with a tolerance so a slider left at 0.9000001 still advances
  // rather than returning the stop it is already sitting on.
  const next = EXPLODE_STOPS.find((stop) => stop > current + 1e-6);
  return next ?? EXPLODE_STOPS[0]!;
}

/** Which group the explosion applies to. */
export type ExplodeScope = "selection" | "region" | "everything";

/**
 * What comes apart.
 *
 * The reader has already said what they are working on, twice over, and the
 * order below reads their answers from most specific to least:
 *
 *   **The selection**, when it holds more than one structure — an explicit
 *   hand-built set is the least ambiguous statement of intent there is.
 *   **The isolated region** otherwise — double-clicking the heart is how you say
 *   "the heart and its parts", and exploding it is the obvious next move.
 *   **Everything loaded** when neither applies, which is the whole-body view.
 *
 * A single selected structure falls through deliberately: one thing has no parts
 * to separate, and exploding it alone would do nothing while looking broken.
 */
export function explodeScope(state: {
  selectedOrganIds: string[];
  isolatedOrganIds: string[] | null;
}): ExplodeScope {
  if (state.selectedOrganIds.length >= 2) return "selection";
  if (state.isolatedOrganIds !== null && state.isolatedOrganIds.length >= 2) return "region";
  return "everything";
}

/** The members of the exploding group, resolved against what is loaded. */
export function explodeMembers(
  state: { selectedOrganIds: string[]; isolatedOrganIds: string[] | null },
  loaded: Iterable<string>,
): string[] {
  switch (explodeScope(state)) {
    case "selection":
      return state.selectedOrganIds;
    case "region":
      return state.isolatedOrganIds ?? [];
    case "everything":
      return [...loaded];
  }
}

/**
 * The point everything moves away from.
 *
 * The centre of the box round the members' centres, not their mean. A mean is
 * dragged towards whichever region is most finely subdivided — the skull has
 * dozens of small bones against a handful of large ones, so a mean pivot sits
 * inside the face and the explosion comes out lopsided. A box centre depends
 * only on the extremes, which is what "the middle of this group" means to
 * someone looking at it.
 */
export function explodePivot(
  ids: Iterable<string>,
  centres: Map<string, THREE.Vector3>,
): THREE.Vector3 | null {
  const box = new THREE.Box3();
  let found = false;
  for (const id of ids) {
    const centre = centres.get(id);
    if (!centre) continue;
    box.expandByPoint(centre);
    found = true;
  }
  return found ? box.getCenter(new THREE.Vector3()) : null;
}

/**
 * How far each member moves, in world units.
 *
 * Structures with no measured centre and structures sitting exactly on the pivot
 * are both left out rather than given a zero vector: absence is what every
 * consumer already treats as "this one has not moved", and an entry that means
 * the same thing would only cost them a lookup and a copy.
 */
export function explodeOffsets(
  ids: Iterable<string>,
  centres: Map<string, THREE.Vector3>,
  factor: number,
): Map<string, THREE.Vector3> {
  const offsets = new Map<string, THREE.Vector3>();
  if (!Number.isFinite(factor) || factor <= 0) return offsets;

  const members = [...ids];
  const pivot = explodePivot(members, centres);
  if (!pivot) return offsets;

  for (const id of members) {
    const centre = centres.get(id);
    if (!centre) continue;
    const offset = centre.clone().sub(pivot).multiplyScalar(factor);
    if (offset.lengthSq() === 0) continue;
    offsets.set(id, offset);
  }
  return offsets;
}
