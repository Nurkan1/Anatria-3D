import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";

import { buildEyeGroups, clampGaze, eyePart, isEyePart } from "./eyes";

const organ = (organ_id: string): ManifestOrgan => ({
  organ_id,
  ta2_latin: organ_id,
  name_en: organ_id,
  system: "nervous",
  mesh_file: "nervous_male.glb",
  node: organ_id,
  path: [],
});

const DEG = Math.PI / 180;

describe("eyePart", () => {
  it("reads the part and the side off an identifier", () => {
    expect(eyePart("sclera_l")).toEqual({ part: "sclera", side: "l" });
    expect(eyePart("cornea_r")).toEqual({ part: "cornea", side: "r" });
  });

  it("turns everything that lives inside the globe", () => {
    // The zonule reads like an orbital structure from its name and is not: it
    // runs from the ciliary body to the lens, both inside the globe. Left out,
    // it stayed put while the eye turned and poked through the sclera.
    for (const id of [
      "zonular_fibres_l",
      "posterior_segment_of_eyeball_r",
      "vitreous_body_l",
      "retina_r",
    ]) {
      expect(eyePart(id), id).not.toBeNull();
    }
  });

  it("leaves anything anchored to the orbit out of the globe", () => {
    // Each of these attaches to the globe at one end and to the orbit at the
    // other. Turning them rigidly would swing that far end through the skull.
    for (const id of [
      "lateral_rectus_muscle_l",
      "superior_oblique_muscle_r",
      "optic_nerve_ii_l",
      "central_retinal_artery_l",
      "long_posterior_ciliary_arteries_r",
      // Lockwood's ligament: a hammock slung under the globe from the sheaths
      // of the recti, anchored to the orbital walls. It suspends the eye; it
      // does not travel with it.
      "suspensory_ligament_of_eyeball_l",
    ]) {
      expect(eyePart(id), id).toBeNull();
    }
  });

  it("does not match a structure that merely contains a part's name", () => {
    expect(eyePart("sclera")).toBeNull();
    expect(eyePart("lens_of_something_else")).toBeNull();
    expect(isEyePart(organ("zonular_fibres_r"))).toBe(true);
  });
});

describe("buildEyeGroups", () => {
  const centres = new Map([
    ["sclera_l", new THREE.Vector3(-0.03, 1.6, 0)],
    ["cornea_l", new THREE.Vector3(-0.03, 1.6, 0.012)],
    ["sclera_r", new THREE.Vector3(0.03, 1.6, 0)],
    ["cornea_r", new THREE.Vector3(0.03, 1.6, 0.012)],
  ]);
  const parts = [
    "sclera_l",
    "cornea_l",
    "iris_l",
    "sclera_r",
    "cornea_r",
    "iris_r",
    "lateral_rectus_muscle_l",
  ].map(organ);

  it("finds both eyes and keeps the muscles out", () => {
    const eyes = buildEyeGroups(parts, centres);
    expect(eyes.map((eye) => eye.side)).toEqual(["l", "r"]);
    expect(eyes[0]!.organs.map((o) => o.organ_id)).toEqual([
      "sclera_l",
      "cornea_l",
      "iris_l",
    ]);
  });

  it("takes the resting gaze from the globe towards the cornea", () => {
    // Measured, not assumed: which axis is "forward" depends on how the atlas
    // was exported, and the cornea is at the front of an eye in any export.
    const eyes = buildEyeGroups(parts, centres);
    expect(eyes[0]!.restForward.z).toBeCloseTo(1);
    expect(eyes[0]!.restForward.length()).toBeCloseTo(1);
  });

  it("pivots about the globe rather than the group of parts", () => {
    const eyes = buildEyeGroups(parts, centres);
    expect(eyes[0]!.centre.toArray()).toEqual([-0.03, 1.6, 0]);
  });

  it("skips an eye with no measurable front or centre", () => {
    // Without both there is no pivot and no rest direction, and guessing either
    // shows up as an eye staring somewhere its owner is not.
    const partial = new Map([["sclera_l", new THREE.Vector3(0, 1.6, 0)]]);
    expect(buildEyeGroups(parts, partial)).toEqual([]);
  });

  it("finds nothing in a file that has no eyes", () => {
    expect(buildEyeGroups([organ("femur_l"), organ("tibia_r")], centres)).toEqual([]);
  });
});

describe("clampGaze", () => {
  const rest = new THREE.Vector3(0, 0, 1);

  it("looks straight at a target already within reach", () => {
    const target = new THREE.Vector3(0.2, 0, 1);
    const gaze = clampGaze(rest, target, 35 * DEG);
    expect(gaze.angleTo(target)).toBeCloseTo(0);
  });

  it("stops at the limit rather than rotating into the skull", () => {
    // A camera swung behind the head must not produce an eye facing backwards
    // inside its socket.
    const behind = new THREE.Vector3(0, 0, -1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      0.3,
    );
    const gaze = clampGaze(rest, behind, 35 * DEG);
    expect(gaze.angleTo(rest)).toBeCloseTo(35 * DEG);
  });

  it("turns towards the target it cannot reach, not away from it", () => {
    const right = new THREE.Vector3(1, 0, 0);
    const gaze = clampGaze(rest, right, 35 * DEG);
    expect(gaze.x).toBeGreaterThan(0);
    expect(gaze.angleTo(rest)).toBeCloseTo(35 * DEG);
  });

  it("returns a usable direction for a target directly behind", () => {
    // Every rotation axis is equally valid there, so the cross product is
    // degenerate — and a NaN quaternion would make the eye disappear.
    const gaze = clampGaze(rest, new THREE.Vector3(0, 0, -1), 35 * DEG);
    expect(Number.isFinite(gaze.x + gaze.y + gaze.z)).toBe(true);
    expect(gaze.length()).toBeCloseTo(1);
    expect(gaze.angleTo(rest)).toBeCloseTo(35 * DEG);
  });

  it("always returns a unit vector, whatever the target's length", () => {
    const gaze = clampGaze(rest, new THREE.Vector3(0, 0, 400), 35 * DEG);
    expect(gaze.length()).toBeCloseTo(1);
  });
});
