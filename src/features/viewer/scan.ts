import * as THREE from "three";

/**
 * The body with its colour taken away, so that what is marked has somewhere to
 * stand out.
 *
 * # Why this exists, when the marking was already lit
 *
 * Brightness was the wrong instrument. The atlas puts several thousand
 * saturated structures on screen at once, and adding light to one of them is a
 * contest against all the others — worst of all in the glass body, where every
 * layer shows through and the whole chest reads as one pink field. Removing the
 * colour from everything *else* wins that contest without touching the marking
 * at all.
 *
 * # Why it is not a flat grey
 *
 * Lightness is kept and only saturation is dropped. Bone stays lighter than
 * muscle, cartilage lighter than liver, and the body still reads as a body —
 * a greyscale render rather than a grey mass. A uniform grey would win the
 * contrast fight by deleting the anatomy, which is not a trade this viewer
 * makes.
 *
 * **What it does cost** is hue as a channel: two tissues that differ only in
 * hue and not in lightness — a red muscle and a blue vein of the same value —
 * become the same grey. That is the deliberate trade, and it is why this is a
 * mode a reader turns on to look at something rather than a way to work.
 */

/**
 * How much saturation survives.
 *
 * Not zero. A trace keeps the tissue families faintly distinguishable where
 * lightness alone would collapse them, and it stops the body reading as a
 * technical greyscale image — which would be the wrong claim, because there is
 * no imaging here, only anatomy with its colour turned down.
 */
export const SCAN_SATURATION = 0.06;

const hsl = { h: 0, s: 0, l: 0 };

/** A tissue colour with its saturation taken out and its lightness kept. */
export function scanColour(tissue: THREE.Color): THREE.Color {
  const scanned = tissue.clone();
  scanned.getHSL(hsl);
  scanned.setHSL(hsl.h, hsl.s * SCAN_SATURATION, hsl.l);
  return scanned;
}

/**
 * Whether a structure keeps its own colour while the body is scanned.
 *
 * Three things do, and each for a different reason:
 *
 * - **What the assistant has lit.** The whole point of the mode.
 * - **What the reader has selected.** Their own place in the anatomy is not
 *   scenery, and losing it every time the mode goes on would make the mode
 *   something you switch off to get your bearings back.
 * - **An isolated region.** Isolating already says "this is what I am working
 *   on"; draining its colour would contradict the reader twice over.
 *
 * Everything else goes grey, which is what leaves the marked structure the only
 * coloured thing on screen.
 */
export function keepsColour(state: {
  lit: boolean;
  selected: boolean;
  isolated: boolean;
}): boolean {
  return state.lit || state.selected || state.isolated;
}
