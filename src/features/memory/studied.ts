import type { ManifestOrgan } from "@/lib/schemas";

/** One structure a memory was about, and where in the atlas to find its mesh. */
export interface StudiedOrgan {
  id: string;
  name: string;
  node: string;
  file: string;
}

/**
 * The file the figure itself is drawn from. A surface region studied is
 * already on screen as part of the body, so it is not drawn a second time.
 */
export const FIGURE_FILE = "regional_male.glb";

/**
 * Most structures lit at once. A long session can touch dozens, and forty
 * organs glowing together say nothing about any one of them.
 */
export const STUDIED_LIMIT = 12;

/**
 * The structures a memory was about, as the figure can show them.
 *
 * In the order they were studied, each once. Anything the male atlas does not
 * hold — the female body's structures, or an id from an older manifest — is
 * skipped rather than guessed at: the figure is the male body.
 */
export function studiedOrgans(
  ids: readonly string[],
  organs: readonly ManifestOrgan[],
  limit = STUDIED_LIMIT,
): StudiedOrgan[] {
  const byId = new Map(organs.map((organ) => [organ.organ_id, organ]));
  const out: StudiedOrgan[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (out.length >= limit) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const organ = byId.get(id);
    if (!organ || organ.mesh_file === FIGURE_FILE) continue;
    out.push({ id, name: organ.name_en, node: organ.node, file: organ.mesh_file });
  }
  return out;
}
