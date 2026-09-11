import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { useScanStore } from "@/stores/scanStore";

import { AXIAL_CANVAS, paintSlice, SLAB_HALF_THICKNESS, SLICE_MIN_HALF, SLICE_PIXELS_NORMAL } from "./axialSlice";
import {
  frontalCutPlanes,
  frontalDepths,
  frontalPaintFlags,
  frontalSlabPlanes,
} from "./frontalSlice";
import { aimStudioAt, rakingKey } from "./lighting";

/**
 * Phase 0 for a frontal section: what one would cost, measured before it is built.
 *
 * # The question
 *
 * An axial slab through the chest keeps about 350 of the atlas's meshes. A frontal
 * one runs the whole height of the body, and the structures that run head to foot
 * — the long muscles, the bones of the limbs, the great vessels, the nerves — all
 * cross it. The pass costs draw calls rather than pixels, so the number of meshes
 * that survive the slab is the whole question, and nobody knows it yet.
 *
 * Asked for from the renderer panel, it takes three passes — front, middle and
 * back — one per frame so that asking does not freeze the view, and publishes each
 * one's render time, readback time, draw calls and meshes drawn. The middle one is
 * painted into the section panel, so the answer to "is a frontal section of this
 * atlas worth reading" can be looked at rather than argued about.
 *
 * # What it must not do
 *
 * Touch the axial path. It is a separate component on purpose, with its own
 * target, and it borrows the scene exactly the way the axial probe does: meshes
 * hidden, materials made opaque, the lights moved, the ring hidden — and every one
 * of them handed back in a `finally`, because the next frame belongs to the reader.
 */

export interface FrontalPass {
  depthCm: number;
  renderMs: number;
  readbackMs: number;
  drawCalls: number;
  drawn: number;
}

/** Published for the renderer panel. Written by the probe, never rendered from. */
export const FRONTAL_PROBE = {
  /** Bumped from the panel to ask for a measurement. */
  wanted: 0,
  /** Completed measurements, so a second one is distinguishable from the first. */
  runs: 0,
  /** Which cut the last measurement used: it follows the scanner's own setting. */
  cut: false,
  /** Front, middle and back, in that order. Empty until measured. */
  passes: [] as FrontalPass[],
};

/** Ask for a measurement. */
export function wantFrontalProbe(): void {
  FRONTAL_PROBE.wanted += 1;
}

const SIZE = SLICE_PIXELS_NORMAL;
/** Which of the three passes is painted: the middle one, through the spine. */
const PAINTED = 1;

export function FrontalProbe({
  bounds,
  leftSign,
}: {
  bounds: THREE.Box3 | null;
  leftSign: 1 | -1;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const seen = useRef(FRONTAL_PROBE.wanted);
  /** Depths still to measure in the current request, taken one per frame. */
  const queue = useRef<number[]>([]);
  const results = useRef<FrontalPass[]>([]);

  const target = useMemo(
    () => new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true, stencilBuffer: false }),
    [],
  );
  useEffect(() => () => target.dispose(), [target]);
  const camera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2), []);
  /** Sixteen megabytes, so allocated on the first request rather than on mount. */
  const pixels = useRef<Uint8Array | null>(null);
  const reach = useMemo(() => new THREE.Vector3(), []);
  const content = useMemo(() => new THREE.Box3(), []);

  useFrame(() => {
    if (!bounds || bounds.isEmpty()) return;

    if (FRONTAL_PROBE.wanted !== seen.current) {
      seen.current = FRONTAL_PROBE.wanted;
      queue.current = frontalDepths(bounds.min.z, bounds.max.z);
      results.current = [];
      FRONTAL_PROBE.cut = useScanStore.getState().cut;
    }
    const at = queue.current.shift();
    if (at === undefined) return;
    const index = results.current.length;
    const cutting = FRONTAL_PROBE.cut;

    const ring = scene.getObjectByName("scan-ring");
    const ringWasVisible = ring?.visible ?? false;
    if (ring) ring.visible = false;

    const hidden: THREE.Mesh[] = [];
    const solid: {
      material: THREE.Material;
      transparent: boolean;
      opacity: number;
      depthWrite: boolean;
    }[] = [];
    let considered = 0;
    content.makeEmpty();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      considered += 1;
      const geometry = mesh.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const sphere = geometry.boundingSphere;
      if (!sphere) return;
      reach.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
      const radius = sphere.radius * mesh.matrixWorld.getMaxScaleOnAxis();
      // The same conservative sphere test as the axial pass, along Z instead of Y.
      if (Math.abs(reach.z - at) > radius + SLAB_HALF_THICKNESS) {
        mesh.visible = false;
        hidden.push(mesh);
        return;
      }
      content.expandByPoint(reach.clone().addScalar(radius));
      content.expandByPoint(reach.clone().addScalar(-radius));
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        solid.push({
          material,
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
        });
        material.transparent = false;
        material.opacity = 1;
        material.depthWrite = true;
      }
    });

    // Framed on what the slab holds, across and up — the frontal plane's own two
    // axes. Square, from the larger: a whole body is taller than it is wide, so
    // most of a frontal frame is its height.
    const box = content.isEmpty() ? bounds : content;
    const centre = box.getCenter(new THREE.Vector3());
    const extent = box.getSize(new THREE.Vector3());
    const half = Math.max((Math.max(extent.x, extent.y) / 2) * 1.06, SLICE_MIN_HALF);
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.position.set(centre.x, centre.y, at + 0.5);
    camera.up.set(0, 1, 0);
    camera.lookAt(centre.x, centre.y, at);
    camera.updateProjectionMatrix();

    const forward = new THREE.Vector3(0, 0, -1);
    const up = new THREE.Vector3(0, 1, 0);
    const restoreLights = aimStudioAt(scene, forward, up, {
      key: cutting ? undefined : rakingKey(forward, up),
    });
    const previousClipping = gl.clippingPlanes;
    const previousTarget = gl.getRenderTarget();
    if (!pixels.current) pixels.current = new Uint8Array(SIZE * SIZE * 4);
    const buffer = pixels.current;
    let renderMs = -1;
    let readbackMs = -1;
    let drawCalls = -1;
    try {
      gl.clippingPlanes = cutting ? frontalCutPlanes(at) : frontalSlabPlanes(at);
      gl.info.reset();
      const startedRender = performance.now();
      gl.setRenderTarget(target);
      gl.render(scene, camera);
      gl.getContext().finish();
      renderMs = performance.now() - startedRender;
      drawCalls = gl.info.render.calls;

      const startedReadback = performance.now();
      gl.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, buffer);
      readbackMs = performance.now() - startedReadback;
    } finally {
      restoreLights();
      gl.setRenderTarget(previousTarget);
      gl.clippingPlanes = previousClipping;
      if (ring) ring.visible = ringWasVisible;
      for (const mesh of hidden) mesh.visible = true;
      for (const was of solid) {
        was.material.transparent = was.transparent;
        was.material.opacity = was.opacity;
        was.material.depthWrite = was.depthWrite;
        was.material.needsUpdate = true;
      }
    }

    results.current.push({
      depthCm: (at - bounds.min.z) * 100,
      renderMs,
      readbackMs,
      drawCalls,
      drawn: considered - hidden.length,
    });
    // Published as it goes, so the panel fills in pass by pass.
    FRONTAL_PROBE.passes = [...results.current];

    if (index === PAINTED) {
      const surface = AXIAL_CANVAS.value;
      if (surface) paintSlice(surface, buffer, SIZE, frontalPaintFlags(leftSign));
    }
    if (queue.current.length === 0) FRONTAL_PROBE.runs += 1;
  });

  return null;
}
