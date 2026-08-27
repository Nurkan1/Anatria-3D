/**
 * What one frame actually cost, sampled from the renderer itself.
 *
 * # Why this exists before any multi-view code
 *
 * The case for and against a four-viewport mode rests on one number nobody has
 * ever read on this application: how many draw calls a frame really makes, and
 * how much of the frame budget they take. Every figure in the feasibility note
 * was derived from the manifest and the source — 3,478 structures, one mesh and
 * one material each — and derived figures are how a plan gets approved and then
 * discovers reality afterwards.
 *
 * So this lands first, and it is useful whether or not `Study Views` is ever
 * built: it is also the only honest basis for the minimum-hardware claim the
 * README makes.
 *
 * # A note on the filename
 *
 * This is `renderSample`, not `renderStats`, because `RenderStats.tsx` sits
 * beside it and Windows resolves the two as the same file. TypeScript reported
 * it as the component module having no exports, which is a confusing way to be
 * told about a case collision.
 *
 * # Why a module-level record rather than state
 *
 * The same reason `viewerBridge` is one. These values change sixty times a
 * second and are read by a panel that writes straight to the DOM. Routing them
 * through React would mean sixty renders a second to update some digits, which
 * would itself become the thing being measured.
 */

/** How many frames the rolling window keeps. Two seconds at 60fps. */
const WINDOW = 120;

export interface RenderSample {
  /** Draw calls in the last completed frame. */
  calls: number;
  triangles: number;
  /** Geometries and textures resident on the GPU. */
  geometries: number;
  textures: number;
  /** Compiled shader programs — one per distinct material configuration. */
  programs: number;
  /**
   * Meshes with `visible === true` in the scene right now.
   *
   * The number that predicts what a second viewport would cost, because
   * isolation hides rather than unmounts: the scene always holds every
   * structure of every mounted system, and only this subset is drawn.
   */
  visible: number;
  /** Everything in the scene, drawn or not. */
  objects: number;
  /** Canvases in the document. The single-context acceptance criterion. */
  canvases: number;
  /** JS heap in MB, where the engine reports it. Null in engines that do not. */
  heapMb: number | null;
  /** Mean frame interval across the window, in milliseconds. */
  meanMs: number;
  /**
   * The frame time 95% of frames come in under.
   *
   * Reported instead of a best case because a mode that holds 60fps and stalls
   * every twentieth frame is not a mode that holds 60fps. This is the figure a
   * 30fps target should be judged against.
   */
  p95Ms: number;
}

export const EMPTY_SAMPLE: RenderSample = {
  calls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
  visible: 0,
  objects: 0,
  canvases: 0,
  heapMb: null,
  meanMs: 0,
  p95Ms: 0,
};

/** The live record. Written by the probe inside the canvas, read by the panel. */
export const sample: RenderSample = { ...EMPTY_SAMPLE };

const frames: number[] = [];
let next = 0;

/** Record one frame interval and refresh the derived timings. */
export function noteFrame(ms: number): void {
  // A tab that was backgrounded returns with a multi-second interval that would
  // poison the window for the next two seconds. Nobody was looking at those
  // frames, so they are not evidence about anything.
  if (ms > 1000) return;

  if (frames.length < WINDOW) frames.push(ms);
  else {
    frames[next] = ms;
    next = (next + 1) % WINDOW;
  }

  let total = 0;
  for (const frame of frames) total += frame;
  sample.meanMs = total / frames.length;

  const sorted = [...frames].sort((a, b) => a - b);
  sample.p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

/** Forget the window. Called when the scene changes enough to invalidate it. */
export function resetFrames(): void {
  frames.length = 0;
  next = 0;
  sample.meanMs = 0;
  sample.p95Ms = 0;
}

/** Frames per second implied by the mean interval. */
export function fps(of: RenderSample): number {
  return of.meanMs > 0 ? 1000 / of.meanMs : 0;
}

/**
 * What the heap reports, in MB, or null.
 *
 * Non-standard and Chromium-only, which is enough here: the shipped application
 * is WebView2 on Windows and WebKitGTK on Linux, and a number on one of the two
 * is better than a number on neither.
 */
export function heapMb(): number | null {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  const used = perf.memory?.usedJSHeapSize;
  return typeof used === "number" ? used / 1048576 : null;
}
