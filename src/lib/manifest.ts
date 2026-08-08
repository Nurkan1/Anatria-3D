import { AnatomyManifestSchema, type AnatomyManifest, type ManifestOrgan } from "./schemas";

/**
 * The anatomy manifest and its meshes live in `public/`, so they ship inside
 * the web bundle and are fetched as ordinary same-origin URLs — no Tauri asset
 * protocol, no filesystem permission. At ~300 KB for a whole system that is a
 * better trade than granting the webview read access to disk.
 */
const MANIFEST_URL = "/anatomy/manifest.json";
const MESH_BASE = "/anatomy/";

export async function loadManifest(signal?: AbortSignal): Promise<AnatomyManifest> {
  const response = await fetch(MANIFEST_URL, signal ? { signal } : {});
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
