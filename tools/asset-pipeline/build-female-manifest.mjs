#!/usr/bin/env node
/**
 * Build `public/anatomy/manifest_female.json` from the HRA extraction reports.
 *
 *   node tools/asset-pipeline/build-female-manifest.mjs
 *
 * # Why a second manifest and not a `sex` column in the first
 *
 * Because the manifest is licensed content, not an index. It carries the
 * derived label data — TA2 Latin, clinical English, the anatomical hierarchy —
 * and that data inherits the licence of the atlas it describes. The male atlas
 * is CC BY-SA 4.0 through Z-Anatomy and BodyParts3D; this one is CC BY 4.0
 * through the HRA. Merging the two into one document would put share-alike
 * material and attribution-only material in a single file and force one licence
 * onto both — in practice relicensing the HRA's work more restrictively than
 * its authors chose.
 *
 * Two documents keep that boundary structural rather than a convention someone
 * has to remember. They also make the other truth structural: these are two
 * different bodies, from two different people, and no organ of one belongs
 * inside the other. Switching sex reloads the atlas because it genuinely is a
 * different atlas.
 *
 * # What this script does and does not decide
 *
 * It decides nothing about anatomy. Every term comes from `hra-selection.mjs`,
 * every Latin form from TA2.csv, and this file fails rather than guess if a
 * term is absent. Its whole job is the join.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseTa2 } from "./ta2.mjs";
import { SOURCE } from "./hra-selection.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TA2_CSV = join(HERE, "vendor", "TA2.csv");
const REPORTS = join(HERE, "vendor", "reports-female");
const OUT = join(REPO, "public", "anatomy", "manifest_female.json");

const ATTRIBUTION =
  "Meshes from the Human Reference Atlas (HRA) 3D Reference Organ Library, " +
  "HuBMAP Consortium / NIH (CC BY 4.0), derived from the Visible Human Female " +
  "dataset of the U.S. National Library of Medicine. See NOTICE.";

/** The same credit in one line, for the footer of an exported image. */
const CREDIT = "NIH Human Reference Atlas / Visible Human Female (NLM)";

/**
 * Opened first, so the viewport is never empty.
 *
 * The pelvis rather than the reproductive organs, and deliberately: the uterus
 * on its own is a shape floating in the dark. Inside the pelvic girdle it is
 * anatomy, and every other structure in this module is described by where it
 * sits relative to those bones.
 */
const LOAD_ON_START = new Set(["skeletal"]);

function loadReports() {
  if (!existsSync(REPORTS)) {
    throw new Error(`No reports in ${REPORTS}. Run extract-hra.mjs first.`);
  }
  const files = readdirSync(REPORTS)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No reports in ${REPORTS}. Run extract-hra.mjs first.`);
  }
  return files.map((name) => JSON.parse(readFileSync(join(REPORTS, name), "utf8")));
}

function main() {
  const ta2 = parseTa2(readFileSync(TA2_CSV, "utf8"));
  const reports = loadReports();

  const organs = [];
  const seen = new Map();

  for (const report of reports) {
    if (report.sex !== "female") {
      throw new Error(`${report.output} is not a female report — check ${REPORTS}.`);
    }
    for (const object of report.objects) {
      const term = ta2.get(object.term.toLowerCase());
      if (!term) {
        // The extractor is supposed to have caught this. Reaching it here means
        // the two scripts disagree, which is worse than a missing term.
        throw new Error(
          `"${object.term}" (${object.node}) is not in TA2.csv. ` +
            "Fix the term in hra-selection.mjs; do not invent Latin for it.",
        );
      }

      const claimedBy = seen.get(object.organ_id);
      if (claimedBy !== undefined) {
        throw new Error(
          `Two structures claim organ_id "${object.organ_id}": ` +
            `"${claimedBy}" and "${object.node}"`,
        );
      }
      seen.set(object.organ_id, object.node);

      organs.push({
        organ_id: object.organ_id,
        // The qualifier belongs to the English name, not to the Latin: TA2 has
        // one "Os ilium", and "Os ilium, compact bone" would be a term that
        // does not exist. The distinction the qualifier draws is real, and it
        // is drawn in the name the reader reads.
        ta2_latin: term.la || term.en,
        name_en: object.name,
        // Carried through so the viewer can tell twelve thoracic vertebrae
        // apart. TA2 names the class; this names which one.
        ...(object.qualifier ? { qualifier: object.qualifier } : {}),
        system: report.system,
        mesh_file: report.output,
        node: object.node,
        path: object.path ?? [],
      });
    }
  }

  if (organs.length === 0) {
    throw new Error("No structures in the reports — check the extraction.");
  }

  const counts = new Map();
  for (const organ of organs) {
    counts.set(organ.system, (counts.get(organ.system) ?? 0) + 1);
  }
  const systems = [...counts]
    .map(([system, organ_count]) => ({
      system,
      organ_count,
      load_on_start: LOAD_ON_START.has(system),
    }))
    .sort((a, b) => a.system.localeCompare(b.system));

  if (!systems.some((entry) => entry.load_on_start)) {
    systems[0].load_on_start = true;
  }

  organs.sort((a, b) => a.ta2_latin.localeCompare(b.ta2_latin));

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        version: 1,
        gender_model: "female",
        attribution: ATTRIBUTION,
        credit: CREDIT,
        license: "CC-BY-4.0",
        source: SOURCE,
        systems,
        organs,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Wrote ${OUT}`);
  console.log(`  ${organs.length} structures total`);
  for (const entry of systems) {
    const when = entry.load_on_start ? "eager" : "on demand";
    console.log(`  ${entry.system}: ${entry.organ_count} (${when})`);
  }
}

main();
