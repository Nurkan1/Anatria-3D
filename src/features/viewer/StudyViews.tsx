import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { lateralSign, viewDirection, type AnatomicalView } from "./cameraViews";
import { useSceneStore } from "@/stores/sceneStore";
import { useStudyViewsStore } from "@/stores/studyViewsStore";
import { domRect, MAIN, mainRect, panelLayout, type PanelRect } from "./studyLayout";

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

/**
 * The same, for a camera that owns only part of the canvas.
 *
 * Which part is not assumed. It is read from `mainRect`, the same function the
 * render loop lays the panels out with, so a layout that changes because the
 * reader switched a view off cannot leave the pointer mapped to where the panel
 * used to be. That divergence is the whole reason the layout is computed in one
 * place, and this is the call site that would have suffered from it.
 *
 * Outside the panel the raycaster gets a negative far plane, which is the
 * cheapest guaranteed miss: every candidate is further away than that, so the
 * read-only panels report nothing rather than reporting whatever the main
 * camera would have hit behind them.
 */
function quadrantCompute(
  event: { offsetX: number; offsetY: number },
  state: {
    pointer: THREE.Vector2;
    raycaster: THREE.Raycaster;
    camera: THREE.Camera;
    size: { width: number; height: number };
  },
): void {
  const panel = domRect(mainRect(useStudyViewsStore.getState().active));
  const box = {
    left: panel.left * state.size.width,
    top: panel.top * state.size.height,
    width: panel.width * state.size.width,
    height: panel.height * state.size.height,
  };
  const x = event.offsetX - box.left;
  const y = event.offsetY - box.top;
  const inside = x >= 0 && y >= 0 && x < box.width && y < box.height;

  state.pointer.set((x / box.width) * 2 - 1, -(y / box.height) * 2 + 1);
  state.raycaster.setFromCamera(state.pointer, state.camera);
  state.raycaster.far = inside ? Infinity : -1;
}

/**
 * Keeps the pointer mapping in step with the layout. Belongs inside the
 * `Canvas`, and stays mounted whether the split is on or off.
 *
 * # Why this is not part of `StudyViews`
 *
 * It was, and it left the viewport unable to select anything. A component that
 * installs a pointer mapping on mount and restores it on unmount depends on its
 * own cleanup running correctly — and when hot module replacement swaps the
 * file, the cleanup that runs is the *old* version's. One release with a faulty
 * cleanup and the broken mapping is installed with nothing left mounted to take
 * it away.
 *
 * Mounted always and *asserting* the right mapping for the current mode, there
 * is no cleanup to get wrong. Whatever state the store was left in, the next
 * render puts the correct function back.
 */
export function PointerRouting({ splitting }: { splitting: boolean }) {
  const setEvents = useThree((state) => state.setEvents);

  useEffect(() => {
    setEvents({ compute: splitting ? quadrantCompute : fullCanvasCompute });
  }, [splitting, setEvents]);

  return null;
}

/**
 * Point a perspective camera at a panel of the given shape.
 *
 * Guarded on the value because `updateProjectionMatrix` is not free and this
 * runs inside the render loop: the aspect only changes when the window is
 * resized or a view is switched, and doing the work on every frame of a still
 * scene would be paying for nothing sixty times a second.
 */
function matchAspect(camera: THREE.Camera, aspect: number): void {
  const perspective = camera as THREE.PerspectiveCamera;
  if (!perspective.isPerspectiveCamera) return;
  if (Math.abs(perspective.aspect - aspect) < 1e-6) return;
  perspective.aspect = aspect;
  perspective.updateProjectionMatrix();
}

/** The three auxiliary views, in the order they are laid out. */
const AUXILIARY: AnatomicalView[] = ["anterior", "left", "superior"];

/**
 * The least headroom the focused set is ever given, as a multiple of its radius.
 *
 * A floor rather than the framing rule. The panels take their scale from the
 * main view, so a reader who has zoomed the main camera inside the structure
 * would otherwise get three panels cropped to the same sliver. Below this they
 * stop following the main view down.
 */
const MIN_HEADROOM = 1.15;

/** How often the framing is recomputed, in milliseconds. */
const REFRAME_MS = 400;

/**
 * The box the auxiliary views should frame.
 *
 * # Why not simply everything on screen
 *
 * Because everything on screen is usually far more than the reader is looking
 * at. Isolating the brain and asking the assistant about the visual pathway
 * leaves 291 structures visible, 264 of them nerves running the length of the
 * body — so a box around all of it frames the body, and the three panels show
 * a brain the size of a full stop. Correct, and useless.
 *
 * So the panels follow attention rather than contents, in this order:
 *
 * 1. **What the reader selected.** The most deliberate act available: they
 *    clicked it.
 * 2. **What the assistant lit.** When nothing is selected, the pathway or set
 *    it is pointing at is what the question was about.
 * 3. **Everything drawn.** No selection and no answer in progress — the
 *    isolated set is all the intent there is.
 *
 * A named set that turns out to have nothing visible in it falls through to the
 * next rule rather than framing nothing: a structure can be selected and then
 * hidden, and three empty panels would be a worse answer than three wide ones.
 */
function focusBounds(scene: THREE.Scene): THREE.Box3 | null {
  const { selectedOrganIds, illuminated } = useSceneStore.getState();

  for (const wanted of [selectedOrganIds, illuminated, null]) {
    const only = wanted && wanted.length > 0 ? new Set(wanted) : null;
    if (wanted !== null && only === null) continue;

    const box = boundsOf(scene, only);
    if (box) return box;
  }

  return null;
}

