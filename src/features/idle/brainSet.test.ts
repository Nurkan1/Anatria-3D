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
  it("recovers the hemisphere the source data leaves out", () => {
    // The defect this function exists for. Z-Anatomy files the right gyri
    // under `Central nervous system > Brain` and their left twins directly
    // under `Central nervous system`, so the obvious filter draws half a head.
    const set = brainOrganIds([
      organ({ organ_id: "cuneus_r", path: ["Central nervous system", "Brain", "Cerebrum"] }),
      organ({ organ_id: "cuneus_l", path: ["Central nervous system"] }),
    ]);

    expect(set).toEqual(["cuneus_l", "cuneus_r"]);
  });

  it("does not invent a twin that is not in the atlas", () => {
    // Pairing by name only ever *finds*; it must never assert. An id that
    // resolves to no mesh would be dropped later anyway, silently.
    const set = brainOrganIds([
      organ({ organ_id: "culmen_r", path: ["Central nervous system", "Brain"] }),
    ]);

    expect(set).toEqual(["culmen_r"]);
  });

  it("leaves unrelated structures alone even when their twin is cranial", () => {
    // The second pass runs over what the first pass chose, not over the whole
    // atlas. Widening it would drag in the twin of anything merely adjacent.
    const set = brainOrganIds([
      organ({ organ_id: "flocculus_l", path: ["Central nervous system", "Brain"] }),
      organ({ organ_id: "flocculus_r", path: ["Central nervous system"] }),
      organ({ organ_id: "kidney_l", system: "renal", path: ["Urinary system"] }),
      organ({ organ_id: "kidney_r", system: "renal", path: ["Urinary system"] }),
    ]);

    expect(set).toEqual(["flocculus_l", "flocculus_r"]);
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

  it("does not silently pretend to hold the deep midline structures", () => {
    // Documented absence, not an oversight. These sit outside the `Brain`
    // subtree with no lateral twin, so no naming rule reaches them — getting
    // them means asking the geometry, which belongs in the asset pipeline.
    // If a future manifest fixes the hierarchy this test fails, and that is
    // the point: it is how we find out the hole has closed.
    const set = new Set(brainOrganIds(organs));

    expect(set.has("corpus_callosum")).toBe(false);
  });
});
