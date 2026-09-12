import type { SectionPlaneName } from "@/features/viewer/axialSlice";
import type { ScannerContext, SessionMode } from "@/lib/schemas";

/**
 * Whether the assistant is told where the scanner is, and what it is told.
 *
 * # Why the scanner can stand in for a selection
 *
 * A reader who has stepped the plane to T8 and is looking at the section has
 * already said where they are, just not in words. "What hurts here?" typed at
 * that moment names nothing, and without this the assistant has to guess or ask
 * — while the one fact that answers it is sitting in the viewport.
 *
 * # Why it gives way
 *
 * A selection is a deliberate act about one structure; the scanner's position
 * is a place. When both exist the selection is the more specific statement of
 * what the reader means, so it wins and the scanner is not sent at all — two
 * subjects in one prompt is how an answer ends up about the wrong one.
 *
 * # When it says nothing
 *
 * - The light is travelling. Where it happened to be when Send was pressed is
 *   not a place anybody chose.
 * - The plane is frontal. A depth runs head to foot, and "this part" of a
 *   frontal plane is most of the body; that is a different sentence, not this
 *   one.
 * - A drill or a review. Their subject is the patient, and the reader's answer
 *   there is a diagnosis, not a question about a region.
 * - There is nothing to say: no level and nothing crossed.
 */

type ScannedOrgan = ScannerContext["crossing"][number];

/** The largest structures named. The count covers the rest. */
export const SCANNER_CROSSING_MAX = 12;

export interface ScannerAimInput {
  enabled: boolean;
  /** Held under a finger or pinned: the reader put it there. */
  still: boolean;
  plane: SectionPlaneName;
  mode: SessionMode;
  /** How many structures are selected. Any at all, and the selection wins. */
  selected: number;
  /** The vertebral level the plane is at, when it is at one. */
  level: string | null;
  /** What the plane crosses, largest first. See `crossingAt`. */
  organIds: readonly string[];
  total: number;
  /** The nomenclature for an id, or null for one this scene does not hold. */
  organ: (organId: string) => ScannedOrgan | null;
}

export function scannerAim(input: ScannerAimInput): ScannerContext | null {
  if (!input.enabled || !input.still) return null;
  if (input.plane !== "axial" || input.mode !== "tutor") return null;
  if (input.selected > 0) return null;

  const crossing = input.organIds
    .map(input.organ)
    .filter((organ): organ is ScannedOrgan => organ !== null)
    .slice(0, SCANNER_CROSSING_MAX);
  if (!input.level && crossing.length === 0) return null;

  return {
    level: input.level,
    crossing,
    // Never fewer than were named: the count is "everything crossed".
    total: Math.max(input.total, crossing.length),
  };
}
