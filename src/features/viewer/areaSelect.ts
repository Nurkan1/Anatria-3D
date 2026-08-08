import * as THREE from "three";

import { projectToScreen } from "./viewerBridge";

/**
 * Selecting a region by drawing round it.
 *
 * The gesture that was missing: picking out "the bones of the head" one
 * Ctrl+click at a time is forty clicks, and the tree cannot help, because the
 * grouping a reader wants here is *spatial* and the tree is taxonomic. Drawing
 * round it says the whole thing in one movement, and what comes back is an
 * ordinary selection — so the isolate and hide verbs already handle the rest.
 *
 * # Why a freehand loop and not a rectangle
 *
 * A rectangle is easier to write and wrong for this. Anatomical regions are not
 * rectangular: a box round a skull takes the clavicles with it, and a box round
 * the neck takes the jaw. The reader is pointing at a shape, so let them draw
 * the shape.
 *
 * # What counts as inside
 *
 * A structure whose *centre* falls in the loop. Not "any part overlapping",
 * which sweeps in a whole rib because one end crossed the line, and not an
 * occlusion test, which would refuse the deep vessels that are usually the
 * reason for drawing round a region at all. Centre-in-shape is the rule a
 * reader can predict without being told it.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * How far the pointer must travel before a drag is a loop rather than a click
 * that wobbled. Without a floor every Ctrl+click would also commit an empty
 * loop.
 */
export const MIN_DRAG = 8;

/**
 * Smallest gap between recorded points.
 *
 * A pointer emits far more moves than a shape needs, and a path with a
 * thousand near-identical vertices costs a thousand edge tests per structure.
 */
export const PATH_RESOLUTION = 4;

/** Add a point to the path, unless the pointer has barely moved since the last. */
export function extendPath(path: Point[], next: Point): Point[] {
  const last = path[path.length - 1];
  if (last && Math.hypot(next.x - last.x, next.y - last.y) < PATH_RESOLUTION) {
    return path;
  }
  return [...path, next];
}

export function pathBounds(path: Point[]): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const point of path) {
    if (point.x < left) left = point.x;
    if (point.x > right) right = point.x;
    if (point.y < top) top = point.y;
    if (point.y > bottom) bottom = point.y;
  }
  return { left, top, right, bottom };
}

/** Whether this is a shape someone meant to draw. */
export function isLassoMeaningful(path: Point[]): boolean {
  if (path.length < 3) return false;
  const bounds = pathBounds(path);
  return bounds.right - bounds.left >= MIN_DRAG || bounds.bottom - bounds.top >= MIN_DRAG;
}

/**
 * Ray casting: count the edges a ray from the point crosses, and an odd count
 * means inside.
 *
 * The loop is treated as closed whether or not the reader's hand came back to
 * the start — nobody draws an exactly closed curve, and refusing an open one
 * would make the gesture fail almost every time.
 */
export function pointInPath(x: number, y: number, path: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = path.length - 1; index < path.length; previous = index++) {
    const a = path[index]!;
    const b = path[previous]!;
    // The strict inequality on exactly one side is what keeps a vertex from
    // being counted twice, and it also rules out the horizontal edge that
    // would divide by zero below.
    const straddles = a.y > y !== b.y > y;
    if (straddles && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The structures inside the loop.
 *
 * Candidates must already be filtered for visibility: a loop must never pick up
 * a system that is switched off, because the reader has no way to see what they
 * just caught.
 */
export function collectInPath(
  candidates: { organ_id: string }[],
  // Only `get` is required, so this takes either the raw centres map or a
  // lookup that has already folded in the exploded view's displacements. The
  // loop must agree with the picture: catching a structure by where the body
  // keeps it, after it has visibly moved somewhere else, is indefensible.
  centres: { get(organId: string): THREE.Vector3 | undefined },
  camera: THREE.Camera,
  width: number,
  height: number,
  path: Point[],
): string[] {
  if (!isLassoMeaningful(path)) return [];
  const bounds = pathBounds(path);
  const found: string[] = [];

  for (const candidate of candidates) {
    const centre = centres.get(candidate.organ_id);
    if (!centre) continue;
    const point = projectToScreen(centre, camera, width, height);
    // A structure behind the camera projects mirrored into the view in front of
    // it, and would be caught by a loop drawn over empty space.
    if (point.behind) continue;
    // The bounding box first: it rejects almost everything for the price of
    // four comparisons, and the atlas has three and a half thousand candidates.
    if (
      point.x < bounds.left ||
      point.x > bounds.right ||
      point.y < bounds.top ||
      point.y > bounds.bottom
    ) {
      continue;
    }
    if (pointInPath(point.x, point.y, path)) found.push(candidate.organ_id);
  }
  return found;
}

/**
 * The click that ends a loop must not also select whatever is under the cursor.
 *
 * React Three Fiber raises `click` on pointer-up however far the pointer
 * travelled in between, so without this a loop finishing over a rib would end
 * by replacing the whole selection with that rib. A shared flag rather than
 * event plumbing because the two ends of the problem are in different trees —
 * the drag is DOM, the click is a mesh inside the canvas.
 */
let suppressUntil = 0;

const SUPPRESS_MS = 250;

export function suppressNextClick(): void {
  suppressUntil = Date.now() + SUPPRESS_MS;
}

export function shouldSuppressClick(): boolean {
  if (Date.now() > suppressUntil) return false;
  suppressUntil = 0;
  return true;
}
