import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";

import {
  BREATH_AXIS,
  BREATH_FILL,
  BREATH_FRAME,
  BREATH_PATTERNS,
  BREATH_ROLE,
  BREATH_TRAVEL,
  breathData,
  breathFill,
  breathingIn,
  breathOnBeforeCompile,
  breathRole,
  injectBreath,
} from "./breathing";
import { breathFrame } from "./BreathDriver";
import { flowMaterial } from "./bloodFlow";
import { beatChamber, isChamberWall } from "./heartbeat";

type Shader = Parameters<typeof injectBreath>[0];

const male = JSON.parse(
  readFileSync(join(__dirname, "../../../public/anatomy/manifest.json"), "utf8"),
) as { organs: ManifestOrgan[] };
const female = JSON.parse(
  readFileSync(join(__dirname, "../../../public/anatomy/manifest_female.json"), "utf8"),
) as { organs: ManifestOrgan[] };

const organ = (id: string, atlas = male): ManifestOrgan => {
  const found = atlas.organs.find((entry) => entry.organ_id === id);
  if (!found) throw new Error(`no ${id} in the atlas`);
  return found;
};
const roleOf = (id: string) => breathRole(organ(id), beatChamber(organ(id)) !== null);

describe("who does what in a breath, on the shipped atlas", () => {
  it("gives the lungs and their airways inside them the lung's part, and leaves the windpipe", () => {
    const lobes = male.organs.filter((entry) => entry.name_en.toLowerCase().includes("lobe of"));
    expect(lobes.length).toBeGreaterThan(3);
    for (const lobe of lobes.filter((entry) => entry.system === "respiratory")) {
      expect(breathRole(lobe)).toBe(BREATH_ROLE.lung);
    }
    expect(roleOf("trachea")).toBe(BREATH_ROLE.none);
  });

  it("finds the diaphragm, and leaves the marks where it is fixed to bone", () => {
    expect(roleOf("diaphragm")).toBe(BREATH_ROLE.diaphragm);
    expect(roleOf("diaphragm_ol")).toBe(BREATH_ROLE.none);
  });

  it("moves the rib cage and what covers it, and not the rest of the skeleton", () => {
    expect(roleOf("body_of_sternum")).toBe(BREATH_ROLE.chestWall);
    const ribs = male.organs.filter((entry) => /^(first|fifth|tenth) rib/i.test(entry.name_en));
    expect(ribs.length).toBeGreaterThan(0);
    for (const rib of ribs) expect(breathRole(rib)).toBe(BREATH_ROLE.chestWall);
    const femur = male.organs.find((entry) => entry.name_en.toLowerCase().startsWith("femur"));
    expect(femur && breathRole(femur)).toBe(BREATH_ROLE.none);
  });

  it("pushes down what lies under the diaphragm, and not a lymph node beside it", () => {
    expect(roleOf("liver")).toBe(BREATH_ROLE.viscera);
    const kidney = male.organs.find((entry) => entry.name_en.toLowerCase().startsWith("kidney"));
    expect(kidney && breathRole(kidney)).toBe(BREATH_ROLE.viscera);
    const node = male.organs.find((entry) => entry.name_en.toLowerCase().includes("pancreatic nodes"));
    expect(node && breathRole(node)).toBe(BREATH_ROLE.none);
  });

  it("lets the heart's chambers ride the diaphragm", () => {
    const chambers = male.organs.filter((entry) => beatChamber(entry) !== null);
    expect(chambers.length).toBeGreaterThan(0);
    for (const chamber of chambers) expect(breathRole(chamber, true)).toBe(BREATH_ROLE.heart);
  });

  it("moves the vessels inside the lung as the lung, and every other vessel by where it runs", () => {
    for (const id of ["right_pulmonary_artery", "posterior_basal_segmental_artery_of_left_lung", "left_inferior_pulmonary_vein"]) {
      expect(roleOf(id)).toBe(BREATH_ROLE.lung);
    }
    for (const id of ["thoracic_aorta", "azygos_vein", "internal_thoracic_veins_l", "posterior_intercostal_arteries_r"]) {
      expect(roleOf(id)).toBe(BREATH_ROLE.vessel);
    }
  });

  it("breathes the trunk-only body too, with what it has", () => {
    const moving = female.organs.filter((entry) => breathRole(entry) !== BREATH_ROLE.none);
    expect(moving.some((entry) => entry.name_en.toLowerCase().includes("liver"))).toBe(true);
  });

  it("leaves most of the body still", () => {
    // The vessels are placed by where they run, and the shader leaves those
    // outside the trunk still; what is counted here is what moves by name.
    const moving = male.organs.filter((entry) => {
      const role = breathRole(entry, beatChamber(entry) !== null);
      return role !== BREATH_ROLE.none && role !== BREATH_ROLE.vessel;
    });
    expect(moving.length).toBeGreaterThan(60);
    expect(moving.length / male.organs.length).toBeLessThan(0.2);
  });
});

