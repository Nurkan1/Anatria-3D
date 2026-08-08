import * as THREE from "three";

import type { ManifestOrgan } from "@/lib/schemas";

/**
 * Which structures make up an eyeball, and how it turns.
 *
 * # Why the membership is a list
 *
 * Everywhere else in this app a group is read from the atlas's own hierarchy.
 * Not here: the eye structures carry an empty `path`, so Z-Anatomy has no
 * "eyeball" collection to read. The alternative to declaring it is guessing
 * from names at render time, which is the same list with the seams showing.
 *
 * # The test for membership
 *
 * Not "is it part of the eye" but "is it *inside the globe*". Everything within
 * the sclera turns as one body; everything anchored to the orbit does not, even
 * when it is unmistakably part of the visual apparatus.
 *
 * Out, therefore: the extraocular muscles, the optic nerve, the ciliary and
 * central retinal arteries, and the suspensory ligament of the eyeball —
 * Lockwood's hammock, slung *under* the globe from the sheaths of the recti and
 * anchored to the orbital walls. Each attaches to the globe at one end and to
 * the orbit at the other, so rotating them rigidly would swing that far end
 * through the skull. An eye that turns while they stay put is anatomically
 * incomplete; one that drags its orbital anchors around is wrong.
 *
 * In: the zonular fibres, which read as an orbital structure from the name and
 * are not — the zonule of Zinn runs from the ciliary body to the lens, both
 * inside the globe, and it is what tore free of the rotation in the first
 * build of this feature.
 */
const EYE_PARTS = [
  "sclera",
  "cornea",
  "iris",
  "lens",
  "retina",
  "vitreous_body",
  "zonular_fibres",
  "anterior_chamber_of_eyeball",
  "anterior_segment_of_eyeball",
  "posterior_segment_of_eyeball",
] as const;

/** The globe itself — its bounding box is the eye's, so its centre is the pivot. */
const GLOBE = "sclera";

/** The front of the eye, used to work out which way it is looking at rest. */
const FRONT = "cornea";

export type EyeSide = "l" | "r";

/** `sclera_l` -> `{ part: "sclera", side: "l" }`, and nothing else matches. */
export function eyePart(organId: string): { part: string; side: EyeSide } | null {
  for (const part of EYE_PARTS) {
    if (organId === `${part}_l`) return { part, side: "l" };
    if (organId === `${part}_r`) return { part, side: "r" };
  }
  return null;
}

export function isEyePart(organ: ManifestOrgan): boolean {
  return eyePart(organ.organ_id) !== null;
}

export interface EyeGroup {
  side: EyeSide;
  /** World-space centre of the globe: what it rotates about. */
  centre: THREE.Vector3;
  /**
   * The direction the eye faces when it is not tracking anything.
   *
   * Measured from the globe's centre to the cornea's, rather than assumed to be
   * some axis of the model. Which way is "forward" depends on how the atlas was
   * exported, and the cornea is at the front of an eye in every export there
   * could ever be.
   */
  restForward: THREE.Vector3;
  organs: ManifestOrgan[];
}

/**
 * Assemble the eyes from the structures in one mesh file.
 *
 * Returns nothing for an eye missing its sclera or its cornea — without those
 * two there is no pivot and no rest direction, and a guess at either would show
 * up as an eye that stares somewhere its owner is not.
 */
export function buildEyeGroups(
  organs: ManifestOrgan[],
  centres: Map<string, THREE.Vector3>,
): EyeGroup[] {
  const sides = new Map<EyeSide, ManifestOrgan[]>();
  for (const organ of organs) {
    const match = eyePart(organ.organ_id);
    if (!match) continue;
    const list = sides.get(match.side) ?? [];
    list.push(organ);
    sides.set(match.side, list);
  }

  const groups: EyeGroup[] = [];
  for (const [side, members] of sides) {
    const centre = centres.get(`${GLOBE}_${side}`);
    const front = centres.get(`${FRONT}_${side}`);
    if (!centre || !front) continue;

    const restForward = front.clone().sub(centre);
    if (restForward.lengthSq() < 1e-12) continue;

    groups.push({
      side,
      centre: centre.clone(),
      restForward: restForward.normalize(),
      organs: members,
    });
  }
  return groups.sort((a, b) => a.side.localeCompare(b.side));
}

/**
 * Where the eye may look, given where it would like to.
 *
 * A real eye has about 45° of travel in its orbit before the head has to turn.
 * Without a limit, a camera swung behind the skull produces an eye rotated
 * backwards inside its socket — which is not "looking at you", it is a horror
 * film. Clamped, the gaze reaches its limit and stays there, which is what a
 * person does too.
 *
 * Returns a unit vector: `target` when it is already within reach, otherwise
 * the closest direction on the cone around `rest`.
 */
export function clampGaze(
  rest: THREE.Vector3,
  target: THREE.Vector3,
  maxRadians: number,
): THREE.Vector3 {
  const wanted = target.clone().normalize();
  const angle = rest.angleTo(wanted);
  if (angle <= maxRadians) return wanted;

  const axis = new THREE.Vector3().crossVectors(rest, wanted);
  if (axis.lengthSq() < 1e-12) {
    // Exactly opposite: every rotation axis is equally valid, so the cross
    // product is degenerate. Any perpendicular gives a defined answer instead
    // of a NaN quaternion that would make the eye vanish.
    axis.set(rest.y, -rest.x, 0);
    if (axis.lengthSq() < 1e-12) axis.set(0, rest.z, -rest.y);
  }
  return rest.clone().applyAxisAngle(axis.normalize(), maxRadians).normalize();
}
