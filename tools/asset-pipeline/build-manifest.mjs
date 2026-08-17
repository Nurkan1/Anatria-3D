#!/usr/bin/env node
/**
 * Build `public/anatomy/manifest.json` from the Blender export reports.
 *
 *   node tools/asset-pipeline/build-manifest.mjs
 *
 * Reads every report in `vendor/reports/`, so growing the atlas from the heart
 * to the whole body means running another export — no code change here.
 *
 * The nomenclature join is automatic: Z-Anatomy names its objects with the
 * exact English term from Terminologia Anatomica, which is also the `English`
 * column of TA2.csv. The glTF node name is therefore the key that pulls in the
 * Latin term, with no mapping table to maintain or drift.
 *
 * The manifest carries professional nomenclature only — TA2 Latin and clinical
 * English. Localised labels are deliberately absent: explaining an anatomical
 * term is audience-dependent, so the agent does it per turn against the user's
 * profile and language rather than reading a frozen table.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseTa2, slugify } from "./ta2.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TA2_CSV = join(HERE, "vendor", "TA2.csv");
const REPORTS = join(HERE, "vendor", "reports");
const OUT = join(REPO, "public", "anatomy", "manifest.json");

const ATTRIBUTION =
  "Meshes adapted from Z-Anatomy (CC BY-SA 4.0), itself derived from " +
  "BodyParts3D / DBCLS (CC BY-SA 2.1 JP). See NOTICE.";

/** Systems fetched at startup. Everything else loads when switched on. */
const LOAD_ON_START = new Set(["skeletal"]);

/**
 * Who claims a structure that belongs to more than one system.
 *
 * Plenty of structures genuinely sit in two collections — a bone landmark is
 * both a skeletal feature and a muscle attachment, a tooth is both digestive
 * and skeletal. Each gets one manifest entry, and this decides which system it
 * is filed under.
 *
 * Reading the report files in name order would let `muscular` claim the bone
 * landmarks simply because "m" sorts before "s" — and a student who solos the
 * skeleton would find its features missing. Order by anatomy, not by filename.
 */
const SYSTEM_PRIORITY = [
  "skeletal",
  "articular",
  "muscular",
  "nervous",
  "cardiovascular",
  "respiratory",
  "digestive",
  "renal",
  "endocrine",
  "reproductive",
  "lymphatic",
  "visceral",
  "regional",
];

function byPriority(a, b) {
  const rank = (system) => {
    const index = SYSTEM_PRIORITY.indexOf(system);
    return index < 0 ? SYSTEM_PRIORITY.length : index;
  };
  return rank(a.system) - rank(b.system);
}

/**
 * `8: Visceral systems` is flat in the atlas — 479 organ landmarks (borders,
 * impressions, segments, lobes) with no per-organ split. They belong to five
 * different systems, so each is routed by the organ its name refers to.
 *
 * Order matters: the first match wins, so narrower terms come first.
 */
const VISCERAL_ROUTES = [
  [
    "respiratory",
    /lung|bronch|trache|pleur|larynx|laryng|alveol|pulmonar|nasal|nasopharynx|oropharynx|pharyn|sinus/i,
  ],
  ["renal", /kidney|renal|ureter|bladder|urethra|nephr/i],
  ["endocrine", /thyroid|parathyroid|suprarenal|adrenal|pituitar|hypophys|pineal|thymus/i],
  ["reproductive", /uter|ovar|testis|testicul|prostat|penis|vagin|scrot|epididym|seminal|vas deferens/i],
  [
    "digestive",
    /stomach|gastr|liver|hepat|pancrea|intestin|duoden|jejun|ile|colon|caec|cec|rect|anal|oesophag|esophag|gallbladder|bile|biliar|tongue|lingual|palat|tooth|teeth|salivary|parotid|submandib|sublingual|peritone|omentum|mesenter|appendi/i,
  ],
];

function routeVisceral(name) {
  for (const [system, pattern] of VISCERAL_ROUTES) {
    if (pattern.test(name)) return system;
  }
  return null;
}

/**
 * Split a Z-Anatomy object name into the term TA2 knows and its laterality.
 *
 * Names carry dotted suffixes, and only two of them are laterality:
 *
 *   `.l` `.r`    side
 *   `.el` `.er`  muscle *insertion* marking, left/right
 *   `.ol` `.or`  muscle *origin* marking, left/right
 *   `.i` `.j`    bone landmark and grouping nodes
 *   `.t` `.s` `.g` `.st`   sense-organ parts, surfaces, groups
 *
 * They stack (`Base of cochlea.t.l`), so they are peeled in a loop. Getting
 * this wrong is expensive: `.l`/`.r` alone matched 72% of the atlas against
 * TA2, adding the structural markers reached 80%, and including the
 * origin/insertion pairs — which only appear once muscle insertions are
 * exported — took it to 91%. What remains is variant terms in parentheses that
 * TA2 genuinely does not list.
 */
const NAME_SUFFIX = /\.(l|r|el|er|ol|or|i|j|t|s|g|st)$/i;

