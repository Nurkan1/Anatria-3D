import { describe, expect, it } from "vitest";

import manifest from "../../../public/anatomy/manifest.json";
import type { ManifestOrgan } from "@/lib/schemas";

import { brainOrganIds, ENOUGH_TO_DRAW } from "./brainSet";

const organs = manifest.organs as unknown as ManifestOrgan[];

function organ(over: Partial<ManifestOrgan>): ManifestOrgan {
  return {
    organ_id: "x",
    ta2_latin: "X",
    name_en: "X",
    system: "nervous",
    mesh_file: "nervous_male.glb",
    node: "X",
    path: [],
    ...over,
  } as ManifestOrgan;
}

describe("brainOrganIds", () => {
  it("takes what the hierarchy says is in the brain, and nothing else", () => {
    // This was three tests describing a workaround: the manifest filed the
    // right gyri under `Brain` and their left twins directly under `Central
    // nervous system`, so this function paired `_r` with `_l` to recover the
    // missing hemisphere, while carefully not inventing twins that had no mesh.
    //
    // The hierarchy is repaired in the pipeline now, both sides are under
    // `Brain`, and the pairing pass was measured against the repaired manifest
    // and added nothing. So the rule is the plain filter it always wanted to
    // be, and a structure outside `Brain` is outside the brain — including one
    // whose twin is inside it, which the old rule would have dragged in.
    const set = brainOrganIds([
      organ({ organ_id: "cuneus_r", path: ["Central nervous system", "Brain", "Cerebrum"] }),
      organ({ organ_id: "cuneus_l", path: ["Central nervous system", "Brain", "Cerebrum"] }),
      organ({ organ_id: "dura_mater", path: ["Central nervous system", "Meninges"] }),
      organ({ organ_id: "kidney_l", system: "renal", path: ["Urinary system"] }),
    ]);

    expect(set).toEqual(["cuneus_l", "cuneus_r"]);
  });

  it("takes nothing from a manifest with no brain in it", () => {
    expect(brainOrganIds([organ({ organ_id: "kidney_l", system: "renal" })])).toEqual([]);
  });
});

describe("against the manifest actually shipped", () => {
  it("finds a brain worth drawing", () => {
    const set = brainOrganIds(organs);

    expect(set.length).toBeGreaterThanOrEqual(ENOUGH_TO_DRAW);
  });

  it("draws both hemispheres, which was the whole problem", () => {
    const set = new Set(brainOrganIds(organs));

    // One structure from each side that the naive filter got wrong.
    expect(set.has("cuneus_r")).toBe(true);
    expect(set.has("cuneus_l")).toBe(true);
    expect(set.has("precentral_gyrus_r")).toBe(true);
    expect(set.has("precentral_gyrus_l")).toBe(true);
  });

  it("is entirely inside one mesh file, so showing it loads nothing extra", () => {
    // The cheap version of this feature rests on exactly this: every brain
    // structure lives in `nervous_male.glb`, so if the nervous system is on
    // screen the geometry is already in memory and the resting screen costs
    // no download at all.
    const chosen = new Set(brainOrganIds(organs));
    const files = new Set(
      organs.filter((entry) => chosen.has(entry.organ_id)).map((entry) => entry.mesh_file),
    );

    expect([...files]).toEqual(["nervous_male.glb"]);
  });

  it("holds the deep midline structures, now that the hierarchy has them", () => {
    // This test used to assert the opposite, and said so: the deep midline
    // structures sat outside the `Brain` subtree with no lateral twin, so no
    // naming rule reached them, and it was written to fail the day the
    // hierarchy was repaired — "it is how we find out the hole has closed".
    //
    // It closed. `tools/asset-pipeline/hierarchy.mjs` refiles them, and the
    // assertion is inverted rather than deleted so the history of the hole
    // stays legible.
    const set = new Set(brainOrganIds(organs));

    expect(set.has("corpus_callosum")).toBe(true);
    expect(set.has("thalamus_l")).toBe(true);
    expect(set.has("fornix_l")).toBe(true);
    expect(set.has("hippocampus_l")).toBe(true);
  });
});
