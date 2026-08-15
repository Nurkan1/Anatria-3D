/**
 * Telling a click apart from the end of a drag.
 *
 * # The problem
 *
 * Orbiting is press, travel, release — and the browser calls the release a
 * click, on whatever happens to be under the pointer when it lands. So turning
 * the body to look at the back of the heart finished by selecting a rib,
 * every time, and the reader never asked for either.
 *
 * The viewport already knew this about the right button: opening a context
 * menu after a deliberate pan would be maddening, so a press that travelled
 * was treated as navigation. The rule was right and the scope was too narrow.
 *
 * # Why a module rather than a ref
 *
 * Two places have to agree. `OrganMesh` sees the click first — R3F dispatches
 * into the scene from the canvas's own listener — and the viewport sees it
 * afterwards, when the event has bubbled out to the container. Either can be
 * the one that would have selected something, so both have to ask the same
 * question and get the same answer.
 *
 * Reading rather than consuming, for the same reason: a one-shot flag would be
 * spent by whichever asked first and let the other through.
 */

/**
 * How far a press may travel and still count as a click, in pixels.
 *
 * Generous enough for a hand that is not perfectly still — a careful click on
 * a small structure drifts a pixel or two, and refusing those would make the
 * atlas feel broken to anyone using a trackpad. Tight enough that a deliberate
 * turn of the body never lands as a selection.
 */
export const DRAG_SLOP = 6;

let origin: { x: number; y: number } | null = null;
let travelled = false;

/** A button went down. Whatever the last press did is no longer interesting. */
export function beginPress(x: number, y: number): void {
  origin = { x, y };
  travelled = false;
}

/** The pointer moved. Once a press has travelled it stays travelled. */
export function trackPress(x: number, y: number): void {
  if (origin === null || travelled) return;
  if (Math.hypot(x - origin.x, y - origin.y) > DRAG_SLOP) travelled = true;
}

/**
 * Whether the press that is ending travelled far enough to be a drag.
 *
 * Deliberately still true after the button comes up: `click` is raised *after*
 * `pointerup`, so clearing this on release would answer "no" to the only
 * question that ever gets asked.
 */
export function pressTravelled(): boolean {
  return travelled;
}

/** Test seam. Nothing in the app needs to forget a press by hand. */
export function resetPress(): void {
  origin = null;
  travelled = false;
}
