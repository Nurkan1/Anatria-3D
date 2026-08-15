/**
 * Which of three things the depth panel is showing, and what it should say.
 *
 * # Why the wording is not decoration
 *
 * "Under the cursor" is a claim about where the pointer is. The panel spends
 * most of its life not being that — held after the pointer left the body, or
 * pinned to a point the reader clicked — and a list that goes on making the
 * claim while pointing at something else is the kind of small lie that costs an
 * interface its credibility. So the heading is derived from the state rather
 * than fixed with a badge beside it.
 *
 * Kept out of the component so the three states can be enumerated in a test.
 * The failure this guards against is not a wrong pixel: it is a fourth
 * combination appearing later and quietly falling through to whichever branch
 * happened to be last.
 */

export type DepthReading = "live" | "held" | "pinned";

/**
 * Pinned beats live, and that ordering is the feature.
 *
 * The probe keeps running while a reading is pinned — it has to, or clicking a
 * second structure would pin the first one's column — so both can be true at
 * once. When they are, the reader's click is the one that meant something.
 */
export function depthReadingState(live: boolean, pinned: boolean): DepthReading {
  if (pinned) return "pinned";
  return live ? "live" : "held";
}

export const HEADING: Record<DepthReading, string> = {
  live: "Under the cursor",
  held: "Where you last pointed",
  pinned: "Through what you clicked",
};

export const SUBHEADING: Record<DepthReading, string> = {
  live: "surface inwards",
  held: "held — click any layer",
  pinned: "pinned — move freely",
};

export const DISMISS_HINT: Record<DepthReading, string> = {
  live: "Close this reading",
  held: "Close this reading",
  pinned: "Let go of this reading",
};
