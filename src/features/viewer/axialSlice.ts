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
 * The direction the section is looked at from: straight down.
 *
 * Named because the lighting needs it as well as the camera does, and two
 * places agreeing by coincidence is how a section ends up lit from behind.
 */
export const SLICE_FORWARD = new THREE.Vector3(0, -1, 0);

/**
 * How big the enlarged section is allowed to be, as CSS.
 *
 * Square, and limited by whichever edge runs out first: the height, or the
 * width left over once the column of reading material beside it has taken its
 * own. A square measured against the height alone looks right on this desktop
 * and runs off the side of a wide, short window.
 *
 * The 23rem is that column plus the gap and the padding around it, with a
 * little slack. It is stated here rather than guessed twice because the layout
 * and this number have to agree or the picture pushes the words off the screen.
 */
export const SECTION_WINDOW = "min(90vh, calc(100vw - 23rem))";

/**
 * A fresh section is wanted, from somewhere outside the render loop.
 *
 * The wheel lives in the DOM overlay and the pass lives inside the canvas, and
 * between them is a boundary React does not cross for free — the same one the
 * picture itself already crosses through `AXIAL_CANVAS`. A counter rather than
 * a flag, so two requests in a row are two sections; the scene compares it once
 * a frame, which costs an integer.
 */
export const SECTION_WANTED = { value: 0 };

/** Ask for one. See `SECTION_WANTED`. */
export function wantSection(): void {
  SECTION_WANTED.value += 1;
}

/**
 * How far a wheel has to turn before the plane moves one step.
 *
 * A notch of a mouse wheel reports a hundred on every browser this runs in, so
 * a notch is a step and a step is a centimetre. A trackpad reports small
 * amounts continuously instead, which is why this accumulates rather than
 * counting events: otherwise one flick of two fingers would cross the thorax.
 */
export const WHEEL_PER_STEP = 100;

/**
 * How many whole steps a wheel gesture has earned, and what to carry forward.
 *
 * Reversing direction throws the carry away rather than spending it. Somebody
 * who has scrolled most of the way towards the next level and then changes
 * their mind means *back*, and making them fight eighty units of leftover
 * intent before the plane moves the other way feels like a stuck control.
 */
export function wheelSteps(
  carried: number,
  deltaY: number,
  perStep: number = WHEEL_PER_STEP,
): { steps: number; carry: number } {
  const reversed = carried !== 0 && deltaY !== 0 && carried > 0 !== deltaY > 0;
  const total = reversed ? deltaY : carried + deltaY;
  const steps = Math.trunc(total / perStep);
  return { steps, carry: total - steps * perStep };
}

/**
 * How long the wheel has to be quiet before the section is retaken.
 *
 * # Why the picture does not follow every notch
 *
 * Measured: one section is 8 ms of render and 7 ms of readback. A wheel spun
 * hard produces twenty notches a second, and paying that per notch is three
 * hundred milliseconds of work a second for twenty pictures nobody looked at —
 * on the slowest machine here it would be a freeze.
 *
 * The plane itself moves on every notch, immediately, because moving it is
 * free: the ring travels, the body lights, the crossing list follows. Only the
 * section waits, and it waits for the gesture to end rather than for a clock,
 * so the cost is one picture per gesture however hard the wheel is spun.
 */
export const WHEEL_SETTLE_MS = 130;

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
 * How low the torch can be brought, in radians above the horizon.
 *
 * Not zero. A light exactly in the plane of the section lights the walls it
 * faces and nothing else at all, and the reader who pushed it there sees a
 * picture that has gone out rather than a picture raked hard.
 */
const TORCH_LOWEST = (8 * Math.PI) / 180;

/**
 * Where the torch stands, from where the pointer is over the picture.
 *
 * # The mapping, and why this one
 *
 * The centre is overhead and the rim is almost level with the section, so
 * pushing the cursor away from the middle lowers the light and rakes it across
 * the surfaces. That is the gesture somebody uses on a real specimen: they do
 * not move a lamp in three numbers, they tilt the thing until the light catches
 * the detail they are chasing.
 *
 * The light comes *from* the cursor's side, which is the half of this that has
 * to be right. A light that receded as the cursor approached would be a mirror
 * of the intended control and would read as broken without ever being wrong
 * enough to name.
 *
 * `u` and `v` are the pointer's offset from the centre, each from -1 at one
 * edge to 1 at the other, with `v` positive downwards as screen coordinates
 * are. In the section's own frame that is world +x to the right and world +z
 * downwards, with +y overhead — the frame `SLICE_UP` and `SLICE_FORWARD` set.
 */
export function torchDirection(u: number, v: number): THREE.Vector3 {
  const reach = Math.min(1, Math.hypot(u, v));
  const overhead = new THREE.Vector3(0, 1, 0);
  if (reach < 1e-6) return overhead;

  const towards = new THREE.Vector3(u, 0, v).normalize();
  const above = TORCH_LOWEST + (1 - reach) * (Math.PI / 2 - TORCH_LOWEST);
  return towards
    .multiplyScalar(Math.cos(above))
    .addScaledVector(overhead, Math.sin(above))
    .normalize();
}

/**
 * Where the torch is pointing now, or null when it is switched off.
 *
 * Module-level for the same reason the canvas is: the pointer is in the DOM
 * overlay and the light is inside the render loop, and a re-render of the scene
 * per mouse move to carry a vector across is precisely the cost this whole
 * panel was built to avoid.
 */
export const TORCH: { value: THREE.Vector3 | null } = { value: null };

/**
 * How often the section may be retaken while the torch is being moved.
 *
 * Measured: a section is about 15 ms, and the viewport's own frame is about 24
 * on this machine. Retaking on every pointer move would put the two in the same
 * frame continuously and halve the rate; at this interval the extra work is
 * roughly a quarter of the time and the light still follows the hand closely
 * enough to feel attached to it.
 *
 * A reader on a slow machine pays this only while the pointer is over the
 * picture, and only with the torch switched on, which is why it is a switch.
 */
export const TORCH_INTERVAL_MS = 70;

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
