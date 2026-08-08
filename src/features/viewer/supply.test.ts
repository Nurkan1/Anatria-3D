import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { collectSupply, isSystemMeasured, studyEnvelope, SUPPLY_SYSTEM } from "./supply";

/** A box from its centre and half-extents, which is how anatomy reads. */
function box(centre: [number, number, number], half: [number, number, number]) {
  const c = new THREE.Vector3(...centre);
  const h = new THREE.Vector3(...half);
  return new THREE.Box3(c.clone().sub(h), c.clone().add(h));
}

/**
 * A heart at the origin, roughly 12 cm across, with the vessels the atlas
 * actually segments around it. The abdominal aorta is the one that matters:
 * it is the false positive a cruder rule would produce.
 */
const boxes = new Map<string, THREE.Box3>([
  ["heart", box([0, 0, 0], [0.06, 0.06, 0.04])],
  ["left_ventricle", box([-0.02, -0.02, 0], [0.03, 0.03, 0.03])],
  ["right_coronary_artery", box([0.04, 0.01, 0.02], [0.02, 0.03, 0.01])],
  ["ascending_aorta", box([0, 0.07, 0], [0.02, 0.03, 0.02])],
  ["aortic_arch", box([0, 0.11, 0], [0.04, 0.02, 0.02])],
  ["abdominal_aorta", box([0, -0.35, 0], [0.02, 0.15, 0.02])],
  ["femoral_artery", box([0.08, -0.8, 0], [0.02, 0.2, 0.02])],
]);

const vessels = [
  "right_coronary_artery",
  "ascending_aorta",
  "aortic_arch",
  "abdominal_aorta",
  "femoral_artery",
];

describe("collectSupply", () => {
  it("brings the vessels that reach the organ", () => {
    const found = collectSupply(["heart", "left_ventricle"], vessels, boxes);
    expect(found).toContain("right_coronary_artery");
    expect(found).toContain("ascending_aorta");
  });

  it("leaves behind the segments of the same vessel that do not", () => {
    // The whole reason proximity is defensible here: the atlas segments the
    // aorta, so the ascending part comes to the heart and the abdominal part
    // stays where it belongs. On a single continuous aorta mesh this rule
    // would drag the entire vessel tree into every study set.
    const found = collectSupply(["heart", "left_ventricle"], vessels, boxes);
    expect(found).not.toContain("abdominal_aorta");
    expect(found).not.toContain("femoral_artery");
  });

  it("never returns something already being studied", () => {
    // The caller is adding to a set; a member of it is not an addition, and
    // counting it as one would make the reported number a lie.
    const found = collectSupply(["heart", "ascending_aorta"], vessels, boxes);
    expect(found).not.toContain("ascending_aorta");
  });

  it("scales its reach to the study set, not to the body", () => {
    // The same margin has to mean something on an eye and on a liver. The arch
    // sits three centimetres clear of the heart: unrelated to a single
    // ventricle, touching distance for a set that already spans a leg.
    //
    // A fixed margin could only ever be right at one scale — generous enough
    // for a torso would swallow half the head around an eyeball.
    const small = collectSupply(["left_ventricle"], ["aortic_arch"], boxes);
    expect(small).toEqual([]);

    const large = collectSupply(["heart", "femoral_artery"], ["aortic_arch"], boxes);
    expect(large).toEqual(["aortic_arch"]);
  });

  it("answers nothing when the study set has not been measured", () => {
    expect(collectSupply(["never_loaded"], vessels, boxes)).toEqual([]);
  });

  it("skips a candidate with no geometry of its own", () => {
    const found = collectSupply(["heart"], [...vessels, "label_anchor"], boxes);
    expect(found).not.toContain("label_anchor");
  });
});

describe("studyEnvelope", () => {
  it("wraps every member of the set", () => {
    const envelope = studyEnvelope(["heart", "abdominal_aorta"], boxes)!;
    expect(envelope.containsBox(boxes.get("heart")!)).toBe(true);
    expect(envelope.containsBox(boxes.get("abdominal_aorta")!)).toBe(true);
  });

  it("is null when nothing in the set has been measured", () => {
    // Not the same as an empty answer, and the caller has to tell them apart:
    // it means the meshes have not arrived, not that nothing is nearby.
    expect(studyEnvelope(["never_loaded"], boxes)).toBeNull();
  });

  it("reaches slightly past the set, so a vessel that stops short still counts", () => {
    const bare = new THREE.Box3();
    for (const id of ["heart", "left_ventricle"]) bare.union(boxes.get(id)!);
    const envelope = studyEnvelope(["heart", "left_ventricle"], boxes)!;
    expect(envelope.containsBox(bare)).toBe(true);
    expect(envelope.min.y).toBeLessThan(bare.min.y);
  });
});

describe("isSystemMeasured", () => {
  it("is false while a system's meshes are still loading", () => {
    // Asking for vessels switches the system on and the meshes arrive after.
    // Answering "none found" in that window would be wrong in a way the reader
    // has no way to see through, so the caller waits instead.
    expect(isSystemMeasured(["not_loaded_yet", "nor_this"], boxes)).toBe(false);
  });

  it("is true as soon as one of them has arrived", () => {
    expect(isSystemMeasured(["not_loaded_yet", "aortic_arch"], boxes)).toBe(true);
  });
});

describe("SUPPLY_SYSTEM", () => {
  it("draws vessels and nerves from separate systems", () => {
    expect(SUPPLY_SYSTEM.vascular).toBe("cardiovascular");
    expect(SUPPLY_SYSTEM.neural).toBe("nervous");
  });
});
