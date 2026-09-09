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

/**
 * How the body is drawn: as itself, drained of colour, or as carbon.
 *
 * Three values rather than two booleans, so "carbon but not drained" cannot be
 * written down. The tones are ordered by how much of the tissue's own
 * appearance survives.
 */
export type BodyTone = "solid" | "scan" | "carbon";

/**
 * Carbon: the same drained body, pressed down towards black.
 *
 * # Why darkness is not decoration here
 *
 * **The scanner's light is additive.** It is added to whatever the surface
 * already has, so on a mid-lit body it saturates almost immediately and the
 * falloff — which is the part carrying the shape of what was reached —
 * disappears into white. Against a dark body the same light has somewhere to
 * go. This is the reason radiology is read on black, and it is why this mode
 * makes the sweep show *more* rather than merely look better.
 *
 * Lightness is compressed rather than floored: bone stays lighter than muscle,
 * and the body keeps being a body. A little of a blue-black graphite is mixed
 * in on top, because a body that is only "the same thing, darker" reads as
 * underexposed, where a slight cool cast reads as a material.
 *
 * **What it costs, said plainly:** discrimination in the dark half. The scan
 * tone already trades hue away — two tissues that differ only in hue become one
 * grey — and this one narrows what is left. It is a mode to look at something
 * in, not a mode to work in, which is why it sits behind the tone that keeps
 * more and not in front of it.
 */
export const CARBON_LIGHTNESS = 0.34;
export const CARBON_GRAPHITE = 0.3;
const GRAPHITE = new THREE.Color("#0b1016");

const hsl = { h: 0, s: 0, l: 0 };

/** A tissue colour as the given tone draws it. */
export function scanColour(tissue: THREE.Color, tone: BodyTone = "scan"): THREE.Color {
  if (tone === "solid") return tissue.clone();
  const scanned = tissue.clone();
  scanned.getHSL(hsl);
  if (tone === "scan") {
    scanned.setHSL(hsl.h, hsl.s * SCAN_SATURATION, hsl.l);
    return scanned;
  }
  scanned.setHSL(hsl.h, hsl.s * SCAN_SATURATION, hsl.l * CARBON_LIGHTNESS);
  return scanned.lerp(GRAPHITE, CARBON_GRAPHITE);
}

/** The next tone the appearance button steps to. */
export function nextBodyTone(tone: BodyTone): BodyTone {
  return tone === "solid" ? "scan" : tone === "scan" ? "carbon" : "solid";
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
