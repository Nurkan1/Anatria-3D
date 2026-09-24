import { describe, expect, it } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";

import { FIGURE_FILE, studiedIds, studiedOrgans } from "./studied";

const organ = (organ_id: string, mesh_file = "cardiovascular_male.glb"): ManifestOrgan =>
  ({
    organ_id,
    name_en: organ_id.replace(/_/g, " "),
    ta2_latin: "",
    system: "cardiovascular",
    mesh_file,
    node: organ_id,
    path: [],
  }) as unknown as ManifestOrgan;

const ATLAS = [organ("left_ventricle"), organ("right_atrium"), organ("femur", "skeletal_male.glb"), organ("palm", FIGURE_FILE)];

describe("studiedIds", () => {
  const known = (id: string) => ATLAS.some((o) => o.organ_id === id);

  it("adds the structures the answers pinned to the ones that were selected", () => {
    expect(
      studiedIds(["femur"], ["The [[left_ventricle]] pumps; the [[right_atrium]] receives.", "Again the [[left_ventricle]]."], known),
    ).toEqual(["femur", "left_ventricle", "right_atrium", "left_ventricle"]);
  });

  it("ignores pins the atlas does not know", () => {
    expect(studiedIds([], ["The [[spleen_of_omelas]] is not real."], known)).toEqual([]);
  });
});

describe("studiedOrgans", () => {
  it("finds each structure's mesh, in the order it was studied", () => {
    expect(studiedOrgans(["femur", "left_ventricle"], ATLAS)).toEqual([
      { id: "femur", name: "femur", node: "femur", file: "skeletal_male.glb" },
      { id: "left_ventricle", name: "left ventricle", node: "left_ventricle", file: "cardiovascular_male.glb" },
    ]);
  });

  it("lists a structure studied twice once", () => {
    expect(studiedOrgans(["right_atrium", "right_atrium"], ATLAS)).toHaveLength(1);
  });

  it("skips what the male atlas does not hold, and the surface the figure already is", () => {
    expect(studiedOrgans(["uterus", "palm", "femur"], ATLAS).map((o) => o.id)).toEqual(["femur"]);
  });

  it("stops at the limit", () => {
    expect(studiedOrgans(["left_ventricle", "right_atrium", "femur"], ATLAS, 2)).toHaveLength(2);
  });
});
