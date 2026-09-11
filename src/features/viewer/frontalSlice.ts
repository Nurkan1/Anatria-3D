import * as THREE from "three";

import { SLAB_HALF_THICKNESS } from "./axialSlice";
import type { SliceBasis } from "./axialSlice";

/**
 * The geometry of a frontal section — phase 0, before anything is built on it.
 *
 * # Why this is its own file and not a parameter of the axial one
 *
 * The axial section was stabilised two days ago, after two faults that each lived
 * in exactly this kind of code: a framing race and an orientation drawn upside
 * down. A frontal section is being *measured* here, not shipped, and measuring it
 * must not be able to disturb the path readers use. If the numbers justify it, the
 * two planes are unified properly in a later phase, with tests on both.
 *
 * # The frame, stated once
 *
 * Anterior is +Z (the anterior viewpoint stands at +Z) and the patient's left is
 * `lateralSign`·X. The camera stands in front of the plane and looks back into the
 * body, up the +Y axis. A frontal image is read the way a coronal one always is:
 * superior at the top, the patient's left on the viewer's right.
 */

/**
 * The three depths a measurement takes: a third of the way in from the front, the
 * middle, and a third in from the back.
 *
 * Three rather than one because the cost is not the same through the body. A plane
 * near the front crosses the abdominal wall and the ribs; one through the middle
 * crosses the spine, the great vessels and everything that runs head to foot. The
 * worst of the three is the number that decides.
 */
export function frontalDepths(minZ: number, maxZ: number): number[] {
  const depth = maxZ - minZ;
  if (!(depth > 0)) return [];
  return [maxZ - depth / 3, minZ + depth / 2, minZ + depth / 3];
}

/**
 * Keep only what lies within the slab at this depth.
 *
 * three keeps a fragment where `normal · p + constant > 0`: in front of the back
 * face, and behind the front one.
 */
export function frontalSlabPlanes(at: number, half = SLAB_HALF_THICKNESS): THREE.Plane[] {
  return [
    new THREE.Plane(new THREE.Vector3(0, 0, -1), at + half),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), half - at),
  ];
}

/**
 * Open the body at this depth, keeping everything behind the plane.
 *
 * Behind, because the camera stands in front: what it sees is the body opened at
 * this depth, the surfaces of what lies posterior to the plane — the frontal
 * counterpart of the axial cut, which keeps what is below and looks down on it.
 */
export function frontalCutPlanes(at: number): THREE.Plane[] {
  return [new THREE.Plane(new THREE.Vector3(0, 0, -1), at)];
}

/**
 * The flags that turn this camera's picture the right way round.
 *
 * `paintSlice` reads a `SliceBasis` whose flags were written for the axial camera,
 * which has posterior at the top of its framebuffer and so needs no flip. This
 * camera has superior at the top of its framebuffer, and WebGL hands rows over
 * bottom first — so the rows do need turning for superior to end up at the top,
 * and `down: 1` is what asks the painter for that turn. Left and right are as for
 * the axial camera: its +x is world +X, mirrored only where that is the patient's
 * right.
 *
 * A borrowed meaning, and fine for a measurement. A shipped frontal section gets a
 * basis of its own.
 */
export function frontalPaintFlags(leftSign: 1 | -1): SliceBasis {
  return { right: leftSign, down: 1 };
}
