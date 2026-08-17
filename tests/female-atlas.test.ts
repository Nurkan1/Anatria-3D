import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AnatomyManifestSchema } from "../src/lib/schemas";
import { parseTa2 } from "../tools/asset-pipeline/ta2.mjs";
import {
  NOT_IN_TA2,
  STRUCTURES,
  SYSTEM_OF,
} from "../tools/asset-pipeline/hra-selection.mjs";

const REPO = join(__dirname, "..");
const ta2 = parseTa2(readFileSync(join(REPO, "tools/asset-pipeline/vendor/TA2.csv"), "utf8"));

/**
 * The male atlas needs no test like this, because Z-Anatomy names its objects
 * with TA2 terms and the join either matches or drops the structure. The female
 * atlas is different in kind: its source names structures with UBERON and FMA
 * labels, so somebody had to write down which TA2 term applies to which mesh.
 *
 * That hand-written table is the one place in this project where a typo becomes
 * a false statement about anatomy rather than a crash — "Superior rectal vein"
 * looks entirely plausible and is not what TA2 calls it. These tests are what
 * stop a plausible-looking term from shipping.
 */
describe("the female selection table", () => {
  it("names every structure with a term Terminologia Anatomica actually lists", () => {
    const invented = STRUCTURES.filter((entry) => !ta2.has(entry.term.toLowerCase())).map(
      (entry) => `${entry.term} (${entry.node})`,
    );
    expect(invented).toEqual([]);
  });

  it("gives every structure its own organ_id", () => {
    const ids = STRUCTURES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a qualifier on every pair that shares one TA2 term and a side", () => {
    // The HRA splits structures TA2 treats as one — each hip bone into compact
    // and spongy tissue, the bladder fundus into dome and base. Without a
    // qualifier those two would be one structure with two meshes, and the tree
    // would show the reader a duplicate row with no way to tell them apart.
    const seen = new Map<string, string>();
    for (const entry of STRUCTURES) {
      const key = `${entry.term}|${entry.side}|${entry.qualifier ?? ""}`;
      expect(seen.has(key), `${key} is claimed twice`).toBe(false);
      seen.set(key, entry.node);
    }
  });

  it("files every structure under a system", () => {
    for (const entry of STRUCTURES) {
      expect(SYSTEM_OF.get(entry.node), entry.node).toBeTruthy();
    }
  });

  it("records why each dropped structure was dropped", () => {
    for (const [node, reason] of Object.entries(NOT_IN_TA2)) {
      expect(reason.length, node).toBeGreaterThan(20);
      // A structure cannot be both shipped and dropped.
      expect(STRUCTURES.some((entry) => entry.node === node)).toBe(false);
    }
  });
});

describe("the shipped female manifest", () => {
  const manifest = AnatomyManifestSchema.parse(
    JSON.parse(readFileSync(join(REPO, "public/anatomy/manifest_female.json"), "utf8")),
  );

  it("is a female manifest under the HRA's licence", () => {
    expect(manifest.gender_model).toBe("female");
    // CC BY 4.0, not the male atlas's share-alike. Getting this wrong in the
    // shipped file would misstate the terms the meshes are distributed under.
    expect(manifest.license).toBe("CC-BY-4.0");
    expect(manifest.attribution).toMatch(/Human Reference Atlas/);
  });

  it("carries every structure the selection table ships", () => {
    expect(manifest.organs).toHaveLength(STRUCTURES.length);
    const ids = new Set(manifest.organs.map((organ) => organ.organ_id));
    for (const entry of STRUCTURES) expect(ids.has(entry.id), entry.id).toBe(true);
  });

  it("opens on something, so the viewport is never empty", () => {
    expect(manifest.systems.some((entry) => entry.load_on_start)).toBe(true);
  });

  it("points every organ at a female mesh file", () => {
    for (const organ of manifest.organs) {
      expect(organ.mesh_file, organ.organ_id).toMatch(/_female\.glb$/);
    }
  });

  it("gives every organ a Latin term and a node to find it by", () => {
    for (const organ of manifest.organs) {
      expect(organ.ta2_latin.length, organ.organ_id).toBeGreaterThan(0);
      expect(organ.node, organ.organ_id).toMatch(/^VH_F_/);
    }
  });
});

describe("the anatomy this subject actually has", () => {
  const female = AnatomyManifestSchema.parse(
    JSON.parse(readFileSync(join(REPO, "public/anatomy/manifest_female.json"), "utf8")),
  );
  const names = female.organs.map((organ) => organ.name_en);

  it("keeps the sixth lumbar vertebra", () => {
    // A real variant, in roughly one person in twenty. Someone tidying the
    // series to the expected five would be correcting the atlas to match a
    // textbook rather than the body it was made from.
    expect(names).toContain("Lumbar vertebra, L6");
    expect(names.filter((name) => name.startsWith("Lumbar vertebra"))).toHaveLength(6);
  });

  it("keeps the uneven pyramid count between the kidneys", () => {
    // Eleven on the left, ten on the right. Ordinary variation — a kidney has
    // between eight and eighteen — and not a dropped mesh to go looking for.
    const pyramids = (side: string) =>
      names.filter((name) => name.startsWith("Renal pyramid") && name.endsWith(`(${side})`));
    expect(pyramids("left")).toHaveLength(11);
    expect(pyramids("right")).toHaveLength(10);
  });

  it("opens the kidney further than the male atlas does", () => {
    // The claim the README makes, asserted. The male atlas models a kidney as
    // one mesh; if this ever regressed to the same, the comparison would become
    // a false statement in the documentation.
    const male = AnatomyManifestSchema.parse(
      JSON.parse(readFileSync(join(REPO, "public/anatomy/manifest.json"), "utf8")),
    );
    const renal = (m: typeof male) => m.organs.filter((organ) => organ.system === "renal");
    expect(renal(female).length).toBeGreaterThan(renal(male).length);
  });
});

describe("the two atlases", () => {
  const male = AnatomyManifestSchema.parse(
    JSON.parse(readFileSync(join(REPO, "public/anatomy/manifest.json"), "utf8")),
  );
  const female = AnatomyManifestSchema.parse(
    JSON.parse(readFileSync(join(REPO, "public/anatomy/manifest_female.json"), "utf8")),
  );

  it("never share a mesh file", () => {
    // The licence boundary, asserted. The male meshes are CC BY-SA 4.0 and the
    // female CC BY 4.0; one file carrying both would force share-alike onto
    // material whose authors chose attribution-only.
    const maleFiles = new Set(male.organs.map((organ) => organ.mesh_file));
    const femaleFiles = new Set(female.organs.map((organ) => organ.mesh_file));
    for (const file of femaleFiles) expect(maleFiles.has(file)).toBe(false);
  });

  it("are licensed separately", () => {
    expect(male.license).not.toBe(female.license);
  });
});
