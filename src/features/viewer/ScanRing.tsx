import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
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
 * driven by the same shared uniform. Without it the band is a glow with no
 * cause; with it the reader can see what is doing the reading and where it has
 * got to.
 *
 * # The emitters are instanced, and the radii do not touch
 *
 * Twenty-four emitter blocks are one `InstancedMesh` and therefore one draw
 * call, not twenty-four. That is what lets the ring look like an instrument
 * rather than a hoop without costing anything.
 *
 * **Every radius here is deliberately disjoint.** The first version overlapped
 * the inner light ring with the shell — spans of `[r-1.35t, r-0.65t]` and
 * `[r-t, r+t]` — and the two surfaces fought over the depth test along the
 * intersection. The symptom was white speckles scattered around the ring, which
 * reads as a texture problem and is not one. Concentric geometry that shares
 * space z-fights; keep the bands apart and it cannot.
 *
 * # What it costs
 *
 * Four draw calls. The shell and the emitters are ordinary opaque geometry. The
 * wash across the reading plane is additive with depth writing off, which is
 * why it is safe where the emissive plane rejected in phase 0 was not:
 * **additive blending is order-independent**, so it needs no correct sort
 * against the thousands of transparent shells underneath it.
 */

/** Emitter blocks around the inner face. One instanced draw call, not 24. */
const EMITTERS = 24;

/** Slow enough to read as a machine working, not as something spinning. */
const TURNS_PER_SECOND = 0.04;

export function ScanRing({ bounds }: { bounds: THREE.Box3 | null }) {
  const ring = useRef<THREE.Group>(null);
  const emitters = useRef<THREE.InstancedMesh>(null);

  const shape = useMemo(() => {
    if (!bounds || bounds.isEmpty()) return null;
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    // Wide enough to clear the fingertips of an arm at rest, so the ring never
    // appears to pass through the body it is reading.
    const radius = Math.max(size.x, size.z) * 0.72;
    const tube = radius * 0.035;
    return {
      x: centre.x,
      z: centre.z,
      radius,
      tube,
      // Three disjoint bands, outermost first. The shell occupies
      // [radius-tube, radius+tube]; nothing else may enter that span.
      emitterRadius: radius - tube * 2.6,
      lightRadius: radius - tube * 4.4,
      emitter: tube * 0.9,
    };
  }, [bounds]);

  useLayoutEffect(() => {
    const mesh = emitters.current;
    if (!mesh || !shape) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Euler();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < EMITTERS; i++) {
      const angle = (i / EMITTERS) * Math.PI * 2;
      position.set(Math.cos(angle) * shape.emitterRadius, 0, Math.sin(angle) * shape.emitterRadius);
      // Each block faces the axis, so the lit face is the one turned inwards
      // towards the body rather than out at the room.
      rotation.set(0, -angle, 0);
      matrix.compose(position, quaternion.setFromEuler(rotation), scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [shape]);

  useFrame((_, delta) => {
    const group = ring.current;
    if (!group) return;
    group.position.y = SHARED_SCAN.value;
    group.rotation.y += delta * Math.PI * 2 * TURNS_PER_SECOND;
  });

  if (!shape) return null;

  return (
    <group ref={ring} position={[shape.x, 0, shape.z]}>
      {/* The shell. Lit like the rest of the scene rather than emissive, so it
          reads as an object in the room and not as a light. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[shape.radius, shape.tube, 10, 96]} />
        <meshStandardMaterial color="#1b2735" roughness={0.3} metalness={0.75} />
      </mesh>

      {/* The emitter array: what makes it read as an instrument. */}
      <instancedMesh ref={emitters} args={[undefined, undefined, EMITTERS]}>
        <boxGeometry args={[shape.emitter * 0.55, shape.emitter * 0.7, shape.emitter * 2.2]} />
        <meshStandardMaterial
          color="#0b1c24"
          emissive="#1ae0ff"
          emissiveIntensity={2.2}
          roughness={0.25}
          metalness={0.4}
        />
      </instancedMesh>

      {/* A thin bright line inboard of the emitters, clear of both other
          radii. This is the edge that is meant to look switched on. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[shape.lightRadius, shape.tube * 0.22, 6, 96]} />
        <meshBasicMaterial color="#8ff4ff" toneMapped={false} />
      </mesh>

      {/* The wash of light across the plane being read. Additive, and never
          occluding — see the note above on why this shape is safe here. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[shape.lightRadius, 64]} />
        <meshBasicMaterial
          color="#1ae0ff"
          transparent
          opacity={0.05}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
