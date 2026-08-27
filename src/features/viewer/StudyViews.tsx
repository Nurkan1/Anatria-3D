import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { lateralSign, viewDirection, type AnatomicalView } from "./cameraViews";
import { getViewerHandle } from "./viewerBridge";

/**
 * Four viewports of one scene, on one canvas.
 *
 * # What this is not
 *
 * Not four canvases, not four scenes, and not a second copy of the mesh tree.
 * There is one `THREE.Scene` holding one set of geometries, rendered four times
 * through four cameras into four scissored rectangles of the same drawing
 * buffer. That is the whole technique, and the reason the feature is affordable
 * at all.
 *
 * # Why it is gated on isolation, and why that is a rule and not advice
 *
 * Measured on this atlas: the full body is 3,478 draw calls and 10.9 million
 * triangles, and the application holds 51 fps drawing it once. Four times that
 * is roughly fourteen thousand calls and will not hold thirty on anything.
 *
 * With one structure isolated it is **one** draw call and 1,888 triangles, at
 * 60 fps, and the frame time is identical whether the scene holds 342 objects
 * or 3,499 — hidden meshes cost a visibility check and nothing else. So four
 * viewports of an isolated selection cost four draw calls, and every panel can
 * run at full rate.
 *
 * Which means the gate below is not a performance *strategy*, it is the entire
 * performance strategy. Nothing here throttles, freezes or degrades, because
 * with the gate in place there is nothing to throttle.
 *
 * # Reversibility
 *
 * Taking a `useFrame` with a render priority means React Three Fiber stops
 * rendering by itself and this component owns the loop. That is a real
 * takeover, so it happens only while the component is mounted: switch the mode
 * off and R3F's own loop resumes untouched, having never known. The cleanup
 * below restores the viewport, the scissor and the clear state so the single
 * view cannot inherit a quartered canvas.
 */

/**
 * What React Three Fiber does when nothing has replaced it.
 *
 * Written out rather than borrowed because R3F does not expose its default:
 * `state.events.compute` is undefined until something assigns to it, so there
 * is nothing to capture and hand back. Leaving that gap unhandled is what
 * broke single-view selection the first time.
 */
function fullCanvasCompute(
  event: { offsetX: number; offsetY: number },
  state: {
    pointer: THREE.Vector2;
    raycaster: THREE.Raycaster;
    camera: THREE.Camera;
    size: { width: number; height: number };
  },
): void {
  state.pointer.set(
    (event.offsetX / state.size.width) * 2 - 1,
    -(event.offsetY / state.size.height) * 2 + 1,
  );
  state.raycaster.setFromCamera(state.pointer, state.camera);
  state.raycaster.far = Infinity;
}

/** The three auxiliary views, in the order they are laid out. */
const AUXILIARY: AnatomicalView[] = ["anterior", "left", "superior"];

/** Headroom around the framed set, so it does not touch the panel edges. */
const FRAMING = 1.35;

/** How often the framing is recomputed, in milliseconds. */
const REFRAME_MS = 400;

/**
 * Where each panel sits, as fractions of the canvas.
 *
 * WebGL's viewport origin is the bottom left, so the main panel — which reads
 * as the top left — is the one at `y: 0.5`. A 2×2 split gives every panel the
 * canvas's own aspect ratio, which is why the main camera needs no adjustment
 * at all: it is the same camera, framing the same thing, in a smaller box.
 */
const QUADRANTS = {
  main: { x: 0, y: 0.5 },
  anterior: { x: 0.5, y: 0.5 },
  left: { x: 0, y: 0 },
  superior: { x: 0.5, y: 0 },
} as const;

/** The world-space box around everything currently drawn. */
function visibleBounds(scene: THREE.Scene): THREE.Box3 | null {
  const box = new THREE.Box3();
  let found = false;
  const each = new THREE.Box3();

  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    each.setFromObject(mesh);
    if (each.isEmpty()) return;
    box.union(each);
    found = true;
  });

  return found ? box : null;
}

