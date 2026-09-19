import { describe, expect, it } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";

import { FIGURE_FILE, studiedOrgans } from "./studied";

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
