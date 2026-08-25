import { OrbitControls, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { meshUrl, organsInFile } from "@/lib/manifest";
import type { AnatomyManifest, ManifestOrgan, SectionPlane } from "@/lib/schemas";
import {
  isOrganVisible,
  organOpacity,
  useSceneStore,
  type CrossSection,
  type FocusRequest,
  type ViewpointRequest,
} from "@/stores/sceneStore";
import { useStudyStore } from "@/stores/studyStore";

import { illuminationGlow } from "./depthStack";
import { buildEyeGroups } from "./eyes";
import { EyeGlobe } from "./EyeGlobe";
import { backgroundTheme } from "./background";
import { framingDistance, lateralSign, viewDirection } from "./cameraViews";
import { busiestTouches } from "./coverage";
import { explodeMembers, explodeOffsets } from "./explode";
import { studioLightDirections } from "./lighting";
import { keepsColour } from "./scan";
import {
  collectSupply,
  isSystemMeasured,
  studyEnvelope,
  SUPPLY_SYSTEM,
} from "./supply";
import { useExplodeMotion } from "./useExplodeMotion";
import { setViewerHandle } from "./viewerBridge";
import { OrganMesh } from "./OrganMesh";
import { PathwayFlow } from "./PathwayFlow";

/**
 * Plane normals point *away* from the half-space that is kept, which is what
 * three.js clipping expects: a fragment survives when `normal · p + constant > 0`.
 * So a sagittal cut at x = p keeps x < p.
 */
const PLANE_NORMALS: Record<SectionPlane, THREE.Vector3> = {
  sagittal: new THREE.Vector3(-1, 0, 0),
  coronal: new THREE.Vector3(0, 0, -1),
  axial: new THREE.Vector3(0, -1, 0),
};

/**
 * Self-hosted, copied from `three/examples/jsm/libs/draco` into `public/`.
 * drei defaults to a Google CDN, which a local-first desktop app must not
 * depend on and which the app's CSP blocks outright.
 */
const DRACO_DECODER_PATH = "/draco/";

/** One entry per organ: its geometry plus the node transform from the glTF. */
interface OrganGeometry {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

function buildClippingPlanes(
  section: CrossSection | null,
  bounds: THREE.Box3 | null,
): THREE.Plane[] {
  if (!section) return [];
  const normal = PLANE_NORMALS[section.plane].clone();

  // The command's position is normalised -1..1. Map it onto the model's real
  // extent along that axis, so a cut behaves the same whether the meshes are
  // unit-scale or human-scale in metres.
  let constant = section.position;
  if (bounds && !bounds.isEmpty()) {
    const centre = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const axis: Record<SectionPlane, "x" | "y" | "z"> = {
      sagittal: "x",
      coronal: "z",
      axial: "y",
    };
    const key = axis[section.plane];
    constant = -(centre[key] + (section.position * size[key]) / 2) * normal[key];
  }
  return [new THREE.Plane(normal, constant)];
}

/**
 * Publishes the renderer to the DOM side of the app.
 *
 * The label overlay and the image export both need the camera and the measured
 * centres, and both live outside the canvas. Registered here because this is
 * the only place those objects exist.
 */
function ViewerBridge({
  centres,
  offsets,
}: {
  centres: Map<string, THREE.Vector3>;
  offsets: Map<string, THREE.Vector3>;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  // `makeDefault` on OrbitControls is what publishes it here.
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;

  useEffect(() => {
    setViewerHandle({ gl, scene, camera, centres, offsets, controls });
    // Cleared on unmount so a reload cannot hand out a dead renderer.
    return () => setViewerHandle(null);
  }, [gl, scene, camera, centres, offsets, controls]);

  return null;
}

/**
 * The lighting rig, riding with the camera.
 *
 * Imperative: the directions change on every orbit frame, and routing that
 * through React state would re-render the scene graph to move three lights.
 *
 * The distance is arbitrary — a directional light only carries a direction, and
 * its target stays at the origin — so the vectors are simply scaled out past
 * anything in the scene.
 */
function StudioLights() {
  const background = useSceneStore((s) => s.background);
  const key = useRef<THREE.DirectionalLight>(null);
  const fill = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);

  const forward = useRef(new THREE.Vector3());
  const directions = useRef(studioLightDirections(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 1, 0),
  ));

  useFrame(({ camera }) => {
    camera.getWorldDirection(forward.current);
    const aimed = studioLightDirections(forward.current, camera.up, directions.current);
    key.current?.position.copy(aimed.key).multiplyScalar(10);
    fill.current?.position.copy(aimed.fill).multiplyScalar(10);
    rim.current?.position.copy(aimed.rim).multiplyScalar(10);
  });

  return (
    <>
      {/* Ambient is deliberately low. Filling the scene evenly flattens every
          surface, and on anatomy the shading *is* the information: the groove
          between two muscle bellies is a shadow, not a colour change. */}
      <ambientLight intensity={backgroundTheme(background).ambient} />
      <directionalLight ref={key} intensity={1.75} />
      <directionalLight ref={fill} intensity={0.5} color="#a8cfe8" />
      <directionalLight ref={rim} intensity={0.75} color="#8fd4ff" />
      {/* The one light that stays put. A bounce from below is environmental —
          it belongs to the room, not to the viewer — and keeping it in world
          space leaves a cue that the body has an underside at all. */}
      <directionalLight position={[0, -5, 1]} intensity={0.2} color="#ffd8c0" />
    </>
  );
}

/** Frames the model on load, then eases the orbit target onto focused organs. */
function CameraRig({
  focusRequest,
  viewpoint,
  centres,
  offsets,
  boxes,
  isolatedOrganIds,
  leftSign,
  bounds,
  finestDetail,
}: {
  focusRequest: FocusRequest | null;
  viewpoint: ViewpointRequest | null;
  centres: Map<string, THREE.Vector3>;
  offsets: Map<string, THREE.Vector3>;
  /** Measured extents, for framing whatever is on screen. */
  boxes: React.RefObject<Map<string, THREE.Box3>>;
  isolatedOrganIds: string[] | null;
  /** Which way along X the body's own left lies — see `lateralSign`. */
  leftSign: 1 | -1;
  bounds: THREE.Box3 | null;
  /** Radius of the smallest loaded structure, in model units. */
  finestDetail: number;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const desiredTarget = useRef(new THREE.Vector3());
  const desiredPosition = useRef(new THREE.Vector3());
  const { camera } = useThree();
  const lastSeq = useRef(-1);
  const lastViewpointSeq = useRef(-1);
  const framed = useRef(false);
  /**
   * What is being eased, if anything.
   *
   * `target` is a focus flying to a structure — the camera keeps its own place
   * and merely turns. `both` is a viewpoint button, which moves the camera as
   * well. Kept apart because a focus that also moved the camera would undo the
   * angle the reader had chosen to look from.
   */
  const easing = useRef<"none" | "target" | "both">("none");

  /**
   * Z-Anatomy meshes carry their real-world transforms — the heart sits about
   * 1.4 m above the origin at human scale. A camera parked near the origin
   * would stare at empty space, so frame whatever actually loaded rather than
   * assuming the model is unit-sized and centred.
   */
  useEffect(() => {
    if (!bounds || bounds.isEmpty() || framed.current) return;
    framed.current = true;

    const centre = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1e-4) * 0.5;

    const perspective = camera as THREE.PerspectiveCamera;
    const distance = (radius * 2.2) / Math.tan((perspective.fov * Math.PI) / 360);

    desiredTarget.current.copy(centre);
    camera.position.set(centre.x, centre.y + radius * 0.3, centre.z + distance);
    // The near plane has to clear the smallest thing worth inspecting, not the
    // whole body: derived from the body it would clip a cornea away before the
    // camera ever got close enough to see it.
    perspective.near = Math.max(finestDetail / 20, 1e-5);
    perspective.far = distance * 20;
    perspective.updateProjectionMatrix();

    const orbit = controls.current;
    if (orbit) {
      orbit.target.copy(centre);
      // Likewise the zoom floor. Scaling it to the whole body put the closest
      // approach at ~35 cm on a 1.8 m model — fine for an organ, useless for an
      // eye. Tie it to the finest structure loaded so detail stays reachable.
      orbit.minDistance = Math.max(finestDetail * 1.5, 1e-4);
      orbit.maxDistance = distance * 8;
      orbit.update();
    }
  }, [bounds, camera, finestDetail]);

  useEffect(() => {
    if (!focusRequest || focusRequest.seq === lastSeq.current) return;
    const centre = centres.get(focusRequest.organId);
    if (!centre) return;
    lastSeq.current = focusRequest.seq;
    desiredTarget.current.copy(centre);
    // Where the structure has been *drawn*, which in an exploded view is not
    // where the body keeps it. Flying to the anatomical centre would leave the
    // camera staring at the gap the structure moved out of.
    const offset = offsets.get(focusRequest.organId);
    if (offset) desiredTarget.current.add(offset);
    easing.current = "target";
  }, [focusRequest, centres, offsets]);

  /**
   * The viewpoint buttons.
   *
   * `fit` frames what is being *studied* rather than always the whole body —
   * the same scope rule the exploded view uses — because after isolating a
   * heart, "frame this" means the heart.
   *
   * `orient` keeps the distance it found. Turning to look at a structure from
   * behind must not also throw away the zoom the reader set to see it, and
   * `fit` is the separate verb for when they do want reframing.
   */
  useEffect(() => {
    const orbit = controls.current;
    if (!viewpoint || !orbit || viewpoint.seq === lastViewpointSeq.current) return;
    lastViewpointSeq.current = viewpoint.seq;

    const perspective = camera as THREE.PerspectiveCamera;
    const offsetFrom = camera.position.clone().sub(orbit.target);
    const distance = offsetFrom.length();

    if (viewpoint.kind === "dolly") {
      const next = THREE.MathUtils.clamp(
        distance * viewpoint.factor,
        orbit.minDistance,
        orbit.maxDistance,
      );
      desiredTarget.current.copy(orbit.target);
      desiredPosition.current
        .copy(orbit.target)
        .add(offsetFrom.normalize().multiplyScalar(next));
    } else if (viewpoint.kind === "orient") {
      desiredTarget.current.copy(orbit.target);
      desiredPosition.current
        .copy(orbit.target)
        .add(viewDirection(viewpoint.view, leftSign).multiplyScalar(distance));
    } else {
      const framing = studyEnvelope(
        isolatedOrganIds ?? boxes.current.keys(),
        boxes.current,
      );
      if (!framing) return;
      const centre = framing.getCenter(new THREE.Vector3());
      const size = framing.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 1e-4) * 0.5;

      desiredTarget.current.copy(centre);
      // Framed from where the camera already stands, so "fit" reframes without
      // also spinning the model round to a viewpoint nobody asked for.
      desiredPosition.current
        .copy(centre)
        .add(
          offsetFrom
            .normalize()
            .multiplyScalar(framingDistance(radius, perspective.fov)),
        );
    }

    easing.current = "both";
  }, [viewpoint, camera, isolatedOrganIds, leftSign]);

  useFrame((_, delta) => {
    const orbit = controls.current;
    if (!orbit) return;
    // Only steer while a move is in flight. Zoom-to-cursor and panning both
    // move `orbit.target` themselves, so easing on every frame would drag the
    // view back to the last focused structure the moment the user tried to look
    // somewhere else.
    if (easing.current === "none") return;

    // Frame-rate independent easing: without the delta term this would ease
    // faster on a 144 Hz display than on a 60 Hz one.
    const alpha = 1 - Math.pow(0.005, delta);
    orbit.target.lerp(desiredTarget.current, alpha);
    if (easing.current === "both") camera.position.lerp(desiredPosition.current, alpha);
    orbit.update();

    // Both have to have arrived. Stopping on the target alone would strand the
    // camera part-way through a viewpoint change, at an angle nobody chose.
    const settled =
      orbit.target.distanceToSquared(desiredTarget.current) < 1e-8 &&
      (easing.current === "target" ||
        camera.position.distanceToSquared(desiredPosition.current) < 1e-8);
    if (settled) {
      orbit.target.copy(desiredTarget.current);
      if (easing.current === "both") camera.position.copy(desiredPosition.current);
      orbit.update();
      easing.current = "none";
    }
  });

  return (
    <OrbitControls
      ref={controls}
      camera={camera}
      enableDamping
      dampingFactor={0.08}
      // Dolly towards the pointer instead of the orbit centre. Without it,
      // zooming on a full body always arrives at the pelvis — the target sits
      // at the body's centre and nothing the user does moves it there.
      zoomToCursor
      // Pan parallel to the screen; the default pans along the ground plane,
      // which on a standing figure slides the view sideways when the user is
      // trying to travel up towards the head.
      screenSpacePanning
      enablePan
      panSpeed={1.2}
      makeDefault
      // Any manual navigation ends the automatic easing, so the camera never
      // fights the hand that is moving it.
      onStart={() => {
        easing.current = "none";
      }}
    />
  );
}

