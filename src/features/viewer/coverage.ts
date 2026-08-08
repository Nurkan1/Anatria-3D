import * as THREE from "three";

/**
 * The reader's own revision, painted onto the body.
 *
 * # Why only this application can show it
 *
 * An atlas knows anatomy. A notebook knows what you wrote. Nothing else knows
 * both, so nothing else can answer the question a student actually has in the
 * week before finals: **where have I not been?** Forty notes on the thorax and
 * nothing at all on the pelvis is not visible in a list of notes — it is
 * obvious the moment it is a shape on a body.
 *
 * # Reading the map
 *
 * Studied structures light up on a single-hue ramp; everything untouched goes
 * to a flat neutral grey. Sequential data gets a sequential scale — using two
 * hues would imply a midpoint that means something, and there is no such thing
 * as anatomy you have studied the wrong amount.
 *
 * The lit shape is what you have covered. The grey is the gap, and the grey is
 * the point.
 *
 * # Why the scale is relative, and what that costs
 *
 * The busiest structure sets the top of the ramp. On a journal with one note
 * that structure is fully lit, which overstates a single glance — but the
 * alternative, a fixed ceiling, leaves a whole term's work sitting at the dim
 * end where the shape cannot be read at all. The map is for comparing your own
 * attention against itself, and the legend says so in as many words.
 */

/** Untouched. Deliberately flat and cool: it should recede, not accuse. */
const UNTOUCHED = new THREE.Color("#3f4a5a");

/** The faintest amount of attention that still counts as having been there. */
const VISITED = new THREE.Color("#1e6f8f");

/** As much attention as anything in this journal has had. */
const DWELT = new THREE.Color("#5eead4");

/**
 * How the ramp is walked.
 *
 * The square root, not the count: the first note about a structure is the one
 * that changes whether you have been there at all, and the twelfth is a detail.
 * Linear, one heavily-worked region flattens everything else into the dark.
 */
export function coverageDepth(touches: number, busiest: number): number {
  if (touches <= 0 || busiest <= 0) return 0;
  return Math.min(Math.sqrt(touches) / Math.sqrt(busiest), 1);
}

/** The colour a structure is drawn in while the map is on. */
export function coverageColour(touches: number, busiest: number): THREE.Color {
  const depth = coverageDepth(touches, busiest);
  if (depth <= 0) return UNTOUCHED.clone();
  return VISITED.clone().lerp(DWELT, depth);
}

/** The busiest structure in the journal, which sets the top of the ramp. */
export function busiestTouches(coverage: Record<string, number>): number {
  let most = 0;
  for (const touches of Object.values(coverage)) {
    if (touches > most) most = touches;
  }
  return most;
}

/** Swatches for the legend, dimmest first. */
export function coverageLegend(busiest: number): { label: string; hex: string }[] {
  if (busiest <= 0) return [];
  return [
    { label: "not yet", hex: `#${UNTOUCHED.getHexString()}` },
    { label: "been here", hex: `#${coverageColour(1, busiest).getHexString()}` },
    {
      label: `most (${busiest})`,
      hex: `#${coverageColour(busiest, busiest).getHexString()}`,
    },
  ];
}
