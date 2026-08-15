/**
 * Which of two things the depth panel is showing, and what it should say.
 *
 * # Why the wording is not decoration
 *
 * "Under the cursor" is a claim about where the pointer is. It stops being
 * true the moment a reading is pinned, and a list that goes on making the
 * claim while the pointer is somewhere else is the kind of small lie that
 * costs an interface its credibility. So the heading is derived from the state
 * rather than fixed with a badge beside it.
 *
 * # There used to be a third
 *
 * `held` kept the last reading after the pointer left the body. It was the
 * first attempt at making the panel reachable — the panel is drawn over the
 * model, so the journey to it left the body and emptied the list on the way.
 * Pinning solved that properly, and holding then became a nuisance: sweeping
 * the pointer across the body left a panel behind that nobody had asked for.
 * Removing it is why this file has two states instead of three.
 */

export type DepthReading = "live" | "pinned";

/**
 * A pinned reading wins, and that ordering is the feature.
 *
 * The probe keeps running while one is pinned — it has to, or clicking a
 * second structure would pin the first one's column — so both can be true at
 * once. When they are, the reader's click is the one that meant something.
 */
export function depthReadingState(pinned: boolean): DepthReading {
  return pinned ? "pinned" : "live";
}

export const HEADING: Record<DepthReading, string> = {
  live: "Under the cursor",
  pinned: "Through what you clicked",
};

export const SUBHEADING: Record<DepthReading, string> = {
  live: "surface inwards",
  pinned: "pinned — move freely",
};

export const DISMISS_HINT: Record<DepthReading, string> = {
  live: "Close this reading",
  pinned: "Let go of this reading",
};