function SystemMeshes({
  manifest,
  file,
  clippingPlanes,
  explodeOffsets: offsets,
  onMeasured,
  onContextMenu,
}: {
  manifest: AnatomyManifest;
  file: string;
  clippingPlanes: THREE.Plane[];
  /** Displacements for the exploded view, keyed across the whole atlas. */
  explodeOffsets: Map<string, THREE.Vector3>;
  onMeasured: (
    centres: Map<string, THREE.Vector3>,
    boxes: Map<string, THREE.Box3>,
    bounds: THREE.Box3,
    finestDetail: number,
  ) => void;
  onContextMenu: (organId: string, x: number, y: number) => void;
}) {
  const { nodes } = useGLTF(meshUrl(file), DRACO_DECODER_PATH);
  const register = useExplodeMotion(offsets);

  const organs = useMemo(() => organsInFile(manifest, file), [manifest, file]);

  const hoveredOrganId = useSceneStore((s) => s.hoveredOrganId);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const hiddenOrganIds = useSceneStore((s) => s.hiddenOrganIds);
  const hideConnective = useSceneStore((s) => s.hideConnective);
  const connectiveIds = useSceneStore((s) => s.connectiveIds);
  const overlays = useSceneStore((s) => s.pathologyOverlays);
  const caseMarks = useSceneStore((s) => s.caseMarks);
  const hiddenSystems = useSceneStore((s) => s.hiddenSystems);
  const systemOpacity = useSceneStore((s) => s.systemOpacity);
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const setHovered = useSceneStore((s) => s.setHovered);
  // The viewport's own select: it pins the depth reading as well, so the
  // panel still shows the column you clicked once the pointer has travelled
  // over other structures to reach it. The tree and the search box keep
  // using `selectOrgan`, which has no reading behind it to pin.
  const selectOrgan = useSceneStore((s) => s.selectFromViewport);
  const studyOrgan = useSceneStore((s) => s.studyOrgan);
  const studyRegion = useSceneStore((s) => s.studyRegion);
  const setDepthStack = useSceneStore((s) => s.setDepthStack);
  const eyeTracking = useSceneStore((s) => s.eyeTracking);

  /**
   * Stable, and that is the point rather than a nicety.
   *
   * `OrganMesh` is memoised, so a prop rebuilt on every render defeats it for
   * every structure at once — and this component re-renders on every pointer
   * move that changes what is hovered. As an inline arrow this one callback
   * cost three thousand component invocations per mouse move.
   */
  const onStudy = useCallback(
    (organId: string, additive: boolean) =>
      // Plain double-click studies the whole region, so opening the heart shows
      // its chambers rather than an empty shell. Holding a modifier builds a
      // set of individual structures instead.
      additive ? studyOrgan(organId, true) : studyRegion(organId),
    [studyOrgan, studyRegion],
  );

  /**
   * What is lit, and how deeply.
   *
   * Two sources feed one light: the cursor's own column, and whatever the
   * assistant is pointing at while it explains. **The assistant wins.** Sharing
   * the appearance without a precedence would leave the reader unable to tell
   * which of two lit things was being talked about, and the cursor's column is
   * still named in the panel either way — so nothing is lost by yielding.
   *
   * A lookup rather than a search per structure: the alternative is three
   * thousand `indexOf` calls on every pointer move.
   */
  const depthStack = useSceneStore((s) => s.depthStack);
  const illuminated = useSceneStore((s) => s.illuminated);
  const scan = useSceneStore((s) => s.scan);
  /**
   * What the assistant has pointed at, and how deep into the list each one sits.
   *
   * Kept apart from the cursor's stack below rather than merged into it. They
   * are two different statements — "the explanation is about this" against
   * "your hand is over this" — and only the first of them outranks the reader's
   * own selection. Merged, a pointer move across the model would wash out a
   * selection the reader made deliberately.
   */
  const litGlow = useMemo(
    () =>
      new Map(
        illuminated.map((organId, index) => [
          organId,
          illuminationGlow(index, illuminated.length),
        ]),
      ),
    [illuminated],
  );

  /**
   * What the cursor is over, when the assistant is not pointing at anything.
   *
   * Suppressed entirely while something is illuminated: the assistant's light
   * outranks the cursor's, so the first pointer move must not take over the
   * structure being explained.
   */
  const probeDepth = useMemo(
    () =>
      illuminated.length > 0
        ? new Map<string, number>()
        : new Map(depthStack.map((organId, index) => [organId, index])),
    [illuminated, depthStack],
  );

  /**
   * The reader's revision, or nothing at all.
   *
   * Resolved once here rather than per structure: the busiest count sets the
   * top of the ramp, so every mesh needs the same two numbers and recomputing
   * the maximum three thousand times a render would be the same answer three
   * thousand times.
   */
  const coverageVisible = useStudyStore((s) => s.coverageVisible);
  const coverageCounts = useStudyStore((s) => s.coverage);
  const coverage = useMemo(
    () =>
      coverageVisible
        ? { byOrgan: coverageCounts, busiest: busiestTouches(coverageCounts) }
        : null,
    [coverageVisible, coverageCounts],
  );

  const geometries = useMemo(() => {
    const map = new Map<string, OrganGeometry>();
    const missing: string[] = [];

    for (const organ of organs) {
      // GLTFLoader runs every node name through `PropertyBinding.sanitizeNodeName`,
      // which turns whitespace into underscores and strips characters reserved
      // by the animation-binding syntax. Z-Anatomy names are full anatomical
      // phrases ("Right atrium"), so a raw lookup misses every single one.
      // Using three's own function keeps us in step with whatever it does.
      const node =
        nodes[organ.node] ?? nodes[THREE.PropertyBinding.sanitizeNodeName(organ.node)];
      if (node instanceof THREE.Mesh) {
        node.updateWorldMatrix(true, false);
        map.set(organ.organ_id, {
          geometry: node.geometry as THREE.BufferGeometry,
          matrix: node.matrixWorld.clone(),
        });
      } else {
        missing.push(organ.node);
      }
    }

    if (missing.length > 0) {
      // The manifest and the .glb disagree — usually a stale mesh after a
      // re-export. Loud, because the organ would otherwise just be absent from
      // the scene with nothing to say why.
      console.error(
        `[viewer] ${file} has no mesh node for: ${missing.join(", ")}. ` +
          "Re-run the asset pipeline.",
      );
    }
    return map;
  }, [nodes, organs, file]);

  // Computed here rather than inside the effect that reports it upwards: the
  // eye groups below need these centres during render to find each globe's
  // pivot, and measuring twice would be the same arithmetic done in two places.
  const measured = useMemo(() => {
    const centres = new Map<string, THREE.Vector3>();
    // Kept as well as the centres, not instead of them. A centre answers "where
    // do I fly to"; only the box answers "does this vessel reach that organ",
    // because an artery's centre can sit a long way from the organ it serves.
    const boxes = new Map<string, THREE.Box3>();
    const bounds = new THREE.Box3();
    let finest = Number.POSITIVE_INFINITY;

    for (const [organId, entry] of geometries) {
      if (!entry.geometry.boundingBox) entry.geometry.computeBoundingBox();
      const box = entry.geometry.boundingBox;
      if (!box) continue;
      // The geometry's own box is in local space; the node transform is what
      // places the organ in the body. Skipping this would send the camera to
      // the wrong spot for every organ that is not at the origin.
      const world = box.clone().applyMatrix4(entry.matrix);
      centres.set(organId, world.getCenter(new THREE.Vector3()));
      boxes.set(organId, world);
      bounds.union(world);

      const size = world.getSize(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z);
      if (extent > 1e-6) finest = Math.min(finest, extent * 0.5);
    }
    return { centres, boxes, bounds, finest: Number.isFinite(finest) ? finest : 0.01 };
  }, [geometries]);

  useEffect(() => {
    onMeasured(measured.centres, measured.boxes, measured.bounds, measured.finest);
  }, [measured, onMeasured]);

  /**
   * The eyeballs in this file, if it has any.
   *
   * Empty for every file but the nervous one, so the partition below costs
   * nothing anywhere else.
   */
  const eyes = useMemo(
    () => buildEyeGroups(organs, measured.centres),
    [organs, measured],
  );
  const eyeOrganIds = useMemo(
    () => new Set(eyes.flatMap((eye) => eye.organs.map((organ) => organ.organ_id))),
    [eyes],
  );

  /**
   * Each eye part's placement *relative to its globe's centre*, since that is
   * the space its group puts it in.
   *
   * Memoised rather than built during render, and the identity is the point:
   * these matrices are React props, and a fresh object each render would make
   * every eye part detach and reattach its ref — dropping the exploded view's
   * animation for those structures every time anything was hovered.
   */
  const eyeMatrices = useMemo(() => {
    const map = new Map<string, THREE.Matrix4>();
    for (const eye of eyes) {
      // T(-centre) once per eye, reused by all its parts.
      const toLocal = new THREE.Matrix4().makeTranslation(
        -eye.centre.x,
        -eye.centre.y,
        -eye.centre.z,
      );
      for (const organ of eye.organs) {
        const entry = geometries.get(organ.organ_id);
        if (!entry) continue;
        map.set(
          organ.organ_id,
          new THREE.Matrix4().multiplyMatrices(toLocal, entry.matrix),
        );
      }
    }
    return map;
  }, [eyes, geometries]);

  /**
   * One structure.
   *
   * `matrix` is overridden for the eye parts: inside a group positioned at the
   * globe's centre, a child has to carry its world placement *relative to that
   * centre*, or it would be drawn an eye's-width away from where it belongs.
   */
  const renderOrgan = (organ: ManifestOrgan, matrix?: THREE.Matrix4) => {
    const entry = geometries.get(organ.organ_id);
    if (!entry) return null;
    return (
      <OrganMesh
        key={organ.organ_id}
        organ={organ}
        geometry={entry.geometry}
        matrix={matrix ?? entry.matrix}
        visible={isOrganVisible(
            { hiddenSystems, isolatedOrganIds, hiddenOrganIds, hideConnective, connectiveIds },
            organ,
          )}
        opacity={organOpacity({ systemOpacity }, organ)}
        hovered={hoveredOrganId === organ.organ_id}
        selected={selectedOrganIds.includes(organ.organ_id)}
        // The assistant's overlay wins when both exist: one is what is being
        // explained right now, the other is the standing presentation. The
        // mark shows through the moment the explanation moves on.
        overlay={overlays[organ.organ_id] ?? caseMarks[organ.organ_id]}
        // Two numbers rather than one object: an object built here would be a
        // new identity on every render and would defeat the memo below it.
        coverageTouches={coverage ? (coverage.byOrgan[organ.organ_id] ?? 0) : undefined}
        coverageBusiest={coverage?.busiest}
        probeDepth={probeDepth.get(organ.organ_id)}
        litGlow={litGlow.get(organ.organ_id)}
        scanned={
          scan &&
          !keepsColour({
            lit: litGlow.has(organ.organ_id),
            selected: selectedOrganIds.includes(organ.organ_id),
            isolated: isolatedOrganIds?.includes(organ.organ_id) ?? false,
          })
        }
        clippingPlanes={clippingPlanes}
        onHover={setHovered}
        onSelect={selectOrgan}
        onProbe={setDepthStack}
        onContextMenu={onContextMenu}
        onRegister={register}
        onStudy={onStudy}
      />
    );
  };

  return (
    <group>
      {eyes.map((eye) => (
        <EyeGlobe key={eye.side} eye={eye} enabled={eyeTracking}>
          {eye.organs.map((organ) => {
            const matrix = eyeMatrices.get(organ.organ_id);
            return matrix ? renderOrgan(organ, matrix) : null;
          })}
        </EyeGlobe>
      ))}

      {/* Everything else, in place. The eye parts are already drawn above,
          inside the group that turns them. */}
      {organs.map((organ) =>
        eyeOrganIds.has(organ.organ_id) ? null : renderOrgan(organ),
      )}
    </group>
  );
}

