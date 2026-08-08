import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { PathwayRequest } from "@/stores/sceneStore";

/**
 * The animated trace of a physiological route through the model.
 *
 * # Why this touches no organ material
 *
 * The obvious implementation — pulse the organ the marker is currently in — is
 * the one to avoid. `OrganMesh` builds its material from props, so driving it
 * from here means either fighting React for ownership of the same material, or
 * subscribing `SystemMeshes` to a value that changes on every step. The latter
 * re-renders every mounted mesh, and the muscular system alone has 1,110.
 *
 * So the route renders as a layer of its own: a tube along the structures'
 * centres, and a marker travelling it. Nothing else in the scene is aware of
 * it, which is what makes the feature cost nothing when no route is running.
 *
 * # Why the clock is a ref
 *
 * Elapsed time is read on every frame and rendered by nothing but this
 * component's own two objects. Putting it in the store or in React state would
 * turn a two-object animation into a 60 Hz re-render of the scene graph.
 */

/**
 * The route's colour, and the reason it is violet.
 *
 * Every other meaning is already spoken for: cyan is selection, and
 * amber-through-crimson is pathology severity. A luminous violet collides with
 * neither, and no tissue in the palette is violet — so it reads as an
 * annotation drawn over the anatomy rather than as something anatomical.
 */
const FLOW = "#c86bff";

/** Tube radius as a fraction of the model's largest dimension. */
const TUBE_SCALE = 0.004;
/** Marker radius, likewise. Large enough to follow at a full-body zoom. */
const MARKER_SCALE = 0.013;

/** Radial segments on the tube. Eight is round enough at this thickness. */
const TUBE_SIDES = 8;
/** Lengthwise segments per structure in the route. */
const TUBE_SEGMENTS_PER_STEP = 14;

interface Route {
  curve: THREE.CatmullRomCurve3;
  /** How many structures the curve actually spans, after dropping unmeasured ones. */
  stops: number;
}

export function PathwayFlow({
  pathway,
  centres,
  /**
   * Bumped whenever `centres` gains entries. The map is a ref shared with the
   * scene, so its identity never changes and a memo keyed on it alone would
   * keep the empty route it computed before any mesh had loaded.
   */
  centresRevision,
  /** The model's largest dimension, so sizes hold at any scale. */
  modelScale,
}: {
  pathway: PathwayRequest;
  centres: Map<string, THREE.Vector3>;
  centresRevision: number;
  modelScale: number;
}) {
  const route = useMemo<Route | null>(() => {
    void centresRevision;

    const points: THREE.Vector3[] = [];
    const missing: string[] = [];

    for (const organId of pathway.organIds) {
      const centre = centres.get(organId);
      // A structure whose system is switched off was never mounted, so it has
      // no measured centre. Skipping it keeps the rest of the route usable.
      if (centre) points.push(centre.clone());
      else missing.push(organId);
    }

    if (missing.length > 0) {
      console.warn(
        `[viewer] pathway "${pathway.label}" skipped unmeasured structures: ` +
          `${missing.join(", ")}. Their system may be switched off.`,
      );
    }

    // Duplicated consecutive points give a Catmull-Rom curve a zero-length
    // segment and a NaN tangent, which propagates to the whole geometry. The
    // engine rejects them too; this is the second line of defence.
    const distinct = points.filter(
      (point, index) => index === 0 || point.distanceToSquared(points[index - 1]!) > 1e-12,
    );
    if (distinct.length < 2) return null;

    return {
      // `centripetal` is the parameterisation that does not overshoot on
      // unevenly spaced points, and organ centres are very unevenly spaced —
      // the jejunum's neighbours are centimetres away, the pharynx's are not.
      curve: new THREE.CatmullRomCurve3(distinct, false, "centripetal", 0.5),
      stops: distinct.length,
    };
  }, [pathway, centres, centresRevision]);

  const tube = useMemo(() => {
    if (!route) return null;
    return new THREE.TubeGeometry(
      route.curve,
      route.stops * TUBE_SEGMENTS_PER_STEP,
      modelScale * TUBE_SCALE,
      TUBE_SIDES,
      false,
    );
  }, [route, modelScale]);

  // Geometry is not garbage-collected with the React tree — the GPU buffer
  // outlives it unless it is disposed explicitly.
  useEffect(() => () => tube?.dispose(), [tube]);

  const marker = useRef<THREE.Mesh>(null);
  const elapsed = useRef(0);
  const position = useRef(new THREE.Vector3());

  // Restart on a re-issued route. `seq` is what distinguishes "trace this
  // again" from a re-render that happens to carry the same route.
  //
  // And on a *rebuilt* one, which is the less obvious half. Meshes stream in
  // one system file at a time, so a route issued during loading is recomputed
  // several times as its structures become measurable — each time with more
  // stops, and therefore a different duration and a different curve. Carrying
  // the old elapsed time across that means the same number of seconds now
  // points somewhere else entirely, and the marker teleports mid-flight. It
  // has to start the new route from its beginning.
  useEffect(() => {
    elapsed.current = 0;
  }, [pathway.seq, route]);

  useFrame((_, delta) => {
    const mesh = marker.current;
    if (!route || !mesh) return;

    elapsed.current += delta;
    // One `stepSeconds` per segment, and a route of n stops has n-1 of them.
    const duration = Math.max((route.stops - 1) * pathway.stepSeconds, pathway.stepSeconds);
    const progress = elapsed.current / duration;

    // `getPoint`, not `getPointAt`: the raw curve parameter divides the time
    // evenly *per segment*, which is exactly what `stepSeconds` promises.
    // Arc-length parameterisation would instead give constant speed, so the
    // long haul down the colon would take many times its share of a step.
    //
    // Looping wraps from the last stop straight back to the first. That is
    // right for a circuit and a visible jump for a one-way route like
    // swallowing, which is why `loop` is the caller's decision.
    const t = pathway.loop ? progress % 1 : Math.min(progress, 1);
    route.curve.getPoint(t, position.current);
    mesh.position.copy(position.current);

    // A gentle throb, so the marker still reads as alive while it crosses a
    // long segment where its position barely changes on screen.
    mesh.scale.setScalar(1 + Math.sin(elapsed.current * 5.5) * 0.16);
  });

  if (!route || !tube) return null;

  return (
    <group>
      <mesh geometry={tube} renderOrder={2}>
        <meshBasicMaterial
          color={FLOW}
          transparent
          opacity={0.34}
          // The route is an annotation, so it accumulates through the anatomy
          // instead of occluding it — the same reasoning as ghosted organs.
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh ref={marker} renderOrder={3}>
        <sphereGeometry args={[modelScale * MARKER_SCALE, 16, 16]} />
        <meshBasicMaterial
          color={FLOW}
          // Drawn over everything on purpose. A bolus that vanishes behind the
          // ribs for two thirds of its journey teaches nothing, and following
          // it is the entire point of the animation.
          depthTest={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
