import { useFrame } from "@react-three/fiber";
import { useCallback, useRef } from "react";
import * as THREE from "three";

/**
 * Moving the meshes for the exploded view.
 *
 * # Why this is one loop and not a transform per component
 *
 * The displacement eases in and out, so it changes on every frame while it is
 * travelling. Driving it through React would re-render the scene graph sixty
 * times a second to move some matrices — the same reason the eye rotation and
 * the pathway marker keep their clocks in refs. So each mesh hands itself in
 * once, and a single `useFrame` writes to whichever ones are actually moving.
 *
 * # Why the offset is converted into the parent's space
 *
 * Most structures hang off a group with no transform, where the two spaces are
 * the same. The eye parts do not: they live inside a group that *rotates*, so a
 * world-space displacement added to their local matrices would be turned by the
 * gaze and the exploded parts would swing about as the eye followed the reader.
 * Undoing the parent's rotation is what keeps an exploded eye still.
 *
 * # Why it keeps writing after it has arrived
 *
 * A mesh at rest is left alone entirely, but a *displaced* one is rewritten
 * every frame even once it has settled. Its matrix is also a React prop, and a
 * re-render that reapplied the resting transform would drop the structure back
 * into the body with no way for this loop to notice. Rewriting costs sixteen
 * floats and only happens for structures that are genuinely out of place.
 */

/** One registered structure: the live mesh and where it sits when at rest. */
interface Placed {
  mesh: THREE.Mesh;
  base: THREE.Matrix4;
}

/**
 * Squared distance below which a displacement has arrived. 10⁻⁴ world units is
 * a tenth of a millimetre on a body measured in metres.
 */
const SETTLED = 1e-8;

/** Fraction of the displacement still outstanding one second later. */
const EASING = 0.005;

/** Longest frame the easing will honour, so a stall does not teleport parts. */
const MAX_DELTA = 0.1;

const ZERO = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();

/**
 * @param offsets Where each structure should stand relative to its resting
 *   place. Absence means "at rest" — see `explodeOffsets`.
 * @returns The registration callback to hand to every `OrganMesh`.
 */
export function useExplodeMotion(
  offsets: Map<string, THREE.Vector3>,
): (organId: string, mesh: THREE.Mesh | null, base: THREE.Matrix4) => void {
  const placed = useRef(new Map<string, Placed>());
  /** Where each moving structure is *now*, as opposed to where it is headed. */
  const travelling = useRef(new Map<string, THREE.Vector3>());

  const register = useCallback(
    (organId: string, mesh: THREE.Mesh | null, base: THREE.Matrix4) => {
      if (mesh) {
        placed.current.set(organId, { mesh, base });
        return;
      }
      placed.current.delete(organId);
      // A structure whose system was switched off mid-flight would otherwise
      // keep an entry that nothing can ever settle, and the loop would never
      // return to its idle path.
      travelling.current.delete(organId);
    },
    [],
  );

  useFrame((_, delta) => {
    // The idle case, and the one that has to cost nothing: no structure is
    // displaced and none is on its way back.
    if (offsets.size === 0 && travelling.current.size === 0) return;

    const alpha = 1 - Math.pow(EASING, Math.min(delta, MAX_DELTA));
    /** Inverse of each parent's rotation and scale, computed at most once. */
    const parentBasis = new Map<THREE.Object3D, THREE.Matrix4>();

    const step = (organId: string, target: THREE.Vector3 | undefined) => {
      const entry = placed.current.get(organId);
      // The offsets cover the whole atlas; this loop only owns one mesh file.
      if (!entry) return;

      let current = travelling.current.get(organId);
      if (!current) {
        if (!target) return;
        current = new THREE.Vector3();
        travelling.current.set(organId, current);
      }

      const goal = target ?? ZERO;
      const arrived = current.distanceToSquared(goal) < SETTLED;
      if (arrived) current.copy(goal);
      else current.lerp(goal, alpha);

      let local: THREE.Vector3 = current;
      const parent = entry.mesh.parent;
      if (parent) {
        let basis = parentBasis.get(parent);
        if (!basis) {
          // Inverting the whole matrix and then dropping its translation leaves
          // exactly the inverse of the rotation and scale, which is what a
          // displacement — a direction and a length, not a point — needs.
          basis = new THREE.Matrix4()
            .copy(parent.matrixWorld)
            .invert()
            .setPosition(0, 0, 0);
          parentBasis.set(parent, basis);
        }
        local = scratchOffset.copy(current).applyMatrix4(basis);
      }

      scratchPosition.setFromMatrixPosition(entry.base).add(local);
      entry.mesh.matrix.copy(entry.base).setPosition(scratchPosition);
      entry.mesh.matrixWorldNeedsUpdate = true;

      if (arrived && !target) travelling.current.delete(organId);
    };

    for (const [organId, target] of offsets) step(organId, target);
    // Everything on its way home. Deleting the current key while iterating a
    // Map is defined behaviour, which is what lets `step` retire an entry.
    for (const organId of travelling.current.keys()) {
      if (!offsets.has(organId)) step(organId, undefined);
    }
  });

  return register;
}