function parseObjectName(name) {
  let base = name.trim();
  let laterality = null;

  for (;;) {
    const match = NAME_SUFFIX.exec(base);
    if (!match) break;
    const suffix = match[1].toLowerCase();
    // Only the first side marker counts; the rest are structural. Origin and
    // insertion markers carry their side in the second character.
    if (laterality === null) {
      const side = suffix.length === 1 ? suffix : suffix.slice(-1);
      if (side === "l" && suffix !== "st") laterality = "left";
      else if (side === "r") laterality = "right";
    }
    base = base.slice(0, match.index);
  }

  // Some names end in a stray full stop that no TA2 entry carries.
  base = base.trim().replace(/\.+$/, "").trim();

  // Parenthesised names mark anatomical variants; TA2 lists them unwrapped.
  const wrapped = /^\((.*)\)$/.exec(base);
  if (wrapped) base = wrapped[1].trim();

  return { base: base.replace(/\.+$/, "").trim(), laterality };
}

function loadReports() {
  if (!existsSync(REPORTS)) {
    throw new Error(`No export reports in ${REPORTS}. Run the Blender export first.`);
  }
  const files = readdirSync(REPORTS).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new Error(`No export reports in ${REPORTS}. Run the Blender export first.`);
  }
  return files
    .map((name) => JSON.parse(readFileSync(join(REPORTS, name), "utf8")))
    .sort(byPriority);
}

function main() {
  const ta2 = parseTa2(readFileSync(TA2_CSV, "utf8"));
  const reports = loadReports();

  const organs = [];
  const systems = [];
  const unmatched = [];
  /** organ_id -> the object name that claimed it, for collision detection. */
  const seen = new Map();
  let shared = 0;
  const unrouted = [];

  for (const report of reports) {
    if (!report.system) {
      throw new Error(`Report for ${report.output} has no "system" — re-run with --system.`);
    }
    const meshFile = report.output.split(/[/\\]/).pop();
    let matched = 0;

    for (const object of report.objects) {
      const { base, laterality } = parseObjectName(object.name);
      const term = ta2.get(base.toLowerCase());
      if (!term) {
        // Z-Anatomy carries a few scratch objects with names like "?x.l".
        // Excluding them beats shipping a structure with no nomenclature.
        unmatched.push(object.name);
        continue;
      }

      const organId = slugify(object.name);
      const claimedBy = seen.get(organId);
      if (claimedBy !== undefined) {
        if (claimedBy === object.name) {
          // The same structure really does belong to two systems — a tooth is
          // both digestive and skeletal, and Blender puts one mesh in both
          // collections. One manifest entry, first system wins; the duplicate
          // geometry in the other .glb simply goes unreferenced.
          shared += 1;
          continue;
        }
        // Different names normalising to one id would silently merge two
        // distinct structures. That is a pipeline bug, not anatomy.
        throw new Error(
          `Distinct objects collide on organ_id "${organId}": ` +
            `"${claimedBy}" and "${object.name}"`,
        );
      }
      seen.set(organId, object.name);

      // `visceral` is an export bucket, not a system the app knows about:
      // its contents belong to whichever organ they describe.
      let system = report.system;
      if (system === "visceral") {
        const routed = routeVisceral(term.en);
        if (routed === null) {
          unrouted.push(term.en);
          continue;
        }
        system = routed;
      }

      const side = laterality === "left" ? " (left)" : laterality === "right" ? " (right)" : "";
      organs.push({
        organ_id: organId,
        ta2_latin: term.la || term.en,
        name_en: term.en + side,
        system,
        mesh_file: meshFile,
        node: object.name,
        // Z-Anatomy's collection nesting is the anatomical hierarchy, and it is
        // what lets the viewer study an organ with everything inside it.
        path: object.path ?? [],
      });
      matched += 1;
    }

    void matched;
  }

  // A system's structures can arrive from several exports, so the system list
  // is derived from the organs rather than declared once per export file.
  const counts = new Map();
  for (const organ of organs) {
    counts.set(organ.system, (counts.get(organ.system) ?? 0) + 1);
  }
  for (const [system, organ_count] of counts) {
    systems.push({ system, organ_count, load_on_start: LOAD_ON_START.has(system) });
  }

  if (organs.length === 0) {
    throw new Error("No exported object matched a TA2 term — check the export reports.");
  }
  if (!systems.some((entry) => entry.load_on_start)) {
    // An atlas that opens to an empty viewport looks broken rather than lazy.
    systems[0].load_on_start = true;
  }

  organs.sort((a, b) => a.ta2_latin.localeCompare(b.ta2_latin));
  systems.sort((a, b) => a.system.localeCompare(b.system));

  writeFileSync(
    OUT,
    `${JSON.stringify(
      { version: 1, gender_model: "male", attribution: ATTRIBUTION, license: "CC-BY-SA-4.0", systems, organs },
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
  if (unrouted.length > 0) {
    const unique = [...new Set(unrouted)];
    console.log(`  ${unique.length} visceral landmark(s) matched no organ — extend VISCERAL_ROUTES:`);
    for (const name of unique.slice(0, 12)) console.log(`      ${name}`);
  }
  if (shared > 0) {
    console.log(`  ${shared} structure(s) shared across systems, listed once`);
  }
  if (unmatched.length > 0) {
    const preview = unmatched.slice(0, 5).join(", ");
    console.log(`  ${unmatched.length} skipped (no TA2 match): ${preview}${unmatched.length > 5 ? "…" : ""}`);
  }
}

main();
