import * as THREE from "three";

import { DISCLAIMER } from "./exportView";

/**
 * The geometry of an axial slice, worked out before anything is drawn.
 *
 * # Why this is a slab and not a plane
 *
 * A plane has no thickness and a renderer draws nothing at all where a surface
 * is exactly edge-on. What reads as a section is a *slab*: everything between
 * two parallel cuts a few millimetres apart, seen from directly above. That is
 * also what a CT slice is, and why one has a thickness printed on it.
 *
 * # What this will never be, and it is better to say so now
 *
 * **The cut surfaces will be open.** Clipping in three.js removes fragments; it
 * does not close the hole it leaves, so a clipped liver is a liver-shaped shell
 * with its inside showing rather than a filled cross-section. Capping needs
 * either a stencil pass or generated cap geometry, and both cost more than the
 * slice itself. Expect an outline, not a radiograph.
 */

/** Half the slab's thickness, in model units. Metres, on this atlas. */
export const SLAB_HALF_THICKNESS = 0.004;

/**
 * The two planes that keep only what lies within the slab.
 *
 * three keeps a fragment where `normal · p + constant > 0`, so the pair reads:
 * below the top cut, and above the bottom one. Getting the sign wrong here
 * shows nothing at all rather than showing the wrong thing, which is a
 * mercifully loud failure.
 */
export function slabPlanes(at: number, half = SLAB_HALF_THICKNESS): THREE.Plane[] {
  return [
    new THREE.Plane(new THREE.Vector3(0, -1, 0), at + half),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), half - at),
  ];
}

/**
 * The other way to cut, and it answers a different question.
 *
 * One plane, keeping everything *below* the cut. Seen from above you are then
 * looking at the top surfaces of what is left, which read as solid volumes
 * rather than as the open rings a thin slab gives — the body opened at a level,
 * which is what an anatomical cut looks like in a dissecting room.
 *
 * It costs exactly the same: one plane instead of two, the same meshes, the
 * same draw calls. What it gives up is truthfulness about depth — structures
 * below the plane are visible where the nearest surface happens to be theirs,
 * so it is a view *through* the cut rather than a section *at* it. The slab is
 * the honest section; this one is the legible dissection. Both are worth
 * having, which is why both are here.
 */
export function cutPlanes(at: number): THREE.Plane[] {
  return [new THREE.Plane(new THREE.Vector3(0, -1, 0), at)];
}

/**
 * Where the camera stands to look down at the slab, and how wide it sees.
 *
 * Orthographic, because a perspective view of a section is a section plus a
 * lie: structures further from the lens would come out smaller, and comparing
 * left with right is most of what a section is for.
 *
 * # Why the frame follows the contents rather than the body
 *
 * It framed the whole body's width at every height, which is the radiological
 * convention and was the wrong call here: at the ankles two legs occupied a
 * sixth of a picture sized for outstretched arms, and on a laptop that is a
 * detail nobody can read. The caller passes the box it wants framed — what the
 * slab actually contains — and the scale is published beside the image so
 * sizes stay comparable even though the magnification does not.
 */
/**
 * Never zoom in past this, in metres of half-width.
 *
 * A slab containing one small structure would otherwise fill the frame with a
 * magnified sliver, which reads as an error rather than as a close-up. Ten
 * centimetres across is about the narrowest picture of a body that still looks
 * like a picture of a body.
 */
export const SLICE_MIN_HALF = 0.05;

export function sliceFraming(
  bounds: THREE.Box3,
  at: number,
  margin = 1.06,
): { position: THREE.Vector3; target: THREE.Vector3; halfWidth: number; halfDepth: number } {
  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  // Square, from the larger of the two, so nothing is stretched and the image
  // can be a square texture without letterboxing.
  const half = Math.max((Math.max(size.x, size.z) / 2) * margin, SLICE_MIN_HALF);
  return {
    // Just above the slab rather than far away: an orthographic camera does not
    // care about distance, and staying close keeps the depth range tight.
    position: new THREE.Vector3(centre.x, at + 0.5, centre.z),
    target: new THREE.Vector3(centre.x, at, centre.z),
    halfWidth: half,
    halfDepth: half,
  };
}

