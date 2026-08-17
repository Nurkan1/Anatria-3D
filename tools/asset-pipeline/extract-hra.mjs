#!/usr/bin/env node
/**
 * Cut the female pelvic module out of the HRA united-female body.
 *
 *   node tools/asset-pipeline/extract-hra.mjs --source path/to/3d-vh-f-united.glb
 *   node tools/asset-pipeline/extract-hra.mjs --fetch      # download it first
 *
 * # Why this is not a Blender export
 *
 * The male atlas is exported from a .blend, so Blender is the tool. This source
 * is already glTF, and round-tripping it through Blender would throw away the
 * one thing that makes it trustworthy: every node carries `extras.ontologyid`
 * with its UBERON or FMA term, and Blender's glTF exporter drops extras.
 * Staying inside glTF keeps the node names byte-identical to the published
 * digital object, which is what lets anyone check this atlas against the HRA
 * portal structure by structure.
 *
 * # What comes out
 *
 * One .glb per system, named `<system>_female.glb` beside the male files, and
 * one report per system in `vendor/reports-female/`. The reports are committed
 * and carry the provenance the .glb no longer does — source node name, ontology
 * id, polygon count — so the chain from the published HRA object to a shipped
 * mesh can be read without downloading 202 MB.
 *
 * The meshes are never merged with the male ones and never land in the same
 * file. That is a licence boundary, not tidiness: the male atlas is CC BY-SA
 * 4.0 and this is CC BY 4.0, and combining the geometry into one work would
 * relicense the HRA's material under share-alike, which its authors did not
 * choose. Separate files stay a mere aggregation, and each keeps its own terms.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { cloneDocument, dedup, draco, flatten, prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

import { KNOWN_SOURCE_ERRATA, NOT_IN_TA2, SOURCE, STRUCTURES, SYSTEM_OF } from "./hra-selection.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT_DIR = join(REPO, "public", "anatomy");
const REPORT_DIR = join(HERE, "vendor", "reports-female");
const DEFAULT_SOURCE = join(HERE, "vendor", "hra", "3d-vh-f-united.glb");

/**
 * The build is pinned to one published file.
 *
 * The HRA republishes; a re-run against v1.6 that silently produced different
 * geometry under the same organ ids would be the worst kind of drift, because
 * nothing would look wrong. A mismatch here stops the build and asks a human
 * whether the new version was intended.
 */
const SOURCE_SHA256 = "472567a56896b9b7890508da6501fbf858e56aaa30745365f7a71ade782b529c";

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, fetch: false, allowUnpinned: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--source") args.source = argv[(i += 1)];
    else if (argv[i] === "--fetch") args.fetch = true;
    else if (argv[i] === "--allow-unpinned") args.allowUnpinned = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

