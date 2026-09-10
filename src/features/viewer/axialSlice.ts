import * as THREE from "three";

/**
 * The geometry of an axial slice, worked out before anything is drawn.
 *
 * # Why this is a slab and not a plane
 *
 * A plane has no thickness and a renderer draws nothing at all where a surface
 * is exactly edge-on. What reads as a section is a *slab*: everything between
 * two parallel cuts a few millimetres apart, seen from directly above. That is
 * also what a CT slice is, and why one has a thickness printed on it.
 *
 * # What this will never be, and it is better to say so now
 *
 * **The cut surfaces will be open.** Clipping in three.js removes fragments; it
 * does not close the hole it leaves, so a clipped liver is a liver-shaped shell
 * with its inside showing rather than a filled cross-section. Capping needs
 * either a stencil pass or generated cap geometry, and both cost more than the
 * slice itself. Expect an outline, not a radiograph.
 */

/** Half the slab's thickness, in model units. Metres, on this atlas. */
export const SLAB_HALF_THICKNESS = 0.004;

/**
 * The two planes that keep only what lies within the slab.
 *
 * three keeps a fragment where `normal · p + constant > 0`, so the pair reads:
 * below the top cut, and above the bottom one. Getting the sign wrong here
 * shows nothing at all rather than showing the wrong thing, which is a
 * mercifully loud failure.
 */
export function slabPlanes(at: number, half = SLAB_HALF_THICKNESS): THREE.Plane[] {
  return [
    new THREE.Plane(new THREE.Vector3(0, -1, 0), at + half),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), half - at),
  ];
}

/**
 * Where the camera stands to look down at the slab, and how wide it sees.
 *
 * Orthographic, because a perspective view of a section is a section plus a
 * lie: structures further from the lens would come out smaller, and comparing
 * left with right is most of what a section is for.
 *
 * The frame is the body's own width and depth plus a margin, so the same
 * structure sits in the same place in the image at every height — a slice that
 * rescaled itself as the plane travelled would be unreadable as a sequence.
 */
export function sliceFraming(
  bounds: THREE.Box3,
  at: number,
  margin = 1.06,
): { position: THREE.Vector3; target: THREE.Vector3; halfWidth: number; halfDepth: number } {
  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  // Square, from the larger of the two, so nothing is stretched and the image
  // can be a square texture without letterboxing.
  const half = (Math.max(size.x, size.z) / 2) * margin;
  return {
    // Just above the slab rather than far away: an orthographic camera does not
    // care about distance, and staying close keeps the depth range tight.
    position: new THREE.Vector3(centre.x, at + 0.5, centre.z),
    target: new THREE.Vector3(centre.x, at, centre.z),
    halfWidth: half,
    halfDepth: half,
  };
}

/**
 * The up vector that puts the front of the body at the top of the image.
 *
 * Looking straight down, "up" in the picture is a direction in the horizontal
 * plane and has to be chosen. Anterior-up is the convention every axial image a
 * reader has seen uses, and −Z is anterior on this atlas — the same fact
 * `viewDirection` relies on for the anterior viewpoint.
 */
export const SLICE_UP = new THREE.Vector3(0, 0, -1);