/**
 * The up vector that puts the front of the body at the top of the image.
 *
 * Looking straight down, "up" in the picture is a direction in the horizontal
 * plane and has to be chosen. Anterior-up is the convention every axial image a
 * reader has seen uses, and −Z is anterior on this atlas — the same fact
 * `viewDirection` relies on for the anterior viewpoint.
 */
export const SLICE_UP = new THREE.Vector3(0, 0, -1);

/**
 * Whether magnifying this far draws source pixels bigger than screen pixels.
 *
 * The enlarged view smooths the picture right up until it runs out of source,
 * and then stops smoothing. Past native size a smooth scale is an invention —
 * a soft grey edge where the data has a hard one — while blocks at least tell
 * the reader they have reached the end of what was actually measured.
 *
 * This was the constant `zoom > 2`, and a constant is wrong here twice over:
 * the window is sized as a fraction of the viewport, so it is a different
 * number of pixels on every machine, and the source has now changed size once.
 * Comparing the two numbers is the same rule stated truthfully.
 */
export function pastNativeSize(zoom: number, frameWidthPx: number, sourcePx: number): boolean {
  if (frameWidthPx <= 0 || sourcePx <= 0) return false;
  return (zoom * frameWidthPx) / sourcePx > 1;
}

/**
 * Where the picture goes, once it has been read back.
 *
 * A module-level handle rather than a prop, because the two halves live on
 * opposite sides of a boundary React does not cross for free: the pixels are
 * produced inside the canvas, by a frame callback, and the picture is shown in
 * the DOM overlay beside the controls. The same arrangement the crossing
 * readout and the sweep position already use.
 *
 * Null whenever the panel is not mounted, which is most of the time, and the
 * producer checks rather than assumes.
 */
export const AXIAL_CANVAS: { value: HTMLCanvasElement | null } = { value: null };

/**
 * Paint a slice that was read out of the GPU.
 *
 * **The rows arrive upside down**, and that is not a quirk to work around
 * quietly: WebGL numbers its rows from the bottom and a canvas numbers them
 * from the top, so a picture copied straight across is a body lying the wrong
 * way up — which on an axial slice is a silent error, because anterior and
 * posterior look plausible either way. Flipping here is the correction, and
 * `SLICE_UP` is what makes the flipped result anterior-up.
 */
export function paintSlice(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  size: number,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(size, size);
  const row = size * 4;
  for (let y = 0; y < size; y++) {
    const from = (size - 1 - y) * row;
    image.data.set(pixels.subarray(from, from + row), y * row);
  }
  context.putImageData(image, 0, 0);
  markSlice(context, size);
  // Stored *after* the mark, so anything that puts this back gets the whole
  // picture rather than an unmarked copy of it.
  last = context.getImageData(0, 0, size, size);
}

/**
 * The same line the exported image carries, on the section too.
 *
 * A slice is the frame of this application most likely to be photographed and
 * passed on — it looks like a scan, which is exactly why it must say what it is
 * not. The wording is imported rather than retyped: two disclaimers that drift
 * apart are worse than one, and this one is a regulatory statement rather than
 * a caption.
 */
function markSlice(context: CanvasRenderingContext2D, size: number): void {
  const height = Math.round(size * 0.075);
  context.fillStyle = "rgba(2, 6, 23, 0.82)";
  context.fillRect(0, size - height, size, height);
  context.fillStyle = "rgba(148, 163, 184, 0.9)";
  context.font = `${Math.round(height * 0.46)}px system-ui, "Segoe UI", sans-serif`;
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillText(DISCLAIMER, Math.round(size * 0.02), size - height / 2);
}

/**
 * The last section drawn, kept so a new canvas can show it immediately.
 *
 * Enlarging the panel mounts a different element, and a slice that went blank
 * the moment somebody asked to see it properly would be the wrong answer to
 * the only question they asked. The image is kept rather than the pixels
 * because it is already flipped and already allocated — the producer's own
 * buffer is reused every run and would be overwritten underneath us.
 */
let last: ImageData | null = null;

/** Put the last section back on a canvas that has just appeared. */
export function restoreSlice(canvas: HTMLCanvasElement): void {
  if (!last) return;
  const context = canvas.getContext("2d");
  context?.putImageData(last, 0, 0);
}

/** For tests, and for a mode being switched off with nothing to remember. */
export function forgetSlice(): void {
  last = null;
}
