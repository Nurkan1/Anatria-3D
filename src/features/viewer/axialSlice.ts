import * as THREE from "three";

import { DISCLAIMER, encodeImageBytes } from "./exportView";

/**
 * The geometry of a section — axial or frontal — worked out before anything
 * is drawn.
 *
 * # Why this is a slab and not a plane
 *
 * A plane has no thickness and a renderer draws nothing at all where a surface
 * is exactly edge-on. What reads as a section is a *slab*: everything between
 * two parallel cuts a few millimetres apart, seen square-on. That is
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

/** Which section a picture is: across the body at a height, or through it at a depth. */
export type SectionPlaneName = "axial" | "front";

/**
 * A section plane, described once.
 *
 * # Why this exists
 *
 * The section began as axial, and every part of it — the cuts, the framing, the
 * camera, the painter, the caliper, the torch — assumed a horizontal plane seen
 * from above. A frontal section needs every one of those parts at right angles,
 * and writing them twice is how the two would drift apart: exactly how the axial
 * picture came to be drawn upside down while every piece agreed with every other.
 *
 * So a plane is three facts, and everything reads them:
 *
 * - `normal`, the world axis the plane is perpendicular to. The sweep travels
 *   along it, the slab is cut across it, and the camera stands on its positive
 *   side: above the body for axial, in front of it for frontal.
 * - `vertical`, the world axis the picture's up and down run along. Across is
 *   world X for both planes, so it is not stated.
 * - `cameraUp`, which way along `vertical` the camera's own up points. It is
 *   what decides whether the rows read back from the GPU need turning.
 *
 * Picture coordinates `h` and `v` are world X and world `vertical`, in metres.
 * Anterior is +Z and superior is +Y on both atlases.
 */
export interface SlicePlane {
  readonly name: SectionPlaneName;
  readonly normal: THREE.Vector3;
  readonly vertical: THREE.Vector3;
  readonly cameraUp: 1 | -1;
}

/**
 * Across the body at a height, seen from above.
 *
 * The camera's up is posterior. It was once written as anterior, and every
 * section of 0.2.8 came out upside down under a caption saying otherwise; the
 * picture is turned on its way to the screen instead. See `SliceBasis`.
 */
export const AXIAL_PLANE: SlicePlane = {
  name: "axial",
  normal: new THREE.Vector3(0, 1, 0),
  vertical: new THREE.Vector3(0, 0, 1),
  cameraUp: -1,
};

/** Through the body at a depth, seen from the front, with superior at the top. */
export const FRONT_PLANE: SlicePlane = {
  name: "front",
  normal: new THREE.Vector3(0, 0, 1),
  vertical: new THREE.Vector3(0, 1, 0),
  cameraUp: 1,
};

/** The plane with this name. */
export function slicePlane(name: SectionPlaneName): SlicePlane {
  return name === "front" ? FRONT_PLANE : AXIAL_PLANE;
}

/** The world point at picture coordinates `h`, `v` on the plane at `at`. */
export function planePoint(plane: SlicePlane, h: number, v: number, at: number): THREE.Vector3 {
  return new THREE.Vector3(h, 0, 0)
    .addScaledVector(plane.vertical, v)
    .addScaledVector(plane.normal, at);
}

/** The camera's up vector for a pass on this plane. */
export function cameraUpOf(plane: SlicePlane): THREE.Vector3 {
  return plane.vertical.clone().multiplyScalar(plane.cameraUp);
}

/** Where the camera looks: into the body, against the plane's normal. */
export function cameraForwardOf(plane: SlicePlane): THREE.Vector3 {
  return plane.normal.clone().negate();
}

/**
 * The two planes that keep only what lies within the slab.
 *
 * three keeps a fragment where `normal · p + constant > 0`, so the pair reads,
 * along the plane's normal: short of the far cut, and past the near one. Getting
 * the sign wrong shows nothing at all rather than the wrong thing, which is a
 * mercifully loud failure.
 */
