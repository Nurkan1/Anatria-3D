import type { ManifestOrgan } from "@/lib/schemas";

/**
 * Which structures make up the brain.
 *
 * # This used to be a workaround, and no longer is
 *
 * Z-Anatomy's collection nesting filed most of the brain outside `Brain`: the
 * right-sided gyri sat under that path while their left twins hung directly off
 * `Central nervous system`, and the corpus callosum, fornix, thalamus and
 * hippocampus sat outside it with no lateral twin to be recovered by. Asking
 * for everything under `Brain` returned 68 structures — one hemisphere and the
 * cerebellum — so this module paired each `_r` with its `_l` to reach 105, and
 * documented the deep midline structures as a known hole.
 *
 * The hierarchy is now repaired in the pipeline (`tools/asset-pipeline/hierarchy.mjs`),
 * so `Brain` holds 200 structures: both hemispheres, the diencephalon, the
 * whole brainstem and the cerebellum. The twin-pairing pass was measured
 * against the repaired manifest and adds nothing, so it is gone rather than
 * kept as insurance — a second rule that never fires is a second rule to
 * understand.
 *
 * The warning that used to stand here is withdrawn: this is the brain as the
 * atlas holds it, not a decorative selection with a hole in the middle.
 */

/** The node in the source hierarchy that everything cranial hangs from. */
const BRAIN_NODE = "Brain";

/**
 * Brain structure ids, sorted, from a manifest's organ list.
 *
 * Sorted rather than in manifest order so the set is stable to compare and to
 * read in a test failure; nothing downstream depends on the ordering.
 */
export function brainOrganIds(organs: readonly ManifestOrgan[]): string[] {
  return organs
    .filter((organ) => organ.path?.includes(BRAIN_NODE))
    .map((organ) => organ.organ_id)
    .sort();
}

/**
 * Whether there is enough of a brain loaded to be worth showing.
 *
 * A handful of meshes is not a brain, it is a mistake on screen — a fallback
 * that renders three gyri floating in the dark is worse than not appearing at
 * all. The number is a floor, not a target: the shipped manifest yields 200.
 */
export const ENOUGH_TO_DRAW = 40;
