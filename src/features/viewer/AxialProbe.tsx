import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { SHARED_SCAN } from "./scanBand";
import { sliceFraming, slabPlanes, SLICE_UP } from "./axialSlice";

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
    AXIAL_PROBE.runs += 1;
  });

  return null;
}
