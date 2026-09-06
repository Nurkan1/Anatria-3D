import * as THREE from "three";

/**
 * A handle on the live renderer, for the two things that need it from outside
 * the canvas: the label overlay and the image export.
 *
 * # Why a module-level handle rather than context
 *
 * Both consumers live in the DOM, outside the R3F tree, and neither wants to
 * re-render when anything inside it changes. The label overlay reads the camera
 * on every animation frame and writes positions straight to the DOM; routing
 * that through React would mean sixty renders a second to move some text.
 *
 * Registered by a component *inside* the canvas, which is the only place these
 * objects exist, and cleared when it unmounts so a stale renderer can never be
 * handed out after a reload.
 */

export interface ViewerHandle {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** World-space centre of every measured structure, as the body holds it. */
  centres: Map<string, THREE.Vector3>;
  /**
   * How far each structure has been displaced by the exploded view. Empty when
   * nothing is exploded, which is why it is kept apart from `centres` rather
   * than folded into them: `centres` is the anatomy, and the pivot the
   * explosion is computed from has to come from the anatomy, not from a
   * previous explosion of it.
   */
  offsets: Map<string, THREE.Vector3>;
  /**
   * The orbit controls, so a drag that means something else can pause them.
   * Null until they have mounted.
   */
  controls: { enabled: boolean } | null;
  /** Advances when a lazy mesh file publishes new measured geometry. */
  geometryRevision?: number;
}

let handle: ViewerHandle | null = null;

export function setViewerHandle(next: ViewerHandle | null): void {
  handle = next;
}

export function getViewerHandle(): ViewerHandle | null {
  return handle;
}

/**
 * Where a structure is *right now* — its anatomical centre plus whatever the
 * exploded view has done to it.
 *
 * Everything that points at a structure from outside the canvas has to go
 * through here: a leader line, a lasso hit test and the camera all agree with
 * the picture only if they use the same position the mesh was drawn at.
 *
 * This is where a structure is *going*, not where the easing has got it to. For
 * the half second an explosion takes to settle, a leader line leads its own
 * structure slightly. Tracking the animated position instead would mean
 * publishing a moving value out of the render loop sixty times a second to
 * shave half a second off a discrepancy nobody is reading during.
 */
export function structurePosition(
  handle: Pick<ViewerHandle, "centres" | "offsets">,
  organId: string,
): THREE.Vector3 | undefined {
  const centre = handle.centres.get(organId);
  if (!centre) return undefined;
  const offset = handle.offsets.get(organId);
  // No allocation in the ordinary case, which matters: the lasso asks this for
  // every structure in the atlas on every pointer move.
  return offset ? centre.clone().add(offset) : centre;
}

/** `structurePosition` in the shape the collectors take. */
export function positionLookup(
  handle: Pick<ViewerHandle, "centres" | "offsets">,
): { get(organId: string): THREE.Vector3 | undefined } {
  return { get: (organId) => structurePosition(handle, organId) };
}

/** Where a structure lands on screen, in CSS pixels. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** True when the structure is behind the camera, where a projection lies. */
  behind: boolean;
}

const scratch = new THREE.Vector3();

/**
 * Project a world point to the viewport.
 *
 * The camera-space check has to happen between the two matrices: a point behind
 * the camera comes out of the full projection mirrored into the front of the
 * view, so by the time it is in normalised device coordinates it looks like a
 * perfectly ordinary position and a label would point confidently at nothing.
 */
export function projectToScreen(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenPoint {
  scratch.copy(point).applyMatrix4(camera.matrixWorldInverse);
  const behind = scratch.z > 0;
  scratch.applyMatrix4(camera.projectionMatrix);

  return {
    x: (scratch.x * 0.5 + 0.5) * width,
    y: (-scratch.y * 0.5 + 0.5) * height,
    behind,
  };
}
