import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";

import {
  BREATH_AXIS,
  BREATH_FILL,
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
import { beatChamber } from "./heartbeat";

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

  it("lets the heart's chambers ride the diaphragm, and no other vessel", () => {
    const chambers = male.organs.filter((entry) => beatChamber(entry) !== null);
    expect(chambers.length).toBeGreaterThan(0);
    for (const chamber of chambers) expect(breathRole(chamber, true)).toBe(BREATH_ROLE.heart);
    const aorta = male.organs.find((entry) => entry.system === "cardiovascular" && beatChamber(entry) === null);
    expect(aorta && breathRole(aorta, false)).toBe(BREATH_ROLE.none);
  });

  it("breathes the trunk-only body too, with what it has", () => {
    const moving = female.organs.filter((entry) => breathRole(entry) !== BREATH_ROLE.none);
    expect(moving.some((entry) => entry.name_en.toLowerCase().includes("liver"))).toBe(true);
  });

  it("leaves most of the body still", () => {
    const moving = male.organs.filter((entry) => breathRole(entry, beatChamber(entry) !== null) !== BREATH_ROLE.none);
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

  it("gives the lungs and the diaphragm their height, which their motion is measured against", () => {
    expect(breathData(organ("diaphragm"), box).breathSpan).toEqual([1.05, 1.45]);
  });

  it("gives everything still one shared object", () => {
    const femur = male.organs.find((entry) => entry.name_en.toLowerCase().startsWith("femur"))!;
    const humerus = male.organs.find((entry) => entry.name_en.toLowerCase().startsWith("humerus"))!;
    expect(breathData(femur, box)).toBe(breathData(humerus, box));
  });
});
