import type { AnatomicalView } from "./cameraViews";

/**
 * Where each panel of the split viewport sits.
 *
 * # Why this is a pure function in its own file
 *
 * Because two things have to agree about it and they used to be written twice.
 * The renderer scissors four rectangles out of one drawing buffer; the pointer
 * mapping decides which part of the canvas belongs to the camera the reader is
 * driving. When those two descriptions of the same layout were separate, one of
 * them was hardcoded to the top-left quarter — and the first time the layout
 * moved, selection would have gone with it.
 *
 * So the layout is computed once, here, from nothing but the list of panels
 * that are switched on, and both the render loop and the pointer mapping read
 * the result. They cannot disagree because there is only one of it, and it can
 * be tested without a canvas, a GPU or a browser.
 *
 * # Fractions, and which way is up
 *
 * Everything is expressed as a fraction of the canvas, so nothing here needs to
 * know the device pixel ratio or the window size. The origin is **bottom left**
 * because that is WebGL's convention and this feeds `setViewport`. The DOM
 * needs the opposite, which is what `domRect` is for — converting it in one
 * place rather than at every call site is the point.
 */

/** The panel the reader drives. Always present, always first. */
export const MAIN = "main" as const;

/**
 * The views that can occupy an auxiliary panel.
 *
 * A narrower set than `AnatomicalView`, and deliberately so: the atlas offers
 * five viewpoints, but posterior and right lateral are each the mirror of one
 * already here, and a panel showing the far side of a symmetrical structure
 * teaches less than the three that are here. Naming the subset in the type
 * keeps the letter table and the layout from drifting apart from it.
 */
export type AuxiliaryView = Extract<AnatomicalView, "anterior" | "left" | "superior">;

export type PanelId = typeof MAIN | AuxiliaryView;

/** A rectangle in canvas fractions, measured from the bottom left. */
export interface PanelRect {
  id: PanelId;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The panels, given which auxiliary views are switched on.
 *
 * The main panel keeps the top-left corner in every arrangement with more than
 * one panel. That is deliberate: it holds the labels, the selection and the
 * camera the reader is turning, and a panel that moved when they switched a
 * different one off would cost them their bearings for no gain.
 *
 * The arrangements are chosen so that no panel is ever a sliver. Two panels
 * split the canvas down the middle at full height rather than sitting in two
 * quarters with half the screen empty, because the reason to switch a view off
 * is to give the remaining ones more room.
 */
export function panelLayout(active: readonly AuxiliaryView[]): PanelRect[] {
  const [first, second, third] = active;

  if (first === undefined) {
    return [{ id: MAIN, x: 0, y: 0, width: 1, height: 1 }];
  }

  if (second === undefined) {
    return [
      { id: MAIN, x: 0, y: 0, width: 0.5, height: 1 },
      { id: first, x: 0.5, y: 0, width: 0.5, height: 1 },
    ];
  }

  if (third === undefined) {
    return [
      { id: MAIN, x: 0, y: 0, width: 0.5, height: 1 },
      { id: first, x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      { id: second, x: 0.5, y: 0, width: 0.5, height: 0.5 },
    ];
  }

  return [
    { id: MAIN, x: 0, y: 0.5, width: 0.5, height: 0.5 },
    { id: first, x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    { id: second, x: 0, y: 0, width: 0.5, height: 0.5 },
    { id: third, x: 0.5, y: 0, width: 0.5, height: 0.5 },
  ];
}

/** The rectangle the reader's camera owns. There is always exactly one. */
export function mainRect(active: readonly AuxiliaryView[]): PanelRect {
  // `panelLayout` puts it first in every branch, and never returns an empty
  // list — but reading it by identity rather than by index says why it is safe.
  const main = panelLayout(active).find((panel) => panel.id === MAIN);
  if (!main) throw new Error("every layout has a main panel");
  return main;
}

/** The same rectangle with the origin at the top left, the way the DOM measures. */
export function domRect(rect: PanelRect): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return {
    left: rect.x,
    top: 1 - (rect.y + rect.height),
    width: rect.width,
    height: rect.height,
  };
}
