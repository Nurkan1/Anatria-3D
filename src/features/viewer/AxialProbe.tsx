import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { SHARED_SCAN } from "./scanBand";
import { sliceFraming, slabPlanes, SLAB_HALF_THICKNESS, SLICE_UP } from "./axialSlice";

/**
 * Phase 0 for the axial slice: measure, and decide afterwards.
 *
 * # The one question this exists to answer
 *
 * An axial view is a *second render of the whole scene*, and in this scene the
 * cost is draw calls rather than pixels — measured on this atlas, 3,368 meshes
 * drawn come to 2,846 draw calls, and the four-panel study view multiplies that
 * by its four passes. A live axial view would therefore roughly double the
 * frame, which on a modest machine is the difference between 49 fps and 25.
 *
 * The way out is that a slice only has to be *correct while the plane is
 * still*. Rendered once when the sweep stops and then left alone, it costs one
 * frame rather than every frame. This probe measures what that one frame
 * actually costs, in milliseconds, before anything is built on top of it:
 *
 * - the render into an offscreen target, and
 * - reading the pixels back to the CPU, which is the part that stalls the
 *   pipeline and the part nobody remembers to measure.
 *
 * If the pair comes to a few milliseconds, the feature is affordable and the
 * picture can be painted into an ordinary DOM canvas, costing the render loop
 * nothing at all afterwards. If it comes to hundreds, the design is wrong and
 * this file is deleted rather than optimised.
 *
 * **Nothing here is on a path a reader can reach.** It renders only when asked,
 * and it is mounted only by the experiment.
 */

/** Published for whatever reads the measurement. Written, never rendered from. */
export const AXIAL_PROBE = {
  /** Milliseconds for the offscreen render, or -1 before the first one. */
  renderMs: -1,
  /** Milliseconds for the pixel readback. */
  readbackMs: -1,
  /** Draw calls that one pass cost. */
  drawCalls: -1,
  /** How many times it has run, so a repeat measurement is distinguishable. */
  runs: 0,
  /** Meshes the slab test kept. The rest were never submitted. */
  drawn: -1,
};

/** Square, and small: a slice read at a glance does not need more. */
const SIZE = 320;

export function AxialProbe({
  bounds,
  request,
}: {
  bounds: THREE.Box3 | null;
  /**
   * Increments when a measurement is wanted.
   *
   * A counter rather than a boolean, so asking twice for the same height is two
   * measurements rather than one — the second run is the one without a cold
   * shader cache behind it, and the difference between them is worth seeing.
   */
  request: number;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const done = useRef(0);

  const target = useMemo(
    () =>
      new THREE.WebGLRenderTarget(SIZE, SIZE, {
        depthBuffer: true,
        stencilBuffer: false,
      }),
    [],
  );
  useEffect(() => () => target.dispose(), [target]);

  const camera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2), []);
  const pixels = useMemo(() => new Uint8Array(SIZE * SIZE * 4), []);
  /** Reused, because allocating an array of meshes per measurement is silly. */
  const hiddenMeshes = useRef<THREE.Mesh[]>([]);
  const reach = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (request === done.current || !bounds || bounds.isEmpty()) return;
    done.current = request;

    const at = SHARED_SCAN.value;
    const framing = sliceFraming(bounds, at);
    camera.left = -framing.halfWidth;
    camera.right = framing.halfWidth;
    camera.top = framing.halfDepth;
    camera.bottom = -framing.halfDepth;
    camera.position.copy(framing.position);
    camera.up.copy(SLICE_UP);
    camera.lookAt(framing.target);
    camera.updateProjectionMatrix();

    /**
     * The ring is hidden for the measurement.
     *
     * It sits exactly at the height being sliced, so from directly above it
     * would fill the frame with its own hardware and its wash — a photograph of
     * the instrument rather than of the patient.
     */
    const ring = scene.getObjectByName("scan-ring");
    const ringWasVisible = ring?.visible ?? false;
    if (ring) ring.visible = false;

    /**
     * Everything that cannot touch the slab is hidden before the pass.
     *
     * Measured first, which is the only reason this is here: the axial pass
     * came to 3,362 draw calls at the chest against the main view's 3,014 —
     * *more*, not fewer. Two things add up to that. Seen from directly above
     * with a frame around the whole body, almost nothing falls outside the
     * frustum, where the front view discards plenty. And **clipping planes do
     * not save draw calls**: they discard fragments, so all 3,368 meshes are
     * still submitted even though a five-millimetre slab can only contain a
     * couple of hundred of them.
     *
     * A bounding-sphere test against the slab costs two comparisons per mesh
     * and removes the rest from the pass entirely. Visibility is restored
     * immediately afterwards — this must leave the scene exactly as it found
     * it, because the very next frame is the reader's.
     */
    const hidden = hiddenMeshes.current;
    hidden.length = 0;
    // Counted rather than assumed: the number of meshes on screen depends on
    // which systems are switched on and which body is loaded, so a constant
    // here would be a figure that reads as measured and is not.
    let considered = 0;
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      considered += 1;
      const geometry = mesh.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const sphere = geometry.boundingSphere;
      if (!sphere) return;
      // In world space, and conservatively: the mesh's own scale is folded in
      // through `matrixWorld`, so a scaled structure is not culled early.
      reach.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
      const radius = sphere.radius * mesh.matrixWorld.getMaxScaleOnAxis();
      if (Math.abs(reach.y - at) > radius + SLAB_HALF_THICKNESS) {
        mesh.visible = false;
        hidden.push(mesh);
      }
    });

    const previousClipping = gl.clippingPlanes;
    const previousTarget = gl.getRenderTarget();
    gl.clippingPlanes = slabPlanes(at);

    // `renderer.info` accumulates over a frame, so it is reset immediately
    // before the pass and read immediately after: what it reports is then this
    // pass and nothing else.
    gl.info.reset();
    const startedRender = performance.now();
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    // `finish` before stopping the clock, or the number measured is how long
    // the driver took to *accept* the commands rather than to run them — which
    // on a modern driver is close to zero and completely useless.
    gl.getContext().finish();
    AXIAL_PROBE.renderMs = performance.now() - startedRender;
    AXIAL_PROBE.drawCalls = gl.info.render.calls;

    const startedReadback = performance.now();
    gl.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    AXIAL_PROBE.readbackMs = performance.now() - startedReadback;

    gl.setRenderTarget(previousTarget);
    gl.clippingPlanes = previousClipping;
    if (ring) ring.visible = ringWasVisible;
    for (const mesh of hidden) mesh.visible = true;
    AXIAL_PROBE.drawn = considered - hidden.length;
    hidden.length = 0;
    AXIAL_PROBE.runs += 1;
  });

  return null;
}