export function AnatomyScene({
  manifest,
  onContextMenu,
}: {
  manifest: AnatomyManifest;
  onContextMenu: (organId: string, x: number, y: number) => void;
}) {
  const { gl } = useThree();
  const crossSection = useSceneStore((s) => s.crossSection);
  const focusRequest = useSceneStore((s) => s.focusRequest);
  const hiddenSystems = useSceneStore((s) => s.hiddenSystems);
  const pathway = useSceneStore((s) => s.pathway);
  const viewpoint = useSceneStore((s) => s.viewpoint);
  const explode = useSceneStore((s) => s.explode);
  const selectedOrganIds = useSceneStore((s) => s.selectedOrganIds);
  const isolatedOrganIds = useSceneStore((s) => s.isolatedOrganIds);
  const supplyRequest = useSceneStore((s) => s.supplyRequest);
  const resolveSupply = useSceneStore((s) => s.resolveSupply);
  const cancelSupply = useSceneStore((s) => s.cancelSupply);

  // Only visible systems are mounted, and mounting is what triggers the fetch.
  // Switching a system off unmounts it; switching one on downloads its mesh
  // file then. That is the whole of the lazy-loading strategy — extending the
  // atlas to the rest of the body costs nothing until the user opens a system.
  const activeFiles = useMemo(
    () =>
      [
        ...new Set(
          manifest.organs
            .filter((organ) => !hiddenSystems.includes(organ.system))
            .map((organ) => organ.mesh_file),
        ),
      ].sort(),
    [manifest.organs, hiddenSystems],
  );

  const centres = useRef(new Map<string, THREE.Vector3>());
  const boxes = useRef(new Map<string, THREE.Box3>());
  const [bounds, setBounds] = useState<THREE.Box3 | null>(null);
  const [finestDetail, setFinestDetail] = useState(0.01);
  // `centres` is a ref, so filling it cannot invalidate a memo downstream. This
  // counter is the signal that it changed — a route built before the digestive
  // meshes finished loading would otherwise stay empty for ever.
  const [centresRevision, setCentresRevision] = useState(0);

  const onMeasured = useCallback(
    (
      measured: Map<string, THREE.Vector3>,
      measuredBoxes: Map<string, THREE.Box3>,
      box: THREE.Box3,
      finest: number,
    ) => {
      for (const [organId, centre] of measured) centres.current.set(organId, centre);
      for (const [organId, organBox] of measuredBoxes) boxes.current.set(organId, organBox);
      setBounds((previous) => {
        const next = previous ? previous.clone() : new THREE.Box3();
        next.union(box);
        return next;
      });
      setFinestDetail((previous) => Math.min(previous, finest));
      setCentresRevision((previous) => previous + 1);
    },
    [],
  );

  // Per-material clipping planes only take effect once local clipping is on.
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  const clippingPlanes = useMemo(
    () => buildClippingPlanes(crossSection, bounds),
    [crossSection, bounds],
  );

  /**
   * Where the exploded view puts each structure.
   *
   * `centres` is a ref, so `centresRevision` is what says it has changed —
   * without it an explosion computed before the digestive meshes finished
   * loading would leave them behind in the body for ever.
   */
  const offsets = useMemo(
    () =>
      explodeOffsets(
        explodeMembers({ selectedOrganIds, isolatedOrganIds }, centres.current.keys()),
        centres.current,
        explode,
      ),
    // `centres` is a ref and cannot invalidate a memo, so `centresRevision`
    // stands in for it — the same signal `PathwayFlow` is handed.
    [explode, selectedOrganIds, isolatedOrganIds, centresRevision],
  );

  /**
   * Answering a request for an organ's vessels or nerves.
   *
   * Here rather than in the store because the answer is geometric, and the
   * boxes only exist inside the canvas. It runs again on every measurement:
   * asking for vessels switches the cardiovascular system on, and that system's
   * meshes stream in *after* the question was asked. Returning "none found"
   * before they arrive would be a wrong answer the reader cannot see through,
   * so an unmeasured system means wait, not none.
   */
  useEffect(() => {
    if (!supplyRequest) return;
    if (isolatedOrganIds === null || isolatedOrganIds.length === 0) {
      cancelSupply();
      return;
    }

    const candidates = manifest.organs
      .filter((organ) => organ.system === SUPPLY_SYSTEM[supplyRequest.kind])
      .map((organ) => organ.organ_id);
    // A system this build does not ship can never answer; anything else is
    // still on its way.
    if (candidates.length === 0) {
      cancelSupply();
      return;
    }
    if (!isSystemMeasured(candidates, boxes.current)) return;

    resolveSupply(collectSupply(isolatedOrganIds, candidates, boxes.current));
  }, [
    supplyRequest,
    // `boxes` is a ref; this counter is what says it has changed.
    centresRevision,
    isolatedOrganIds,
    manifest.organs,
    resolveSupply,
    cancelSupply,
  ]);

  /**
   * Which way along X the body's own left lies, read off the atlas rather than
   * assumed from an axis convention. Recomputed as meshes arrive because the
   * first file loaded may hold no paired structures at all.
   */
  const leftSign = useMemo(
    () => lateralSign(centres.current.keys(), centres.current),
    // `centres` is a ref and cannot invalidate a memo; `centresRevision` is.
    [centresRevision],
  );

  // Sizes for the pathway layer are derived from the model rather than fixed,
  // so the marker is legible whether the meshes are unit-scale or in metres.
  const modelScale = useMemo(() => {
    if (!bounds || bounds.isEmpty()) return 1;
    const size = bounds.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z, 1e-4);
  }, [bounds]);

  return (
    <>
      <StudioLights />
      <ViewerBridge centres={centres.current} offsets={offsets} />

      {activeFiles.map((file) => (
        <SystemMeshes
          key={file}
          manifest={manifest}
          file={file}
          clippingPlanes={clippingPlanes}
          explodeOffsets={offsets}
          onMeasured={onMeasured}
          onContextMenu={onContextMenu}
        />
      ))}

      {pathway && (
        <PathwayFlow
          pathway={pathway}
          centres={centres.current}
          centresRevision={centresRevision}
          modelScale={modelScale}
        />
      )}

      <CameraRig
        focusRequest={focusRequest}
        viewpoint={viewpoint}
        centres={centres.current}
        offsets={offsets}
        boxes={boxes}
        isolatedOrganIds={isolatedOrganIds}
        leftSign={leftSign}
        bounds={bounds}
        finestDetail={finestDetail}
      />
    </>
  );
}