describe("a breath in time", () => {
  for (const [id, pattern] of Object.entries(BREATH_PATTERNS)) {
    it(`${id}: empties, fills and empties once a period, and never jumps`, () => {
      expect(breathFill(0, pattern)).toBeCloseTo(0);
      expect(breathFill(pattern.period * pattern.inhale, pattern)).toBeCloseTo(1);
      expect(breathFill(pattern.period, pattern)).toBeCloseTo(0);
      let last = 0;
      for (let s = 0; s < pattern.period * 2; s += 0.02) {
        const now = breathFill(s, pattern);
        expect(now).toBeGreaterThanOrEqual(0);
        expect(now).toBeLessThanOrEqual(1);
        expect(Math.abs(now - last)).toBeLessThan(0.05);
        last = now;
      }
    });

    it(`${id}: breathes in faster than out, as at rest`, () => {
      expect(pattern.inhale).toBeLessThan(0.5);
      expect(breathingIn(pattern.period * 0.1, pattern)).toBe(true);
      expect(breathingIn(pattern.period * 0.8, pattern)).toBe(false);
    });
  }

  it("says the rates it shows", () => {
    expect(60 / BREATH_PATTERNS.quiet.period).toBe(12);
    expect(60 / BREATH_PATTERNS.deep.period).toBe(6);
  });

  it("moves the diaphragm by what a quiet breath moves it, and a deep one several times that", () => {
    // One to two centimetres at rest; several centimetres in a deep breath.
    expect(BREATH_TRAVEL.diaphragm).toBeGreaterThanOrEqual(0.01);
    expect(BREATH_TRAVEL.diaphragm).toBeLessThanOrEqual(0.02);
    expect(BREATH_TRAVEL.diaphragm * BREATH_PATTERNS.deep.depth).toBeGreaterThan(0.04);
    // And the chest wall far less than the diaphragm.
    expect(BREATH_TRAVEL.chestForward).toBeLessThan(BREATH_TRAVEL.diaphragm);
  });
});

describe("the shader", () => {
  const shader = (): Shader =>
    ({ uniforms: {}, vertexShader: "void main() {\n#include <project_vertex>\n}", fragmentShader: "" }) as unknown as Shader;

  it("shares the breath across materials and keeps the part per material", () => {
    const lung = shader();
    const rib = shader();
    breathOnBeforeCompile.call({ userData: breathData(organ("liver"), undefined) }, lung);
    breathOnBeforeCompile.call({ userData: { breathRole: BREATH_ROLE.chestWall } }, rib);
    expect(lung.uniforms.uBreathFill).toBe(BREATH_FILL);
    expect(rib.uniforms.uBreathFill).toBe(BREATH_FILL);
    expect(rib.uniforms.uBreathAxis).toBe(BREATH_AXIS);
    expect(lung.uniforms.uBreathRole!.value).toBe(BREATH_ROLE.viscera);
    expect(rib.uniforms.uBreathRole!.value).toBe(BREATH_ROLE.chestWall);
  });

  it("moves the vertex after the projection, so it composes with what moved it before", () => {
    const moved = shader();
    breathOnBeforeCompile.call({}, moved);
    const projected = moved.vertexShader.indexOf("#include <project_vertex>");
    expect(projected).toBeGreaterThan(-1);
    expect(moved.vertexShader.indexOf("breathWorld")).toBeGreaterThan(projected);
    // The lungs read the chest's shared heights, not their own.
    expect(moved.uniforms.uBreathFrame).toBe(BREATH_FRAME);
    // And costs one test when nothing breathes.
    expect(moved.vertexShader).toContain("if (uBreathFill > 0.0 && uBreathRole > 0.5)");
  });

  it("refuses a shader it does not recognise instead of moving nothing", () => {
    const strange = shader();
    strange.vertexShader = "void main() {}";
    expect(() => breathOnBeforeCompile.call({}, strange)).toThrow(/vertex chunk/);
  });
});

