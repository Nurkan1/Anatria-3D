import * as THREE from "three";

/**
 * Standard viewpoints, the way anatomy names them.
 *
 * # Why the anatomical words and not "front" and "back"
 *
 * Anterior, posterior, lateral and superior *are* the vocabulary the reader is
 * here to learn, and they are the words on every radiology report and every
 * exam paper. A tool for medical students that says "front" is teaching the
 * wrong term at the exact moment the reader is looking at the thing it names.
 * Every button carries the plain-English gloss in its tooltip.
 *
 * # Why laterality is measured rather than assumed
 *
 * The axes are known — X is left/right, Y superior/inferior, Z anterior/
 * posterior, as `PLANE_NORMALS` already relies on — but *which* end of X is the
 * body's left depends on how the model was exported, and getting it wrong means
 * a button labelled "left" that shows the right side. In a teaching tool that is
 * not a cosmetic bug.
 *
 * So it is read off the atlas itself: the paired structures say which side is
 * which, and they cannot be wrong about their own model.
 */

export type AnatomicalView =
  | "anterior"
  | "posterior"
  | "left"
  | "right"
  | "superior";

/** Short label for the button; the tooltip carries the rest. */
export const VIEW_LABEL: Record<AnatomicalView, string> = {
  anterior: "A",
  posterior: "P",
  left: "L",
  right: "R",
  superior: "S",
};

export const VIEW_HINT: Record<AnatomicalView, string> = {
  anterior: "Anterior — looking at the front",
  posterior: "Posterior — looking at the back",
  left: "Left lateral — the body's own left side",
  right: "Right lateral — the body's own right side",
  superior: "Superior — looking down from above",
};

/**
 * The key that reaches each viewpoint, derived from the letter on its button.
 *
 * Built from `VIEW_LABEL` rather than written out again, so the two cannot
 * disagree. A button reading "P" whose key was "b" would be a small betrayal
 * of the only affordance the bar has — the letter *is* the instruction, and
 * deriving it makes that true by construction rather than by discipline.
 */
export const VIEW_FOR_KEY: Record<string, AnatomicalView> = Object.fromEntries(
  (Object.keys(VIEW_LABEL) as AnatomicalView[]).map((view) => [
    VIEW_LABEL[view].toLowerCase(),
    view,
  ]),
);

/** The key for framing, which has a word on its button rather than a letter. */
export const FIT_KEY = "f";

export const VIEW_ORDER: AnatomicalView[] = [
  "anterior",
  "posterior",
  "left",
  "right",
  "superior",
];

/**
 * Which way along X the body's left lies, read from the atlas.
 *
 * Paired structures are named `..._l` and `..._r`, so a handful of pairs settle
 * it. Counted rather than trusted to the first pair found: one mesh placed
 * oddly in the source should not be able to mirror the whole interface.
 *
 * Defaults to `+1` when the model offers no pairs at all, which is a guess —
 * but one made only when there is nothing to measure.
 */
export function lateralSign(
  organIds: Iterable<string>,
  centres: Map<string, THREE.Vector3>,
): 1 | -1 {
  let votes = 0;
  for (const id of organIds) {
    if (!id.endsWith("_l")) continue;
    const left = centres.get(id);
    const right = centres.get(`${id.slice(0, -2)}_r`);
    if (!left || !right) continue;
    if (left.x > right.x) votes += 1;
    else if (left.x < right.x) votes -= 1;
  }
  return votes >= 0 ? 1 : -1;
}

/**
 * Where the camera stands for a view, as a unit direction from the subject.
 *
 * `leftSign` is what `lateralSign` measured. To *look at* the left side the
 * camera has to stand on the left side, which is why the lateral views use it
 * directly rather than inverted.
 */
export function viewDirection(view: AnatomicalView, leftSign: 1 | -1): THREE.Vector3 {
  switch (view) {
    case "anterior":
      return new THREE.Vector3(0, 0, 1);
    case "posterior":
      return new THREE.Vector3(0, 0, -1);
    case "left":
      return new THREE.Vector3(leftSign, 0, 0);
    case "right":
      return new THREE.Vector3(-leftSign, 0, 0);
    case "superior":
      // Nudged back off the pole. Straight down, the camera's up vector and its
      // view direction are parallel and the orbit has no defined orientation —
      // the model spins on the spot as soon as it is dragged.
      return new THREE.Vector3(0, 1, 0.001).normalize();
  }
}

/**
 * How far back a sphere of this radius has to be to fill the frame.
 *
 * The 2.2 is headroom: framed exactly, a body touches all four edges and reads
 * as cropped rather than as fitted.
 */
export function framingDistance(radius: number, fovDegrees: number): number {
  return (Math.max(radius, 1e-4) * 2.2) / Math.tan((fovDegrees * Math.PI) / 360);
}

/** One dolly step, and the direction of it. */
export const DOLLY_IN = 0.7;
export const DOLLY_OUT = 1 / DOLLY_IN;

/**
 * Which way a keystroke means to zoom, or nothing at all.
 *
 * # Why this is not one comparison
 *
 * `+` is not a key. It is a *character*, and which key produces it depends on
 * the layout: on a Spanish keyboard it is unshifted next to the accent, on a
 * US one it is `Shift` and the `=` key, and on either there is a numeric pad
 * with its own dedicated `+` that reports neither. This ships for Windows and
 * for Linux and cannot assume any of them.
 *
 * So three readings, and each earns its place:
 *
 * - **`key` for the character.** Layout-aware by definition: whatever the
 *   reader's keyboard actually produced. This is what covers `+` and `-` on
 *   Spanish, US, German and the rest without naming any of them.
 * - **`=` and `_` as well**, so a US reader who reaches for the `+` key does
 *   not have to hold `Shift` to be understood. They sit on the same physical
 *   keys and mean the same intent.
 * - **`code` for the numeric pad.** Those two keys report `NumpadAdd` and
 *   `NumpadSubtract` regardless of layout, and reading `code` is right here
 *   for exactly the reason it is wrong above: the pad's physical position is
 *   the same everywhere.
 *
 * Deliberately *not* matched: `code === "Equal"` and `code === "Minus"`. That
 * would zoom on whatever key sits in the US position, which on a Spanish
 * layout is the apostrophe.
 */
export function zoomKeyFor(event: {
  key: string;
  code: string;
}): "in" | "out" | null {
  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
    return "in";
  }
  if (event.key === "-" || event.key === "_" || event.code === "NumpadSubtract") {
    return "out";
  }
  return null;
}
