import {
  AnatomyManifestSchema,
  type AnatomyManifest,
  type GenderModel,
  type ManifestOrgan,
} from "./schemas";

/**
 * The anatomy manifest and its meshes live in `public/`, so they ship inside
 * the web bundle and are fetched as ordinary same-origin URLs — no Tauri asset
 * protocol, no filesystem permission. At ~300 KB for a whole system that is a
 * better trade than granting the webview read access to disk.
 */
const MESH_BASE = "/anatomy/";

/**
 * One manifest per body, and they are genuinely separate documents.
 *
 * Not a `sex` column in one file, for two reasons that both matter. The
 * licences differ — the male atlas is CC BY-SA 4.0 through Z-Anatomy, the
 * female CC BY 4.0 through the HRA — and a manifest carries the derived label
 * data, so merging them would force one licence onto both. And the bodies are
 * two different people: nothing in one is positioned to sit inside the other,
 * so there is no view in which both are on screen at once.
 */
const MANIFEST_URL: Record<GenderModel, string> = {
  male: "/anatomy/manifest.json",
  female: "/anatomy/manifest_female.json",
};

export async function loadManifest(
  gender: GenderModel,
  signal?: AbortSignal,
): Promise<AnatomyManifest> {
  const response = await fetch(MANIFEST_URL[gender], signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`Could not load the anatomy manifest (HTTP ${response.status}).`);
  }

  const parsed = AnatomyManifestSchema.safeParse(await response.json());
  if (!parsed.success) {
    // A malformed manifest means the asset pipeline and the app disagree.
    // Failing here beats rendering a partially-labelled body.
    throw new Error(`The anatomy manifest is malformed: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function meshUrl(file: string): string {
  return MESH_BASE + file;
}

/**
 * Mesh files the given systems need, in stable order.
 *
 * Derived from the organs, not the system list: Z-Anatomy's own collections are
 * flat, so one system's structures can arrive from several exports and no
 * single file "belongs" to a system.
 */
export function meshFilesForSystems(
  manifest: AnatomyManifest,
  systems: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      manifest.organs
        .filter((organ) => systems.has(organ.system))
        .map((organ) => organ.mesh_file),
    ),
  ].sort();
}

export function organsInFile(manifest: AnatomyManifest, file: string): ManifestOrgan[] {
  return manifest.organs.filter((organ) => organ.mesh_file === file);
}