export function StudyViews() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const setEvents = useThree((state) => state.setEvents);
  // Read through `get` rather than subscribed to. Selecting `events.compute`
  // and then writing to it is a loop: the write changes the value, the value
  // re-runs the effect, the effect writes again. React caught it as "maximum
  // update depth exceeded" and took the canvas down with it.
  const get = useThree((state) => state.get);

  // One orthographic camera per auxiliary view. Orthographic because these are
  // anatomical views: an "anterior view" with perspective foreshortening is a
  // photograph of the front, not the plate an atlas would print.
  const cameras = useMemo(
    () =>
      Object.fromEntries(
        AUXILIARY.map((view) => [view, new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200)]),
      ) as Record<AnatomicalView, THREE.OrthographicCamera>,
    [],
  );

  const framed = useRef(0);

  useEffect(() => {
    // Whatever this component did to the renderer, undone. Without it the
    // single view keeps drawing into a quarter of the canvas — the exact
    // regression the flag exists to make impossible.
    // `renderer.info` clears itself at the top of every `render()`, so with four
    // renders a frame it would report the last panel and not the frame. Taking
    // the reset over is what makes the dev probe tell the truth here: without
    // it the readout showed a quarter of the real draw calls, which is the one
    // number this whole experiment is being judged on.
    gl.info.autoReset = false;

    return () => {
      gl.info.autoReset = true;
      gl.setScissorTest(false);
      gl.setViewport(0, 0, size.width, size.height);
      gl.setScissor(0, 0, size.width, size.height);
    };
  }, [gl, size.width, size.height]);

  useEffect(() => {
    /**
     * Where the pointer is, expressed for a camera that owns a quarter of the
     * canvas rather than all of it.
     *
     * React Three Fiber computes normalised device coordinates across the whole
     * drawing buffer, because ordinarily one camera fills it. Split into
     * quadrants that assumption puts the ray in the wrong place everywhere: the
     * first build of this selected structures with the cursor well outside them,
     * which is exactly the failure it looks like.
     *
     * Every pointer interaction in the viewport funnels through here — hover,
     * the depth stack, click selection and the right-click menu all read the
     * raycaster this sets up — so one correction covers them all.
     */
    const previousCompute = get().events.compute;
    const previousFar = get().raycaster.far;

    setEvents({
      compute: (event, state) => {
        const half = { width: state.size.width / 2, height: state.size.height / 2 };
        const inside = event.offsetX < half.width && event.offsetY < half.height;

        state.pointer.set(
          (event.offsetX / half.width) * 2 - 1,
          -(event.offsetY / half.height) * 2 + 1,
        );
        state.raycaster.setFromCamera(state.pointer, state.camera);

        // Only the interactive panel may be pointed at. A negative far plane is
        // the cheapest guaranteed miss: every candidate is further away than
        // that, so the three read-only panels report nothing rather than
        // reporting whatever the main camera would have hit behind them.
        state.raycaster.far = inside ? Infinity : -1;
      },
    });

    return () => {
      // Both of these must be put back, and the first version put back neither.
      //
      // R3F leaves `compute` undefined until something sets it, so there is
      // often nothing to restore — and the first attempt read that as "nothing
      // to do" and left *this* function installed. Single view then went on
      // mapping the pointer into a quadrant that no longer existed, and the
      // cursor selected nothing anywhere. Restoring the default explicitly is
      // the difference between skipping the work and doing it.
      setEvents({ compute: previousCompute ?? fullCanvasCompute });
      // And the guard below writes `far` on every event, so whatever it was on
      // the last pointer move before the mode was switched off is what it
      // stays at. If that was the miss-everything value, nothing is clickable.
      get().raycaster.far = previousFar;
    };
  }, [setEvents, get]);

  useFrame(({ gl: renderer, scene: graph, camera }) => {
    // Once per frame rather than once per render, so the counters add the four
    // passes together instead of overwriting each other.
    renderer.info.reset();

    const bounds = reframe(graph);
    if (!bounds) {
      // Nothing visible to frame — mid-load, or everything hidden. Draw the
      // main view across the whole canvas rather than returning: this callback
      // owns the render loop, so a frame it declines to draw is a frame nobody
      // draws, and the reader gets an empty canvas with no explanation.
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.width, size.height);
      renderer.render(graph, camera);
      return;
    }
    renderer.setScissorTest(true);

    for (const [view, cell] of Object.entries(QUADRANTS)) {
      const width = size.width / 2;
      const height = size.height / 2;
      const x = cell.x * size.width;
      const y = cell.y * size.height;

      renderer.setViewport(x, y, width, height);
      renderer.setScissor(x, y, width, height);
      renderer.render(graph, view === "main" ? camera : cameras[view as AnatomicalView]);
    }

    renderer.setScissorTest(false);
    // Left as it was found, every frame rather than only on unmount: anything
    // else that draws — a screenshot, a future overlay pass — must not have to
    // know this component exists.
    renderer.setViewport(0, 0, size.width, size.height);
    renderer.setScissor(0, 0, size.width, size.height);
  }, 1);

  /**
   * Point the auxiliary cameras at whatever is on screen, on a slow interval.
   *
   * Not every frame: the framing only changes when the isolated set does, and
   * `setFromObject` walks a geometry's vertices. Four times a second is
   * imperceptible for a change the reader makes by clicking, and it also
   * catches the explode animation settling without watching for it.
   */
  function reframe(graph: THREE.Scene): THREE.Box3 | null {
    const now = performance.now();
    const due = now - framed.current > REFRAME_MS;
    const bounds = visibleBounds(graph);
    if (!bounds) return null;
    if (!due) return bounds;

    framed.current = now;

    const centre = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 1e-4);
    const extent = radius * FRAMING;
    const aspect = size.width / size.height;

    // Read off the atlas rather than assumed, the same way the viewpoint bar
    // does it: which end of X is the body's left depends on the export, and a
    // panel labelled "left" showing the right side is not a cosmetic bug.
    const handle = getViewerHandle();
    const sign = handle ? lateralSign(handle.centres.keys(), handle.centres) : 1;

    for (const view of AUXILIARY) {
      const camera = cameras[view];
      camera.left = -extent * aspect;
      camera.right = extent * aspect;
      camera.top = extent;
      camera.bottom = -extent;
      camera.near = 0.01;
      camera.far = radius * 20 + 10;

      // Anterior is +Z, so pointing it up the screen is what makes a superior
      // view read the way an atlas plate does.
      camera.up.set(0, view === "superior" ? 0 : 1, view === "superior" ? 1 : 0);
      camera.position
        .copy(centre)
        .add(viewDirection(view, sign).multiplyScalar(radius * 4 + 1));
      camera.lookAt(centre);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }

    return bounds;
  }

  return null;
}
