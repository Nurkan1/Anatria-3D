import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import { clampGaze, type EyeGroup } from "./eyes";

/**
 * One eyeball, turning in its orbit to follow the reader.
 *
 * # Why this is a group and not a per-mesh transform
 *
 * An eye is eight separate structures in the atlas — sclera, cornea, iris,
 * lens, retina and the humours — and they have to turn together about one
 * point. Rotating each mesh's own matrix would mean recomputing eight matrices
 * a frame and keeping their shared pivot in sync by hand. A group at the
 * globe's centre does it once, for free, and the children never learn about it.
 *
 * # Why the rotation is imperative
 *
 * It changes every frame. Routing that through React state would re-render the
 * subtree sixty times a second to move one object, which is the same reason the
 * pathway marker keeps its clock in a ref.
 */

/** How far the globe may turn before it would be rotating inside the skull. */
const MAX_GAZE_RADIANS = (35 * Math.PI) / 180;

/**
 * How quickly the gaze catches up, per second.
 *
 * Slow enough to read as a look rather than a snap, fast enough that the eye is
 * not still chasing a camera that stopped moving a second ago.
 */
const FOLLOW_RATE = 6;

export function EyeGlobe({
  eye,
  enabled,
  children,
}: {
  eye: EyeGroup;
  enabled: boolean;
  children: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const wanted = useRef(new THREE.Quaternion());
  const direction = useRef(new THREE.Vector3());
  const rest = useRef(new THREE.Quaternion());

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;

    if (enabled) {
      direction.current.copy(camera.position).sub(eye.centre);
      if (direction.current.lengthSq() < 1e-12) return;

      const gaze = clampGaze(eye.restForward, direction.current, MAX_GAZE_RADIANS);
      // The rotation that carries the eye's own resting direction onto the one
      // it should be looking along. Derived from the model rather than assumed,
      // so it does not depend on which axis the export calls forward.
      wanted.current.setFromUnitVectors(eye.restForward, gaze);
    } else {
      wanted.current.copy(rest.current);
    }

    // Frame-rate independent: without the delta term the eye would track
    // faster on a 144 Hz display than on a 60 Hz one.
    node.quaternion.slerp(wanted.current, 1 - Math.exp(-FOLLOW_RATE * delta));
  });

  return (
    <group ref={group} position={eye.centre}>
      {children}
    </group>
  );
}
