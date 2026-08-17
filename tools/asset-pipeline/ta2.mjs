/**
 * Terminologia Anatomica 2, and the id slug both manifests are keyed by.
 *
 * Shared by `build-manifest.mjs` (male, Z-Anatomy) and
 * `build-female-manifest.mjs` (female, HRA). The two atlases come from
 * different sources and are built by different scripts, but they must agree on
 * what Latin a term carries and on how a name becomes an id — otherwise the
 * same structure would be spelled one way on one body and another way on the
 * other, which is the sort of difference a reader would read as anatomy.
 */

/**
 * Typographical defects in the vendored `TA2.csv`, and their corrections.
 *
 * These are faults in **the file**, not in Terminologia Anatomica. It arrives
 * with Z-Anatomy and is not ours to edit — editing a vendored standard would
 * make every future update a merge conflict, and would hide the defect from
 * whoever inherits this. So the file stays untouched and the correction is
 * applied on the way in, here, where it is visible and reviewable.
 *
 * Keyed by the English term **as the file spells it**, because that is the join
 * key and it must keep matching. `la` replaces the Latin, `en` the English.
 *
 * The bar for adding a line here is a **typographical** error — a letter
 * transposed or dropped, provable against the file's own neighbouring rows.
 * A term one merely disagrees with does not belong here. All three below were
 * caught by reading a labelled plate, not by a script.
 */
export const TA2_CORRECTIONS = {
  // Row 4211. Two i's where the `li` belongs. Every other coeliac term in the
  // file spells it correctly — `Nodi coeliaci`, `Plexus coeliacus`.
  "coeliac trunk": { la: "Truncus coeliacus" },
  // Row 4252. The neighbouring rows settle it: 4258 is `Arteria mesenterica
  // inferior` and the matching vein is `Vena mesenterica superior`.
  "superior mesenteric artery": { la: "Arteria mesenterica superior" },
  // Row 5119. An L where the I belongs; the Latin on that row is right.
  "lleocolic vein": { en: "Ileocolic vein" },
};

/**
 * TA2.csv is not conventional CSV: a UTF-8 BOM, then every row wrapped in one
 * pair of double quotes with `;`-separated fields inside. Splitting on `,` or
 * feeding it to a standard parser yields one giant column.
 */
export function parseTa2(text) {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const header = lines[0].replace(/^"|"$/g, "").split(";");
  const column = { en: header.indexOf("English"), la: header.indexOf("Latin") };
  for (const [name, position] of Object.entries(column)) {
    if (position < 0) {
      throw new Error(`TA2.csv is missing the ${name} column. Header: ${header.join(";")}`);
    }
  }

  const byEnglish = new Map();
  for (const line of lines.slice(1)) {
    const fields = line.replace(/^"|"$/g, "").split(";");
    if (fields.length !== header.length) continue;
    const english = fields[column.en].trim();
    if (!english) continue;
    // First occurrence wins: TA2 repeats some terms across regional sections.
    const key = english.toLowerCase();
    if (!byEnglish.has(key)) {
      const fix = TA2_CORRECTIONS[key];
      byEnglish.set(key, {
        en: fix?.en ?? english,
        la: fix?.la ?? fields[column.la].trim(),
      });
    }
  }

  // A correction that matches nothing is a correction for a row that has been
  // fixed upstream, or one whose key was mistyped here. Either way it is stale
  // and should be removed rather than left to rot.
  for (const key of Object.keys(TA2_CORRECTIONS)) {
    if (!byEnglish.has(key)) {
      throw new Error(
        `TA2_CORRECTIONS has an entry for "${key}", which is not in TA2.csv. ` +
          "If the vendored file was updated, delete the correction.",
      );
    }
  }

  return byEnglish;
}

export function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
