import type { ManifestOrgan } from "@/lib/schemas";

/**
 * Which structures make up the brain, as far as the manifest can say.
 *
 * # Why this is not a one-line filter
 *
 * The obvious rule — everything under `Central nervous system > Brain` — gives
 * **half a brain**. Z-Anatomy's tree is asymmetric: the right-sided gyri sit
 * under that path, while their left twins hang directly off `Central nervous
 * system` with no `Brain` level at all. Measured on the shipped manifest:
 *
 * - `path` contains "Brain" → 68 structures, right hemisphere and cerebellum
 * - pairing each `_r` with its `_l` twin → 105, both hemispheres
 *
 * That is where a naming rule stops. The corpus callosum, fornix, thalamus and
 * hippocampus are still outside it, because they are outside the `Brain`
 * subtree in the source data and have no lateral twin to be recovered by. They
 * are missing here, deliberately and knowingly: this set exists to draw an
 * ornament, and the honest way to get them is geometric — ask the mesh which
 * nodes sit inside the cranium — which belongs in the asset pipeline rather
 * than in a runtime guess.
 *
 * **So do not reach for this to teach with.** It is a decorative selection with
 * a known hole in the middle of it.
 */

/** The node in the source hierarchy that everything cranial hangs from. */
const BRAIN_NODE = "Brain";

/** Z-Anatomy's laterality suffixes, and the only pairing rule that is safe. */
const SIDES = ["_l", "_r"] as const;

function twinOf(organId: string): string | null {
  for (const side of SIDES) {
    if (organId.endsWith(side)) {
      const other = side === "_l" ? "_r" : "_l";
      return organId.slice(0, -side.length) + other;
    }
  }
  return null;
}

/**
 * Brain structure ids, sorted, from a manifest's organ list.
 *
 * Sorted rather than in manifest order so the set is stable to compare and to
 * read in a test failure; nothing downstream depends on the ordering.
 */
export function brainOrganIds(organs: readonly ManifestOrgan[]): string[] {
  const byId = new Map(organs.map((organ) => [organ.organ_id, organ]));
  const chosen = new Set<string>();

  for (const organ of organs) {
    if (organ.path?.includes(BRAIN_NODE)) chosen.add(organ.organ_id);
  }

  // Second pass, over what the first pass found. Adding twins while iterating
  // the whole list would also pull in the twin of anything that merely happens
  // to be adjacent, which is not the same rule.
  for (const organId of [...chosen]) {
    const twin = twinOf(organId);
    if (twin && byId.has(twin)) chosen.add(twin);
  }

  return [...chosen].sort();
}

/**
 * Whether there is enough of a brain loaded to be worth showing.
 *
 * A handful of meshes is not a brain, it is a mistake on screen — a fallback
 * that renders three gyri floating in the dark is worse than not appearing at
 * all. The number is a floor, not a target: the shipped manifest yields 105.
 */
export const ENOUGH_TO_DRAW = 40;