export function slabPlanes(
  plane: SlicePlane,
  at: number,
  half = SLAB_HALF_THICKNESS,
): THREE.Plane[] {
  return [
    new THREE.Plane(plane.normal.clone().negate(), at + half),
    new THREE.Plane(plane.normal.clone(), half - at),
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
export function cutPlanes(plane: SlicePlane, at: number): THREE.Plane[] {
  // Keeps the side the camera is not on — below an axial plane, behind a
  // frontal one — so what is left is seen opened at the plane.
  return [new THREE.Plane(plane.normal.clone().negate(), at)];
}

/**
 * What a section is framed on, and how wide it sees.
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

export function sliceWindowOf(box: THREE.Box3, plane: SlicePlane, margin = 1.06): SliceWindow {
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Square, from the larger of the picture's two extents, so nothing is
  // stretched and the image can be a square texture without letterboxing.
  const half = Math.max(
    (Math.max(size.x, size.dot(plane.vertical)) / 2) * margin,
    SLICE_MIN_HALF,
  );
  return { h: centre.x, v: centre.dot(plane.vertical), half };
}

/**
 * The camera's up vector for the section pass. It points posterior, not anterior.
 *
 * This said −Z was anterior, "the same fact `viewDirection` relies on" — and
 * `viewDirection` says the opposite: the anterior view stands the camera at +Z.
 * So every section up to 0.2.8 was drawn with the spine at the top and the teeth
 * at the bottom, under a caption promising the front was at the top. Found by
 * checking against the teeth, the one thing in a section nobody can mistake.
 *
 * The render is left exactly as it was — the camera, the cut and the lighting
 * all work from above — and the picture is turned on its way to the screen
 * instead, by `SliceBasis`. That is the one place orientation is decided.
 */
export const SLICE_UP = cameraUpOf(AXIAL_PLANE);

/**
 * Which way through the body each axis of the picture runs.
 *
 * `right` is the sign of world X that the picture's +x points along; `down` the
 * sign, along the plane's `vertical`, that its +y — downwards, as screen rows
 * run — points along.
 * Everything that turns a pixel into a place in the body or back reads it from
 * here: the painter, the caliper, the drag, the zoom and the torch. They were
 * five separate assumptions before, which is how the picture could be upside
 * down while every one of them was consistent with every other.
 */
export interface SliceBasis {
  right: 1 | -1;
  down: 1 | -1;
}

/**
 * How a radiologist has it: the patient's left on the viewer's right, and the
 * vertical axis's positive end at the top — anterior on an axial image looked at
 * from the feet, superior on a frontal one. The same two signs serve both.
 *
 * Anterior is +Z on both atlases (the anterior viewpoint stands at +Z), so the
 * picture runs towards −Z going down. Which side of X is the patient's left is
 * not the same on both, which is why it is measured by `lateralSign` from the
 * atlas's own paired structures and handed in here rather than assumed.
 */
export function sliceBasis(leftSign: 1 | -1): SliceBasis {
  return { right: leftSign, down: -1 };
}

/**
 * The direction the section is looked at from: straight down.
 *
 * Named because the lighting needs it as well as the camera does, and two
 * places agreeing by coincidence is how a section ends up lit from behind.
 */
export const SLICE_FORWARD = cameraForwardOf(AXIAL_PLANE);

/**
 * How many pixels a section is read at, and what the second setting buys.
 *
 * # Why this is a switch and not a number that goes up
 *
 * The render side does not care: the cost of the pass is draw calls, and it is
 * the same few hundred at any size. **The readback scales with pixels**, and so
 * does the memory — at four thousand and ninety-six the picture is sixty-seven
 * megabytes, and there are four of it alive at once: the render target, the
 * buffer it is read into, the canvas it is painted on, and the copy kept so a
 * remounted canvas is not blank. A quarter of a gigabyte is a fair price on a
 * desktop and an insult on the 2010 machine this also runs on.
 *
 * So it is asked for. The default reads at a scale finer than a real CT and
 * looks smooth until the enlarged view passes native size; the high setting
 * doubles that, and doubles it in the one direction a reader notices, which is
 * how far they can magnify before the picture admits it has run out.
 */
export const SLICE_PIXELS_NORMAL = 2048;
export const SLICE_PIXELS_HIGH = 4096;

/**
 * The size to read at, clamped to what the card will actually give.
 *
 * `maxTexture` is not a formality. WebGL2 only guarantees two thousand and
 * forty-eight, and asking for a render target the driver cannot allocate does
 * not fail politely — it gives an incomplete framebuffer and a black picture,
 * which reads as a broken feature rather than as an unavailable one.
 */
export function sliceSize(high: boolean, maxTexture: number): number {
  const wanted = high ? SLICE_PIXELS_HIGH : SLICE_PIXELS_NORMAL;
  if (!(maxTexture > 0)) return SLICE_PIXELS_NORMAL;
  return Math.min(wanted, maxTexture);
}

/**
 * The size the last section was actually read at.
 *
 * Published because the panel has to know: it decides the point past which
 * magnifying is inventing detail, and the card may have refused the size that
 * was asked for.
 */
export const SLICE_PIXELS = { value: SLICE_PIXELS_NORMAL };

/**
 * A square of the body, in metres, that a section is framed on.
 *
 * `h` and `v` are its centre in the plane's own coordinates — world X, and
 * world `vertical` — and `half` is half its width. See `SlicePlane`.
 */
export interface SliceWindow {
  h: number;
  v: number;
  half: number;
}

/**
 * What the section is framed on, or null to frame it on what the slab holds.
 *
 * # Why magnifying re-renders instead of scaling
 *
 * Scaling the picture cannot add anything to it. Read at 108 cm across, the
 * section is 0.53 mm per pixel, and a reader magnifying past that is asking for
 * detail that was never measured — which is why the enlarged view went blocky
 * and why reading at four times the pixels only moved the wall rather than
 * removing it.
 *
 * Framing the *pass* on the region being looked at spends the same pixels on a
 * twentieth of the body. At a nine-centimetre window that is 0.044 mm per
 * pixel: a hundred and twenty times the detail of the whole-body frame, for the
 * same draw calls, the same readback and not one byte more memory. The cost is
 * one more section per gesture, which is the cost of every other gesture here.
 *
 * # Why the window is in metres and not in fractions of the picture
 *
 * Because the plane moves. The automatic frame follows what the slab contains,
 * and that is 108 cm at the chest and a third of it at the neck — so a window
 * remembered as "the middle fifth" would swing across the body as the reader
 * stepped through it. In metres it stays over the same anatomy, which is the
 * entire point of being able to step while magnified.
 */
export const SECTION_VIEW: { value: SliceWindow | null } = { value: null };

/**
 * The smallest window the section may be framed on, in metres of half-width.
 *
 * Three centimetres of half-width is six across. Past that a reader is
 * magnifying the atlas's own triangles, and a picture of a triangle is not more
 * information — it is the same information drawn larger, which is the thing
 * this was built to stop pretending to do.
 */
export const MIN_SECTION_HALF_M = 0.03;

/**
 * Magnify about a point, in metres.
 *
 * # Why there is no CSS transform any more
 *
 * There was one, as a live preview, with the real render arriving behind it and
 * the preview then taken back out. It produced jumps, and the reason is worth
 * writing down: **a section arriving is not the section you asked for.** The
 * counter goes up for every pass — a torch retake, a step of the plane, letting
 * the light go — so a preview taken out when "a section" landed was routinely
 * taken out against a picture rendered before the gesture even happened. Two
 * sources of truth for the same magnification, correlated by hope.
 *
 * There is one now. The window is the only state, the picture is always drawn
 * into it one-to-one, and a gesture changes the window. It updates a beat later
 * than the hand rather than instantly, which is the price, and it cannot
 * disagree with itself, which is the point.
 *
 * `u` and `v` are where to keep still, as an offset from the centre of the
 * picture from -1 to 1 — the pointer under a wheel, or the middle for a button.
 * Zooming about the pointer is what stops a reader losing the thing they were
 * looking at every time they magnify.
 *
 * Null means the whole section, which is not the same as a window that happens
 * to be as wide as the body: the automatic frame follows the level, and a
 * reader who has zoomed all the way out wants it to keep doing that.
 */
export function zoomWindow(
  frame: SliceWindow,
  base: SliceWindow,
  by: number,
  basis: SliceBasis,
  u = 0,
  v = 0,
): SliceWindow | null {
  if (!(by > 0) || !(base.half > 0)) return SECTION_VIEW.value;
  const half = clamp(frame.half / by, MIN_SECTION_HALF_M, base.half);
  if (half >= base.half) return null;

  // The world point under the pointer, kept where it is. Which way the pointer's
  // offset runs through the body is the basis's to say.
  const anchorH = frame.h + basis.right * u * frame.half;
  const anchorV = frame.v + basis.down * v * frame.half;
  return inside(
    { h: anchorH - basis.right * u * half, v: anchorV - basis.down * v * half, half },
    base,
  );
}

/**
 * Slide the window by a drag, in metres.
 *
 * The picture moves with the hand, so the window moves against it: dragging to
 * the right brings into view what was off to the left. Which direction through
 * the body "left" and "down" are is the basis's to say — see `SliceBasis`.
 */
export function panWindow(
  frame: SliceWindow,
  base: SliceWindow,
  dxPx: number,
  dyPx: number,
  windowPx: number,
  basis: SliceBasis,
): SliceWindow | null {
  if (!(windowPx > 0)) return SECTION_VIEW.value;
  const travel = (2 * frame.half) / windowPx;
  return inside(
    {
      h: frame.h - basis.right * dxPx * travel,
      v: frame.v - basis.down * dyPx * travel,
      half: frame.half,
    },
    base,
  );
}

/**
 * Keep a window within the section it is a window on.
 *
 * Panning off into the black past the edge of the body is a way to lose the
 * picture with no way back except the reset, and nothing out there is anatomy.
 */
function inside(window: SliceWindow, base: SliceWindow): SliceWindow {
  const reach = Math.max(0, base.half - window.half);
  return {
    h: clamp(window.h, base.h - reach, base.h + reach),
    v: clamp(window.v, base.v - reach, base.v + reach),
    half: window.half,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Two points on a section, and the distance between them.
 *
 * # Why the ends are in metres and not in pixels
 *
 * Because everything else about the picture moves. Magnifying re-renders the
 * section on a narrower window, stepping moves the plane, and either one would
 * strand a measurement drawn in pixels somewhere it never was. Held in the
 * body's own coordinates, the line stays on the anatomy it was drawn across and
 * its length does not change when the picture does — which is the only way a
 * measurement is worth anything.
 *
 * Both ends lie in the plane of the section, so the distance is the real
 * distance between those two points in space rather than a projection of one.
 * What that means about the *structures* under them is a different question,
 * and the caption is the place that answers it.
 */
export interface SectionMeasure {
  ah: number;
  av: number;
  bh: number;
  bv: number;
  /**
   * Where the plane it was drawn on stood, in metres along the sweep: a height
   * for an axial section, a depth for a frontal one.
   *
   * A line on a section is a statement about that level. Carried to another
   * one it still sits at the same place in the plane, but over different
   * anatomy, measuring nothing — which is exactly what the first caliper did
   * when the wheel stepped under it. See `onLevel`.
   */
  at: number;
  /** Which plane it was drawn on: a line on a frontal picture says nothing about an axial one. */
  plane: SectionPlaneName;
}

/**
 * How far from its own level a measurement still belongs to the picture.
 *
 * Half of the wheel's centimetre, so a line drawn on one step is never shown on
 * the next, and coming back to the same step — which lands a hair's breadth
 * away, being the sum of a run of fractions — still finds it.
 */
export const MEASURE_LEVEL_TOLERANCE_M = 0.005;

/** Whether a measurement belongs on the section taken here, on this plane. */
export function onLevel(
  line: Pick<SectionMeasure, "at" | "plane">,
  at: number,
  plane: SectionPlaneName,
): boolean {
  return line.plane === plane && Math.abs(line.at - at) <= MEASURE_LEVEL_TOLERANCE_M;
}

/** Where a point on screen falls in the body, in metres. */
export function pointInSection(
  window: SliceWindow,
  offsetXPx: number,
  offsetYPx: number,
  windowPx: number,
  basis: SliceBasis,
): { h: number; v: number } {
  const across = (2 * window.half) / windowPx;
  return {
    h: window.h + basis.right * (offsetXPx - windowPx / 2) * across,
    v: window.v + basis.down * (offsetYPx - windowPx / 2) * across,
  };
}

/** Where a point in the body falls on screen, in pixels from the corner. */
export function pointOnScreen(
  window: SliceWindow,
  h: number,
  v: number,
  windowPx: number,
  basis: SliceBasis,
): { x: number; y: number } {
  if (!(window.half > 0)) return { x: 0, y: 0 };
  const perMetre = windowPx / (2 * window.half);
  return {
    x: windowPx / 2 + basis.right * (h - window.h) * perMetre,
    y: windowPx / 2 + basis.down * (v - window.v) * perMetre,
  };
}

/** How long the line is, in centimetres of body. */
export function measureCm(line: Pick<SectionMeasure, "ah" | "av" | "bh" | "bv">): number {
  return Math.hypot(line.bh - line.ah, line.bv - line.av) * 100;
}

/**
 * The length, written the way somebody would say it.
 *
 * Millimetres below a centimetre, because "0.7 cm" is a number nobody uses out
 * loud, and one decimal above it. Never more: the atlas is a model of a body
 * rather than a measurement of one, and a third decimal would be a precision
 * this cannot honestly claim.
 */
export function formatDistance(cm: number): string {
  if (!(cm > 0)) return "";
  if (cm < 1) return `${Math.round(cm * 10)} mm`;
  return `${cm.toFixed(1)} cm`;
}

/**
 * The section as a PNG, with the caliper on it if one was drawn.
 *
 * # Why this composes a second canvas
 *
 * The panel's canvas already carries the disclaimer, which is baked in
 * deliberately — a picture that looks like a scan has to say what it is
 * wherever it ends up, and a caption in the interface does not travel with a
 * screenshot. The caliper is the opposite: drawn *over* the canvas, so that a
 * measurement is not stuck in every copy of the section from then on.
 *
 * Saving is the one moment those two rules point opposite ways — the reader
 * measured something and wants the number in the file. Composing a copy gives
 * both: the live picture stays clean, and the saved one is complete.
 *
 * The window is passed in rather than read from anywhere. There is one place
 * that knows what the section is framed on, and adding a second copy of it here
 * would be the same mistake that made magnifying jump.
 *
 * Returns null when there is nothing to save, rather than an empty image.
 */
export async function sectionImage(
  window: SliceWindow,
  lines: readonly SectionMeasure[],
  basis: SliceBasis,
): Promise<string | null> {
  const source = AXIAL_CANVAS.value;
  if (!source || source.width === 0) return null;

  const size = source.width;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0);

  // The caller passes the lines of this level only: a picture of T8 carrying a
  // ruler drawn at T11 would be a picture of something that was never measured.
  if (window.half > 0) for (const line of lines) drawMeasure(context, line, window, size, basis);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) return null;
  return encodeImageBytes(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * The caliper, drawn at the picture's own scale rather than the screen's.
 *
 * The overlay on screen is sized in CSS pixels over a window a few hundred
 * across; the file is two or four thousand. Reusing those numbers would put a
 * hairline and unreadable text on the saved image, so everything here is a
 * fraction of the image instead.
 */
function drawMeasure(
  context: CanvasRenderingContext2D,
  line: SectionMeasure,
  window: SliceWindow,
  size: number,
  basis: SliceBasis,
): void {
  const a = pointOnScreen(window, line.ah, line.av, size, basis);
  const b = pointOnScreen(window, line.bh, line.bv, size, basis);

  context.strokeStyle = "#22d3ee";
  context.lineWidth = Math.max(2, size / 512);
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();

  const dot = Math.max(3, size / 340);
  context.fillStyle = "#22d3ee";
  for (const end of [a, b]) {
    context.beginPath();
    context.arc(end.x, end.y, dot, 0, Math.PI * 2);
    context.fill();
  }

  const label = formatDistance(measureCm(line));
  if (!label) return;
  const type = Math.round(size / 42);
  context.font = `${type}px system-ui, "Segoe UI", sans-serif`;
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.lineWidth = Math.max(3, type / 5);
  context.strokeStyle = "rgba(2, 6, 23, 0.9)";
  context.fillStyle = "#a5f3fc";
  const x = (a.x + b.x) / 2 + type * 0.6;
  const y = (a.y + b.y) / 2 - type * 0.6;
  // Stroked first and filled over it, which is how text stays readable on a
  // picture whose background is whatever the body happened to be there.
  context.strokeText(label, x, y);
  context.fillText(label, x, y);
}

/**
 * A name for the file, made of what the picture actually is.
 *
 * Somebody saving one section is saving several, and a folder of
 * `anatria3d-view.png` and `anatria3d-view (1).png` is a folder nobody can
 * read. The plane, where it was — the level, or the depth — and the width
 * are what tell them apart.
 *
 * ASCII only, and deliberately: the level of a disc is written with an en dash
 * on screen, and a file name is not the place to find out how somebody's file
 * system feels about that.
 */
export function sectionFileName(
  plane: SectionPlaneName,
  where: string | null,
  acrossCm: number,
  cut: boolean,
): string {
  const parts = ["anatria3d", plane];
  const named = where?.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (named) parts.push(named);
  if (acrossCm > 0) parts.push(`${Math.round(acrossCm)}cm`);
  parts.push(cut ? "cut" : "slab");
  return `${parts.join("-")}.png`;
}

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
 * How far a wheel has to turn before the plane moves one step, in pixels.
 *
 * A notch of a mouse wheel reports a hundred pixels in WebView2, so on Windows
 * a notch is a step and a step is a centimetre. A trackpad reports small
 * amounts continuously instead, which is why this accumulates rather than
 * counting events: otherwise one flick of two fingers would cross the thorax.
 *
 * Pixels specifically. Other engines may report the same notch in lines or
 * pages — see `wheelPixels`, which converts before anything is counted.
 */
export const WHEEL_PER_STEP = 100;

/**
 * A wheel event's travel in pixels, whatever unit it arrived in.
 *
 * # Why this exists
 *
 * `deltaY` is a number without a unit; `deltaMode` is the unit. WebView2 always
 * reports pixels, which is the only engine this was first measured on, and the
 * step was written as if that were universal. It is not: an engine reporting
 * lines hands over about 3 for the notch WebView2 calls 100, and compared
 * against a threshold of 100 that is thirty-four notches for a centimetre — a
 * control that looks broken. The Linux build runs on WebKitGTK, which had not
 * been checked, so the conversion is made rather than assumed.
 *
 * A line or a page is taken as one notch. Neither unit carries a size in
 * pixels this could honestly multiply by, and a notch is what the reader
 * turned.
 */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  // DOM_DELTA_LINE and DOM_DELTA_PAGE.
  if (deltaMode === 1 || deltaMode === 2) return Math.sign(deltaY) * WHEEL_PER_STEP;
  return deltaY;
}

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
 * are. Which way through the body those run is the basis's and the plane's to
 * say; "overhead" is the side the camera stands on, whichever plane it is.
 */
export function torchDirection(
  u: number,
  v: number,
  basis: SliceBasis,
  plane: SlicePlane,
): THREE.Vector3 {
  const reach = Math.min(1, Math.hypot(u, v));
  const overhead = plane.normal.clone();
  if (reach < 1e-6) return overhead;

  const towards = new THREE.Vector3(basis.right * u, 0, 0)
    .addScaledVector(plane.vertical, basis.down * v)
    .normalize();
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
 * How often the section may be retaken while a gesture is still moving.
 *
 * Measured: a section is about 15 ms, and the viewport's own frame is about 24
 * on this machine. Retaking on every pointer move would put the two in the same
 * frame continuously and halve the rate; at this interval the extra work is
 * roughly a quarter of the time and the light still follows the hand closely
 * enough to feel attached to it.
 *
 * It paces the torch, magnifying and panning alike: all three are a hand moving
 * over the picture, and all three cost the same section. A reader on a slow
 * machine pays it only while a hand is actually moving.
 */
export const RETAKE_INTERVAL_MS = 70;

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
 * Paint a slice that was read out of the GPU, the way round a reader expects.
 *
 * The orientation is `basis`'s and nobody else's. This used to flip the rows
 * because WebGL numbers them from the bottom — true, and the flip was right for
 * the camera, but the camera's up is posterior, so the result was a body with
 * its spine at the top under a caption saying the front was there. On an axial
 * slice that is a silent error: anterior and posterior both look plausible.
 */
export function paintSlice(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  size: number,
  basis: SliceBasis,
  plane: SlicePlane,
): void {
  // The canvas is resized to the picture rather than the picture to the canvas.
  // The size is a setting now, and a 2048 image put into a 4096 canvas would
  // sit in one corner of a mostly empty square. Assigning clears it, which is
  // harmless here because the next thing that happens is a full repaint.
  fit(canvas, size);
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(size, size);
  const row = size * 4;
  // WebGL hands the rows over bottom first, so copied as they arrive the picture
  // runs, downwards, towards the camera's up. The axial camera's up is posterior,
  // which the picture wants at the bottom, so nothing turns; the frontal
  // camera's up is superior, which the picture wants at the top, so it turns.
  const flip = plane.cameraUp !== basis.down;
  // Its +x is world +X. Mirrored only where that is the patient's right: a row
  // copied whole is free, a mirror touches every pixel, so only an atlas that
  // needs it pays for it.
  const mirror = basis.right === -1;
  const from32 = mirror ? new Uint32Array(pixels.buffer, pixels.byteOffset, size * size) : null;
  const to32 = mirror
    ? new Uint32Array(image.data.buffer, image.data.byteOffset, size * size)
    : null;
  for (let y = 0; y < size; y++) {
    const source = flip ? size - 1 - y : y;
    if (!from32 || !to32) {
      image.data.set(pixels.subarray(source * row, source * row + row), y * row);
      continue;
    }
    const src = source * size;
    const dst = y * size;
    for (let x = 0; x < size; x++) to32[dst + x] = from32[src + size - 1 - x]!;
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

/** Match a canvas to a picture, without clearing it needlessly. */
function fit(canvas: HTMLCanvasElement, size: number): void {
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
}

/** Put the last section back on a canvas that has just appeared. */
export function restoreSlice(canvas: HTMLCanvasElement): void {
  if (!last) return;
  fit(canvas, last.width);
  const context = canvas.getContext("2d");
  context?.putImageData(last, 0, 0);
}

/** For tests, and for a mode being switched off with nothing to remember. */
export function forgetSlice(): void {
  last = null;
}