/** The union box of every visible mesh, optionally restricted to a set of ids. */
function boundsOf(scene: THREE.Scene, only: Set<string> | null): THREE.Box3 | null {
  const box = new THREE.Box3();
  const each = new THREE.Box3();
  let found = false;

  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    // The identifier the atlas knows it by, put there by `OrganMesh` so a raw
    // intersection can be traced back without React context.
    if (only && !only.has(String(mesh.userData.organId))) return;

    each.setFromObject(mesh);
    if (each.isEmpty()) return;
    box.union(each);
    found = true;
  });

  return found ? box : null;
}

export function StudyViews() {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const active = useStudyViewsStore((state) => state.active);

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

  const framed = useRef(-Infinity);
  const cachedBounds = useRef<THREE.Box3 | null>(null);
  const focusState = useRef<ReturnType<typeof useSceneStore.getState> | null>(null);
  const geometryRevision = useRef<number | undefined>(undefined);
  const framingLayout = useMemo(() => ({ active, width: size.width, height: size.height }), [active, size.width, size.height]);
  const lastLayout = useRef<typeof framingLayout | null>(null);

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
      // And the reader's camera back to the shape of the whole canvas. React
      // Three Fiber only revisits this on a resize, so a camera left matched to
      // a half-width panel would keep that projection over the full viewport
      // until the window happened to change size — the model subtly stretched,
      // with nothing on screen to explain it.
      matchAspect(camera, size.width / size.height);
    };
  }, [gl, camera, size.width, size.height]);

  useFrame(({ gl: renderer, scene: graph, camera }) => {
    // Once per frame rather than once per render, so the counters add the four
    // passes together instead of overwriting each other.
    renderer.info.reset();

    const layout = panelLayout(active);
    const bounds = reframe(graph, camera, layout);
    if (!bounds) {
      // Nothing visible to frame — mid-load, or everything hidden. Draw the
      // main view across the whole canvas rather than returning: this callback
      // owns the render loop, so a frame it declines to draw is a frame nobody
      // draws, and the reader gets an empty canvas with no explanation.
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.width, size.height);
      matchAspect(camera, size.width / size.height);
      renderer.render(graph, camera);
      return;
    }
    renderer.setScissorTest(true);

    for (const panel of layout) {
      const x = panel.x * size.width;
      const y = panel.y * size.height;
      const width = panel.width * size.width;
      const height = panel.height * size.height;

      renderer.setViewport(x, y, width, height);
      renderer.setScissor(x, y, width, height);
      // The reader's own camera is a perspective one and React Three Fiber
      // keeps its aspect matched to the whole canvas. That happened to be right
      // while every panel was a quarter — a 2×2 cell has the canvas's own
      // proportions — and stops being right the moment a panel is half the
      // width at full height. Corrected here, every frame, because this
      // callback owns the render and nothing else can know the panel it is
      // about to draw into.
      if (panel.id === MAIN) matchAspect(camera, width / height);
      renderer.render(graph, panel.id === MAIN ? camera : cameras[panel.id]);
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
   * `setFromObject` inspects the mesh bounds. Every 400 ms is
   * imperceptible for a change the reader makes by clicking, and it also
   * catches the explode animation settling without watching for it.
   */
  function reframe(
    graph: THREE.Scene,
    main: THREE.Camera,
    layout: PanelRect[],
  ): THREE.Box3 | null {
    const now = performance.now();
    const state = useSceneStore.getState();
    const previous = focusState.current;
    const revision = getViewerHandle()?.geometryRevision;
    const changed = previous === null ||
      previous.selectedOrganIds !== state.selectedOrganIds || previous.illuminated !== state.illuminated ||
      previous.isolatedOrganIds !== state.isolatedOrganIds || previous.hiddenSystems !== state.hiddenSystems ||
      previous.organs !== state.organs || geometryRevision.current !== revision || lastLayout.current !== framingLayout;
    if (!changed && now - framed.current < REFRAME_MS) return cachedBounds.current;
    framed.current = now;
    focusState.current = state;
    geometryRevision.current = revision;
    lastLayout.current = framingLayout;
    const bounds = focusBounds(graph);
    cachedBounds.current = bounds;
    if (!bounds) return null;

    const centre = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 1e-4);
    const aspect = size.width / size.height;

    /**
     * How much world the panels show, taken from the main view rather than
     * from the structure.
     *
     * Framing each panel to its contents was the first attempt and it broke the
     * comparison: selecting something small — an optic chiasm — filled all three
     * panels with a pale shape at a scale nothing else on screen shared, and the
     * reader lost every reference they had. Four panels of one thing are only
     * worth having if the four agree about how big it is.
     *
     * So the panels show the same volume the main camera does, centred on what
     * has the reader's attention. The main view stays the ruler; the auxiliary
     * views are three more angles on it, not three separate framings.
     */
    const perspective = main as THREE.PerspectiveCamera;
    const fov = typeof perspective.fov === "number" ? perspective.fov : 45;
    const matched = main.position.distanceTo(centre) * Math.tan((fov * Math.PI) / 360);
    const extent = Math.max(matched, radius * MIN_HEADROOM);

    // Read off the atlas rather than assumed, the same way the viewpoint bar
    // does it: which end of X is the body's left depends on the export, and a
    // panel labelled "left" showing the right side is not a cosmetic bug.
    const handle = getViewerHandle();
    const sign = handle ? lateralSign(handle.centres.keys(), handle.centres) : 1;

    for (const view of AUXILIARY) {
      const camera = cameras[view];
      // Its own panel's proportions, not the canvas's. A view switched off has
      // no panel and keeps whatever it had — it is not being drawn, and it will
      // be reframed on the first pass after it comes back.
      const panel = layout.find((each) => each.id === view);
      const shape = panel
        ? (panel.width * size.width) / (panel.height * size.height)
        : aspect;
      camera.left = -extent * shape;
      camera.right = extent * shape;
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
