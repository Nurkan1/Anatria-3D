import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { SHARED_SCAN } from "./scanBand";

/**
 * The ring the sweep appears to come from.
 *
 * # Why a ring above a standing body, and not a gurney
 *
 * The obvious staging was a body laid on a table, and it cost more than it
 * looked. Laying the body down means either rotating the scene root — which
 * moves the ground under picking, labels, clipping planes, `orientView` and
 * every bounds calculation that assumes up is +Y — or faking it with the
 * camera, which falls apart the moment the reader orbits, and orbiting is the
 * point.
 *
 * A ring around a standing body has neither problem. Nothing rotates, the sweep
 * axis stays Y, and it reads correctly from every angle, which a table seen
 * from below does not.
 *
 * # It is not decoration, it is the explanation
 *
 * The ring rides at exactly the height the band is lighting, because they are
 * driven by the same shared uniform. That is the whole reason it earns its
 * draw calls: without it the band is a glow with no cause, and with it the
 * reader can see what is doing the reading and where it has got to.
 *
 * # What it costs
 *
 * Three meshes and no state. The torus and its inner edge are ordinary opaque
 * geometry. The disc is additive and deliberately so: **additive blending is
 * order-independent**, so it needs no correct sort against the thousands of
 * transparent structures underneath it — which is precisely why the emissive
 * plane rejected in phase 0 was the wrong shape for this scene and this is not.
 */
export function ScanRing({ bounds }: { bounds: THREE.Box3 | null }) {
  const ring = useRef<THREE.Group>(null);

  const shape = useMemo(() => {
    if (!bounds || bounds.isEmpty()) return null;
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    // Wide enough to clear the fingertips of an arm at rest, so the ring never
    // appears to pass through the body it is reading.
    const radius = Math.max(size.x, size.z) * 0.72;
    return { radius, tube: radius * 0.055, x: centre.x, z: centre.z };
  }, [bounds]);

  useFrame(() => {
    if (ring.current) ring.current.position.y = SHARED_SCAN.value;
  });

  if (!shape) return null;

  return (
    <group ref={ring} position={[shape.x, 0, shape.z]}>
      {/* The body of the ring. Lit like the rest of the scene rather than
          emissive, so it reads as an object in the room and not as a light. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[shape.radius, shape.tube, 12, 96]} />
        <meshStandardMaterial color="#243244" roughness={0.35} metalness={0.6} />
      </mesh>

      {/* The emitting edge, inside the ring and facing the body. This is the
          part that is meant to look switched on. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[shape.radius - shape.tube, shape.tube * 0.35, 8, 96]} />
        <meshStandardMaterial
          color="#0a2a33"
          emissive="#1ae0ff"
          emissiveIntensity={2.4}
          roughness={0.2}
        />
      </mesh>

      {/* The wash of light across the plane the ring is reading. Additive and
          depth-writing disabled: it adds light to whatever is behind it and
          never occludes, so it cannot produce the sorting artefacts a blended
          plane would in a body made of thousands of transparent shells. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[shape.radius - shape.tube, 64]} />
        <meshBasicMaterial
          color="#1ae0ff"
          transparent
          opacity={0.06}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
