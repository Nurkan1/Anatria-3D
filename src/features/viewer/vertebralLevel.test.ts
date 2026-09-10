import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { levelAt, vertebralLevel } from "./vertebralLevel";

describe("reading a level off an identifier", () => {
  it("names the numbered vertebrae", () => {
    expect(vertebralLevel("vertebra_t8")).toBe("T8");
    expect(vertebralLevel("vertebra_t12")).toBe("T12");
    expect(vertebralLevel("vertebra_c7")).toBe("C7");
    expect(vertebralLevel("vertebra_l5")).toBe("L5");
  });

  it("knows the two that anatomy names rather than numbers", () => {
    expect(vertebralLevel("atlas_c1")).toBe("C1");
    expect(vertebralLevel("axis_c2")).toBe("C2");
  });

  it("names the discs the way a report does", () => {
    // "At the L4–L5 disc" is a real sentence a clinician says; "at 1.02 m" is
    // not one anybody has ever said.
    expect(vertebralLevel("intervertebral_disc_l4_l5")).toBe("L4–L5");
    expect(vertebralLevel("intervertebral_disc_c7_t1")).toBe("C7–T1");
    expect(vertebralLevel("intervertebral_disc_l5_s1")).toBe("L5–S1");
  });

  it("takes the sacrum and the coccyx as levels of their own", () => {
    expect(vertebralLevel("sacrum")).toBe("S");
    expect(vertebralLevel("coccyx")).toBe("Co");
  });

  it("is not fooled by the things that merely start the same way", () => {
    // The trap this is anchored against: three structures in this atlas begin
    // with the same nine letters and none of them is a level.
    expect(vertebralLevel("vertebral_artery_l")).toBeNull();
    expect(vertebralLevel("vertebral_vein_r")).toBeNull();
    expect(vertebralLevel("vertebral_region_l")).toBeNull();
  });

  it("says nothing about anything else", () => {
    expect(vertebralLevel("heart")).toBeNull();
    expect(vertebralLevel("")).toBeNull();
  });
});

describe("finding the level at a height", () => {
  function column(): Map<string, THREE.Box3> {
    const boxes = new Map<string, THREE.Box3>();
    const put = (id: string, from: number, to: number) =>
      boxes.set(
        id,
        new THREE.Box3(new THREE.Vector3(-0.05, from, -0.05), new THREE.Vector3(0.05, to, 0.05)),
      );
    // Overlapping on purpose: a spinous process reaches down past the body of
    // the vertebra below it, which is why containment alone is not enough.
    put("vertebra_t7", 1.2, 1.26);
    put("vertebra_t8", 1.14, 1.21);
    put("heart", 1.1, 1.3);
    return boxes;
  }

  it("names the level a height is inside", () => {
    expect(levelAt(column(), 1.24)).toBe("T7");
    expect(levelAt(column(), 1.16)).toBe("T8");
  });

  it("settles an overlap on the nearest centre", () => {
    // Both boxes contain these heights; the centres decide. T7 is centred on
    // 1.23 and T8 on 1.175, so the answer swings across the midpoint between
    // them — the level a height *is*, not a level it merely touches.
    expect(levelAt(column(), 1.205)).toBe("T7");
    expect(levelAt(column(), 1.201)).toBe("T8");
  });

  it("says nothing where there is no vertebra", () => {
    // The important one. A plane through the ankle is not "roughly L5": it is
    // nowhere near the spine, and a label there would be a confident falsehood
    // in the one place a reader cannot check it.
    expect(levelAt(column(), 0.2)).toBeNull();
    expect(levelAt(column(), 1.9)).toBeNull();
  });

  it("does not mistake a big organ for a level", () => {
    expect(levelAt(column(), 1.28)).toBeNull();
  });
});