async function ensureSource(path, shouldFetch) {
  if (existsSync(path)) return path;
  if (!shouldFetch) {
    throw new Error(
      `No source at ${path}.\n` +
        `Run with --fetch to download it (${SOURCE.url}), or pass --source <file>.`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  process.stderr.write(`Downloading ${SOURCE.url} …\n`);
  const response = await fetch(SOURCE.url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

function checkPin(path, allowUnpinned) {
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest === SOURCE_SHA256) return digest;
  const message =
    `Source checksum does not match the pinned ${SOURCE.version} object.\n` +
    `  expected ${SOURCE_SHA256}\n  actual   ${digest}\n` +
    "If the HRA has published a new version, review the node names before " +
    "updating SOURCE_SHA256 — organ ids are derived from them.";
  if (!allowUnpinned) throw new Error(message);
  process.stderr.write(`WARNING: ${message}\n`);
  return digest;
}

/** `Term, qualifier (side)` — the name a reader sees. */
export function displayName(entry) {
  const qualified = entry.qualifier ? `${entry.term}, ${entry.qualifier}` : entry.term;
  if (entry.side === "left") return `${qualified} (left)`;
  if (entry.side === "right") return `${qualified} (right)`;
  return qualified;
}

function triangleCount(mesh) {
  let total = 0;
  for (const primitive of mesh.listPrimitives()) {
    const indices = primitive.getIndices();
    const position = primitive.getAttribute("POSITION");
    const count = indices ? indices.getCount() : (position?.getCount() ?? 0);
    total += Math.floor(count / 3);
  }
  return total;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = await ensureSource(args.source, args.fetch);
  const sourceDigest = checkPin(source, args.allowUnpinned);

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.encoder": await draco3d.createEncoderModule(),
      "draco3d.decoder": await draco3d.createDecoderModule(),
    });

  const wanted = new Map(STRUCTURES.map((entry) => [entry.node, entry]));
  const bySystem = new Map();
  for (const entry of STRUCTURES) {
    const system = SYSTEM_OF.get(entry.node);
    if (!bySystem.has(system)) bySystem.set(system, []);
    bySystem.get(system).push(entry);
  }

  // Read once. Cloning per system costs less than re-parsing 202 MB five times,
  // and the document is mutated destructively below.
  process.stderr.write(`Reading ${source} …\n`);
  const master = await io.read(source);

  // Every mesh node must exist, and the check happens before any work: a typo
  // in the selection table should fail in seconds, not after four Draco passes.
  const present = new Set(
    master
      .getRoot()
      .listNodes()
      .map((node) => node.getName()),
  );
  const missing = [...wanted.keys()].filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(`Not in the source glb: ${missing.join(", ")}`);
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const summary = [];

  for (const [system, entries] of [...bySystem].sort()) {
    const document = cloneDocument(master);
    const keep = new Set(entries.map((entry) => entry.node));

    // Flatten first. The source nests meshes under grouping nodes, and disposing
    // a parent takes its children with it — so the hierarchy has to be gone
    // before anything is removed. Flatten also bakes the accumulated transforms
    // into each node, which is why the organs stay where they belong.
    await document.transform(flatten());

    for (const node of document.getRoot().listNodes()) {
      if (!keep.has(node.getName())) node.dispose();
    }

    // The viewer shades every organ itself from its own tissue palette, so the
    // source materials are weight with no effect. UVs go for the same reason:
    // nothing here is textured.
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        primitive.setMaterial(null);
        for (const semantic of primitive.listSemantics()) {
          if (semantic.startsWith("TEXCOORD_") || semantic.startsWith("COLOR_")) {
            primitive.setAttribute(semantic, null);
          }
        }
      }
    }

    const report = { objects: [] };
    const byName = new Map(document.getRoot().listNodes().map((n) => [n.getName(), n]));
    for (const entry of entries) {
      const node = byName.get(entry.node);
      const mesh = node?.getMesh();
      if (!mesh) throw new Error(`${entry.node} has no mesh after flatten`);
      report.objects.push({
        name: displayName(entry),
        organ_id: entry.id,
        node: entry.node,
        term: entry.term,
        qualifier: entry.qualifier ?? null,
        side: entry.side,
        // Read off the source node, never from the selection table. This is the
        // one field that says what the HRA itself calls this mesh, and a value
        // typed in by hand here would be an assertion rather than provenance.
        ontology_id: node.getExtras()?.ontologyid ?? null,
        source_label: node.getExtras()?.label ?? null,
        polygons: triangleCount(mesh),
        path: entry.path,
      });
    }

    await document.transform(
      prune({ keepAttributes: false }),
      dedup(),
      // Matching the male atlas: level 6, 14-bit positions, 10-bit normals. The
      // quantisation is lossy and the NOTICE says so.
      draco({
        method: "edgebreaker",
        encodeSpeed: 4,
        decodeSpeed: 5,
        quantizePosition: 14,
        quantizeNormal: 10,
      }),
    );

    const output = `${system}_female.glb`;
    await io.write(join(OUT_DIR, output), document);
    const bytes = statSync(join(OUT_DIR, output)).size;

    const polygons = report.objects.reduce((total, o) => total + o.polygons, 0);
    writeFileSync(
      join(REPORT_DIR, `${system}.json`),
      `${JSON.stringify(
        {
          system,
          sex: "female",
          source: { ...SOURCE, sha256: sourceDigest },
          output,
          draco: true,
          object_count: report.objects.length,
          objects: report.objects.sort((a, b) => a.name.localeCompare(b.name)),
        },
        null,
        1,
      )}\n`,
      "utf8",
    );

    summary.push({ system, count: report.objects.length, polygons, bytes });
    process.stderr.write(
      `  ${output.padEnd(28)} ${String(report.objects.length).padStart(3)} structures  ` +
        `${polygons.toLocaleString().padStart(9)} tris  ${(bytes / 1024).toFixed(0)} KB\n`,
    );
  }

  const total = summary.reduce(
    (acc, s) => ({ count: acc.count + s.count, bytes: acc.bytes + s.bytes }),
    { count: 0, bytes: 0 },
  );
  process.stderr.write(
    `\n${total.count} structures, ${(total.bytes / 1048576).toFixed(2)} MB across ${summary.length} files\n`,
  );

  const dropped = Object.keys(NOT_IN_TA2).length;
  if (dropped > 0) {
    process.stderr.write(`${dropped} structure(s) in the source deliberately not shipped (see NOT_IN_TA2)\n`);
  }
  for (const [node, note] of Object.entries(KNOWN_SOURCE_ERRATA)) {
    process.stderr.write(`errata: ${node} — ${note}\n`);
  }
  process.stderr.write("\nNow run: pnpm manifest:build:female\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
