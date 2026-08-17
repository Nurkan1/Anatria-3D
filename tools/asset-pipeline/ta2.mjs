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
      byEnglish.set(key, { en: english, la: fields[column.la].trim() });
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