describe("what a material carries", () => {
  const box = { min: { y: 1.05 }, max: { y: 1.45 } };

  it("gives the diaphragm its own height, which its dome's motion is measured against", () => {
    expect(breathData(organ("diaphragm"), box).breathSpan).toEqual([1.05, 1.45]);
  });

  it("measures the lungs together instead, so a vessel inside one moves as the tissue around it", () => {
    expect(breathData(organ("right_pulmonary_artery"), box).breathSpan).toBeUndefined();
    const lobe = male.organs.find((entry) => entry.system === "respiratory" && breathRole(entry) === BREATH_ROLE.lung)!;
    expect(breathData(lobe, box).breathSpan).toBeUndefined();
  });

  it("gives everything still one shared object", () => {
    const femur = male.organs.find((entry) => entry.name_en.toLowerCase().startsWith("femur"))!;
    const humerus = male.organs.find((entry) => entry.name_en.toLowerCase().startsWith("humerus"))!;
    expect(breathData(femur, box)).toBe(breathData(humerus, box));
  });
});

describe("the chest's heights", () => {
  const at = (minY: number, maxY: number) => new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(1, maxY, 1));

  it("takes both lungs together, and the top of the heart's walls", () => {
    const lobes = male.organs.filter((entry) => entry.system === "respiratory" && breathRole(entry) === BREATH_ROLE.lung);
    const wall = male.organs.find((entry) => beatChamber(entry) !== null && isChamberWall(entry))!;
    const boxes = new Map<string, THREE.Box3>([
      [lobes[0]!.organ_id, at(1.2, 1.35)],
      [lobes[1]!.organ_id, at(1.15, 1.48)],
      [wall.organ_id, at(1.22, 1.37)],
    ]);
    expect(breathFrame(boxes, male.organs, 1.32)).toEqual([1.15, 1.48, 1.37]);
  });

  it("falls back to ordinary proportions for what is not loaded", () => {
    const [bottom, top, heart] = breathFrame(new Map(), male.organs, 1.3);
    expect(bottom).toBeCloseTo(1.14);
    expect(top).toBeCloseTo(1.44);
    expect(heart).toBeCloseTo(1.34);
  });
});

describe("the blood's light", () => {
  it("breathes as the vessel it lies over", () => {
    expect(flowMaterial("artery").userData.breathRole).toBe(BREATH_ROLE.vessel);
    expect(flowMaterial("vein").userData.breathRole).toBe(BREATH_ROLE.vessel);
    expect(flowMaterial("pulmonary_artery").userData.breathRole).toBe(BREATH_ROLE.lung);
    expect(flowMaterial("pulmonary_vein").userData.breathRole).toBe(BREATH_ROLE.lung);
    const shader = {
      uniforms: {},
      vertexShader: ["#include <common>", "void main() {", "#include <project_vertex>", "}"].join("\n"),
      fragmentShader: ["#include <common>", "vec4 diffuseColor = vec4( diffuse, opacity );"].join("\n"),
    } as unknown as Shader;
    const material = flowMaterial("artery");
    material.onBeforeCompile.call(material, shader, undefined as never);
    expect(shader.vertexShader).toContain("breathWorld");
    expect(shader.uniforms.uBreathRole!.value).toBe(BREATH_ROLE.vessel);
  });
});
