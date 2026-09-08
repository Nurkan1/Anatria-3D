import { scanRangeAlong, type ScanAxis } from "./scanBand";

/**
 * What the sweep is passing through, at the moment it passes it.
 *
 * # Why this exists at all
 *
 * The band lights the slice it crosses, which looks like a scanner and teaches
 * nothing: a glowing line across a chest does not say *lung*. This is the half
 * that makes the mode a study tool rather than a screensaver — as the plane
 * descends it can name what it has reached.
 *
 * # Why the largest first, and only a few
 *
 * A plane through the thorax crosses two hundred structures: ribs, costal
 * cartilages, intercostal muscles, every vessel that happens to pass. Naming
 * all of them is noise, and naming an arbitrary handful is worse, because the
 * reader cannot tell it is arbitrary.
 *
 * Ordering by volume answers it honestly. The biggest things a plane crosses
 * are the organs somebody is trying to learn; the slivers are real anatomy and
 * are not what the sweep is for. The count of everything else is reported
 * alongside, so the shortlist never pretends to be the whole truth.
 */

/** Anything with min/max — a `THREE.Box3` satisfies this without importing it. */
export interface Extent {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface Crossing {
  /** Ordered largest first, at most `limit` of them. */
  organIds: string[];
  /** Everything the plane crosses, including the ones not listed. */
  total: number;
}

/** Empty, and shared so the readout has something to point at from the start. */
export const NOTHING_CROSSED: Crossing = { organIds: [], total: 0 };

/**
 * Which structures the plane at `at` passes through, biggest first.
 *
 * `at` is a distance along `axis`, in the same measure `scanRangeAlong`
 * returns — the two are deliberately the same primitive, so a box is tested
 * against the sweep exactly the way the sweep's own travel was measured.
 */
export function crossingAt(
  boxes: ReadonlyMap<string, Extent>,
  at: number,
  axis: ScanAxis,
  limit: number,
): Crossing {
  const hits: { organId: string; volume: number }[] = [];

  for (const [organId, box] of boxes) {
    const { from, to } = scanRangeAlong(
      [box.min.x, box.min.y, box.min.z],
      [box.max.x, box.max.y, box.max.z],
      axis,
    );
    if (at < from || at > to) continue;
    hits.push({
      organId,
      volume:
        (box.max.x - box.min.x) * (box.max.y - box.min.y) * (box.max.z - box.min.z),
    });
  }

  hits.sort((a, b) => b.volume - a.volume || a.organId.localeCompare(b.organId));
  return {
    organIds: hits.slice(0, Math.max(0, limit)).map((hit) => hit.organId),
    total: hits.length,
  };
}

/**
 * Whether two readings say the same thing.
 *
 * The readout is rebuilt only when this is false. A sweep moving a millimetre
 * crosses the same organs it did last frame, and rewriting the same six names
 * sixty times a second is work nobody sees.
 */
export function sameCrossing(a: Crossing, b: Crossing): boolean {
  if (a.total !== b.total || a.organIds.length !== b.organIds.length) return false;
  return a.organIds.every((organId, index) => organId === b.organIds[index]);
}


/**
 * The current reading, shared the way the sweep position is.
 *
 * A module-level object rather than React state, for the same reason
 * `RenderStats` writes `textContent` in its own loop: the sweep changes what it
 * crosses several times a second, and pushing that through React would
 * re-render a tree with 3,478 meshes in it to update six words.
 */
export const CURRENT_CROSSING: { value: Crossing } = { value: NOTHING_CROSSED };

/** How often the crossing is recomputed. Sixty times a second buys nothing. */
export const CROSSING_INTERVAL_S = 1 / 6;

/** How many are named. Beyond a handful nobody reads them. */
export const CROSSING_LIMIT = 6;
