import type * as THREE from "three";

/**
 * Which vertebral level the plane is at, in the words a clinician uses.
 *
 * # Why this is the most useful thing the scanner can say
 *
 * A reading is not "1.24 m up the model". Every axial image a doctor has ever
 * discussed was placed by its vertebral level — *at T7*, *at the L4–L5 disc* —
 * because that is the body's own coordinate system, and it is the same on
 * every patient regardless of height. Saying the level turns a picture of a
 * cut into a reading of a level.
 *
 * # Why nothing is said where there is no vertebra
 *
 * It would be easy to name the *nearest* level, and it would be wrong. A plane
 * through the ankle is not "at L5, roughly": it is nowhere near the spine, and
 * a label there would be a confident falsehood in the one place a reader has no
 * way to check it. Below the coccyx and above the atlas, and out in the limbs,
 * this says nothing at all.
 */

/**
 * The level a structure marks, or null if it marks none.
 *
 * Read from the identifier rather than from the Latin, because the identifier
 * already carries it: `vertebra_t8`, `intervertebral_disc_l4_l5`. The Latin
 * spells the number in Roman — *Vertebra thoracis VIII* — and parsing that
 * would be a second, worse route to a fact already in hand.
 *
 * `atlas_c1` and `axis_c2` are named rather than numbered because anatomy names
 * them; they are the two exceptions and they are handled as exceptions.
 */
export function vertebralLevel(organId: string): string | null {
  if (organId === "atlas_c1") return "C1";
  if (organId === "axis_c2") return "C2";
  if (organId === "sacrum") return "S";
  if (organId === "coccyx") return "Co";

  const disc = /^intervertebral_disc_([ctls])(\d{1,2})_([ctls])(\d{1,2})$/.exec(organId);
  if (disc) {
    return `${disc[1]!.toUpperCase()}${disc[2]}–${disc[3]!.toUpperCase()}${disc[4]}`;
  }

  // Anchored on purpose: `vertebral_artery_l` and `vertebral_vein_l` start with
  // the same letters and are not levels.
  const bone = /^vertebra_([ctl])(\d{1,2})$/.exec(organId);
  if (bone) return `${bone[1]!.toUpperCase()}${bone[2]}`;

  return null;
}

/**
 * The level a height falls at, or null if it falls at none.
 *
 * Vertebral boxes overlap — a spinous process reaches down past the body of the
 * vertebra below it — so containment alone can answer with two or three levels
 * at once. The nearest centre settles it, which is also how a person reads a
 * column: the level *this* is, not the levels this touches.
 */
export function levelAt(boxes: Map<string, THREE.Box3>, at: number): string | null {
  let best: string | null = null;
  let nearest = Number.POSITIVE_INFINITY;

  for (const [organId, box] of boxes) {
    const level = vertebralLevel(organId);
    if (!level) continue;
    if (at < box.min.y || at > box.max.y) continue;
    const distance = Math.abs(at - (box.min.y + box.max.y) / 2);
    if (distance < nearest) {
      nearest = distance;
      best = level;
    }
  }
  return best;
}

/**
 * The level the sweep is at now.
 *
 * Published the same way the crossing list is, and recomputed on the same
 * slower tick: it changes when the plane has travelled a centimetre, not when
 * a frame has passed.
 */
export const CURRENT_LEVEL: { value: string | null } = { value: null };
