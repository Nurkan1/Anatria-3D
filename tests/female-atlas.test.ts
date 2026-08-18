import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AnatomyManifestSchema } from "../src/lib/schemas";
import {
  ADDED_TERM_CORRECTIONS,
  ADDED_TERM_OPEN_QUESTIONS,
  TA2_CORRECTIONS,
  parseTa2,
} from "../tools/asset-pipeline/ta2.mjs";
import {
  NOT_IN_TA2,
  OUT_OF_SCOPE,
  STRUCTURES,
  SYSTEM_OF,
} from "../tools/asset-pipeline/hra-selection.mjs";

const REPO = join(__dirname, "..");
const ta2 = parseTa2(readFileSync(join(REPO, "tools/asset-pipeline/vendor/TA2.csv"), "utf8"));

const MANIFESTS = ["manifest.json", "manifest_female.json"] as const;

function manifestOf(file: string) {
  return AnatomyManifestSchema.parse(
    JSON.parse(readFileSync(join(REPO, "public/anatomy", file), "utf8")),
  );
}

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
    for (const [node, reason] of Object.entries({ ...NOT_IN_TA2, ...OUT_OF_SCOPE })) {
      expect(reason.length, node).toBeGreaterThan(20);
      // A structure cannot be both shipped and dropped.
      expect(STRUCTURES.some((entry) => entry.node === node)).toBe(false);
    }
  });

  it("keeps a missing term and a judgement in separate lists", () => {
    // `NOT_IN_TA2` records what the standard lacks; `OUT_OF_SCOPE` records a
    // decision. Merging them would let a decision borrow the standard's
    // authority — the umbilical vessels are dropped because a placenta without
    // its plates, amnion and cord teaches nothing, not because TA2 is silent.
    // TA2 names them both.
    for (const node of Object.keys(OUT_OF_SCOPE)) {
      expect(Object.keys(NOT_IN_TA2)).not.toContain(node);
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

  it("opens whole, so the trunk is never a pelvis with nothing in it", () => {
    // Every system, unlike the male atlas, which opens on the skeleton and
    // waits to be asked for the rest. That is right for 37 MB across thirteen
    // files and wrong for 5.3 MB across seven: the saving was not worth having,
    // and the reader paid for it at every switch by ticking six boxes back on.
    //
    // A bare pelvic girdle is also the exact shape that reads as a failed load.
    expect(manifest.systems.every((entry) => entry.load_on_start)).toBe(true);
    expect(manifest.systems.length).toBe(7);
  });

  it("still opens the male atlas on one system only", () => {
    // The two answers are different on purpose, and the reason is size. If the
    // male atlas ever starts opening whole, that is 37 MB mounted to look at a
    // kidney, and this test is where it gets noticed.
    const male = manifestOf("manifest.json");
    expect(male.systems.filter((entry) => entry.load_on_start)).toHaveLength(1);
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
    //
    // Checked by id rather than by name, because the names deliberately differ:
    // L1 to L5 carry TA2's own numbered terms and L6 cannot, since TA2 stops at
    // five.
    const lumbar = female.organs.filter((organ) => /^vertebra_l\d+$/.test(organ.organ_id));
    expect(lumbar).toHaveLength(6);
    expect(lumbar.map((organ) => organ.organ_id).sort()).toEqual([
      "vertebra_l1",
      "vertebra_l2",
      "vertebra_l3",
      "vertebra_l4",
      "vertebra_l5",
      "vertebra_l6",
    ]);
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

describe("the vendored TA2.csv, and the typos in it", () => {
  it("ships corrected Latin for the rows that carry a typo", () => {
    // These are faults in the file, not in Terminologia Anatomica, and they
    // reach the reader: both were found on a labelled plate, printed under a
    // vessel. The file itself stays untouched — it arrives with Z-Anatomy —
    // so the correction is applied on the way in.
    expect(ta2.get("coeliac trunk")?.la).toBe("Truncus coeliacus");
    expect(ta2.get("superior mesenteric artery")?.la).toBe("Arteria mesenterica superior");
    expect(ta2.get("lleocolic vein")?.en).toBe("Ileocolic vein");
  });

  it("still keys the corrected rows by what the file actually spells", () => {
    // The English is the join key. Correcting it in place would break every
    // lookup, so "Lleocolic vein" stays the key and only the displayed value
    // changes.
    expect(ta2.has("lleocolic vein")).toBe(true);
    expect(ta2.has("ileocolic vein")).toBe(false);
  });

  it("reaches the shipped atlases", () => {
    for (const file of ["manifest.json", "manifest_female.json"]) {
      const manifest = AnatomyManifestSchema.parse(
        JSON.parse(readFileSync(join(REPO, "public/anatomy", file), "utf8")),
      );
      const latin = manifest.organs.map((organ) => organ.ta2_latin);
      expect(latin, file).not.toContain("Truncus coeiiacus");
      expect(latin, file).not.toContain("Arteria mesenteries superior");
    }
  });

  it("spells no Latin term with a diacritic", () => {
    // The file sits the Latin column beside the French one and the accents
    // bled across — 50 rows read `latérales`. Latin anatomical terms carry no
    // diacritics at all, so this holds for every row rather than a listed few,
    // and it is what makes the blanket rule in `ta2.mjs` safe to keep.
    for (const file of MANIFESTS) {
      const accented = manifestOf(file).organs.filter((organ) =>
        [...organ.ta2_latin].some((character) => character.codePointAt(0)! > 127),
      );
      expect(accented.map((organ) => `${organ.organ_id}: ${organ.ta2_latin}`), file).toEqual([]);
    }
  });

  it("never repeats a word back to back in a Latin term", () => {
    // The signature of the file's other defect: a word from the row's synonym,
    // or the term's own head noun, left stuck on — `Regio retromalleolaris
    // lateralis regio`, `Flexor digiti minimi pedis pedis`. Every one of these
    // was visible on screen and none was caught by a build.
    for (const file of MANIFESTS) {
      const doubled = manifestOf(file).organs.filter((organ) => {
        const words = organ.ta2_latin.toLowerCase().split(/\s+/);
        return words.some((word, index) => index > 0 && word === words[index - 1]);
      });
      expect(doubled.map((organ) => `${organ.organ_id}: ${organ.ta2_latin}`), file).toEqual([]);
    }
  });

  it("names the metatarsophalangeal capsules after a joint in the foot", () => {
    // The worst single defect found: row 7139 carried row 7138's glenohumeral
    // Latin, so the label on a mesh in the foot named a joint in the shoulder.
    // A reader checking the term against the model would have been told the
    // model was wrong.
    const capsule = manifestOf("manifest.json").organs.find(
      (organ) => organ.organ_id === "articular_capsules_of_metatarsophalangeal_joints_l",
    );
    expect(capsule?.ta2_latin).toMatch(/metatarsophalange/);
    expect(capsule?.ta2_latin).not.toMatch(/glenohumer/);
  });

  it("gives both renal arteries the term TA2 actually publishes", () => {
    // TA2 names this vessel once, unsided, at row 4269. The vendored file adds
    // `Arteria renum dextra/sinistra` in its own block past the standard's last
    // term; the side already reaches the reader through `name_en`. Both atlases
    // carry these two organs, so a divergence here would show as anatomy.
    for (const file of MANIFESTS) {
      const renal = manifestOf(file).organs.filter((organ) =>
        /^(left|right)_renal_artery$/.test(organ.organ_id),
      );
      expect(renal, file).toHaveLength(2);
      for (const artery of renal) expect(artery.ta2_latin, artery.organ_id).toBe("Arteria renalis");
    }
  });

  it("keeps the standard's corrections apart from our own compositions", () => {
    // `TA2_CORRECTIONS` restores what FIPAT published and can be checked
    // against it. `ADDED_TERM_CORRECTIONS` covers rows that are not TA2 at all,
    // where the replacement is composed here. A key in both lists would let a
    // composition of ours be read as a citation of the standard.
    for (const key of Object.keys(ADDED_TERM_CORRECTIONS)) {
      expect(Object.keys(TA2_CORRECTIONS), key).not.toContain(key);
    }
    // And a term we declined to touch must not also appear as one we fixed.
    for (const key of Object.keys(ADDED_TERM_OPEN_QUESTIONS)) {
      expect(Object.keys(ADDED_TERM_CORRECTIONS), key).not.toContain(key);
    }
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

  it("call the same vertebra by the same name", () => {
    // The two atlases reach their nomenclature by different routes — the male
    // through Z-Anatomy's own object names, the female through a table written
    // by hand — and they must still land on the same word. A reader comparing a
    // male and a female spine should be reading anatomy, not two conventions.
    //
    // TA2 names each vertebra individually (`Vertebra T7` renders *Vertebra
    // thoracis VII*), so neither atlas needs a qualifier for them.
    const byId = (m: typeof male) => new Map(m.organs.map((o) => [o.organ_id, o]));
    const maleById = byId(male);
    const femaleById = byId(female);

    const shared = [...femaleById.keys()].filter(
      (id) => /^vertebra_[ctl]\d+$|^atlas_c1$|^axis_c2$|^sacrum$|^coccyx$/.test(id) && maleById.has(id),
    );
    // C3-C7, T1-T12, L1-L5, atlas, axis, sacrum, coccyx.
    expect(shared).toHaveLength(26);

    for (const id of shared) {
      expect(femaleById.get(id)!.ta2_latin, id).toBe(maleById.get(id)!.ta2_latin);
      expect(femaleById.get(id)!.qualifier, id).toBeUndefined();
    }
  });

  it("keeps the qualifier only where TA2 runs out", () => {
    // TA2 stops at L5 — it does not name a sixth lumbar vertebra, because it
    // does not expect one. So L6 is the single vertebra in either atlas that
    // still needs the class term plus a qualifier, and the male atlas has no
    // counterpart for it at all. That is the variant announcing itself in the
    // label, and it should stay that way.
    const l6 = female.organs.find((organ) => organ.organ_id === "vertebra_l6");
    expect(l6?.ta2_latin).toBe("Vertebra lumbalis");
    expect(l6?.qualifier).toBe("L6");
    expect(male.organs.some((organ) => organ.organ_id === "vertebra_l6")).toBe(false);
  });
});
