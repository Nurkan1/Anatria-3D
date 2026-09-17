import { describe, expect, it } from "vitest";
import {
  Box3,
  Material,
  MeshStandardMaterial,
  ShaderLib,
  UniformsUtils,
  Vector3,
  type WebGLRenderer,
} from "three";

import type { ManifestOrgan } from "@/lib/schemas";

import {
  BEAT_ATRIA,
  BEAT_VENTRICLES,
  BEATING,
  beatAt,
  beatChamber,
  chamberCentres,
  chamberHolds,
  HOLD_FRACTION,
  CYCLE,
  heartbeatOnBeforeCompile,
  passed,
  registerBeating,
  RESTING_BPM,
  SQUEEZE,
  type BeatingMesh,
} from "./heartbeat";

type Candidate = Pick<ManifestOrgan, "organ_id" | "system" | "ta2_latin" | "path">;

function inHeart(ta2_latin: string, path: string[] = ["Heart"], organ_id = ta2_latin): Candidate {
  return { organ_id, system: "cardiovascular", ta2_latin, path };
}

const CARDIAC_VESSELS = ["Cardiac vessels", "Arteries of heart"];

describe("which chamber a structure moves with", () => {
  it.each([
    ["Atrium dextrum", "right_atrium"],
    ["Atrium sinistrum", "left_atrium"],
    ["Ventriculus dexter", "right_ventricle"],
    ["Ventriculus sinister", "left_ventricle"],
    ["Musculus papillaris anterior ventriculi dextri", "right_ventricle"],
    ["Cuspis posterior valvae atrioventricularis sinistrae", "left_ventricle"],
    ["Cuspis septalis valvae atrioventricularis dextrae", "right_ventricle"],
  ] as const)("puts %s with the %s", (name, chamber) => {
    expect(beatChamber(inHeart(name))).toBe(chamber);
  });

  it("puts the aortic valve with the left ventricle, even the leaflet called right", () => {
    // The side in the name is the leaflet's, not the chamber's. Deciding by
    // side first would tear the aortic valve in two.
    expect(beatChamber(inHeart("Valvula coronaria dextra aortae"))).toBe("left_ventricle");
  });

  it("puts the pulmonary valve with the right ventricle, even the leaflet called left", () => {
    expect(
      beatChamber(inHeart("Valvula semilunaris sinistra valvae trunci pulmonalis")),
    ).toBe("right_ventricle");
  });

  it("moves the coronary arteries with the ventricle they run over", () => {
    expect(beatChamber(inHeart("Arteria coronaria dextra", CARDIAC_VESSELS))).toBe(
      "right_ventricle",
    );
    expect(
      beatChamber(
        inHeart("(Ramus inferolateralis dexter arteriae coronariae dextrae)", CARDIAC_VESSELS),
      ),
    ).toBe("right_ventricle");
    expect(beatChamber(inHeart("Arteria circumflexa cordis", CARDIAC_VESSELS))).toBe(
      "left_ventricle",
    );
    expect(beatChamber(inHeart("Arteria interventricularis anterior", CARDIAC_VESSELS))).toBe(
      "left_ventricle",
    );
  });

  it("moves the cardiac veins that name no side with the left ventricle", () => {
    // Left behind, they would float off the wall at every contraction.
    for (const vein of ["Vena magna cordis", "Vena media cordis", "Sinus coronarius"]) {
      expect(beatChamber(inHeart(vein, ["Cardiac vessels", "Veins of heart"]))).toBe(
        "left_ventricle",
      );
    }
  });

  it("leaves everything outside the heart alone", () => {
    expect(beatChamber(inHeart("Arteria femoralis dextra", ["Arteries of lower limb"]))).toBeNull();
    expect(
      beatChamber({ system: "nervous", ta2_latin: "Nervus vagus", path: ["Heart"] }),
    ).toBeNull();
  });
});

describe("the cardiac cycle", () => {
  it("contracts the atria before the ventricles", () => {
    const atrial = beatAt(CYCLE.atria.peak);
    expect(atrial.atria).toBeCloseTo(SQUEEZE.atria, 12);
    expect(atrial.ventricles).toBe(0);

    const ventricular = beatAt(CYCLE.ventricles.peak);
    expect(ventricular.ventricles).toBeCloseTo(SQUEEZE.ventricles, 12);
    expect(ventricular.atria).toBe(0);
  });

  it("rests in diastole", () => {
    expect(beatAt(0.6)).toEqual({ atria: 0, ventricles: 0 });
  });

  it("never draws in further than its limit, nor pushes out", () => {
    for (let t = 0; t < 2; t += 0.005) {
      const beat = beatAt(t);
      expect(beat.atria).toBeGreaterThanOrEqual(0);
      expect(beat.atria).toBeLessThanOrEqual(SQUEEZE.atria + 1e-12);
      expect(beat.ventricles).toBeGreaterThanOrEqual(0);
      expect(beat.ventricles).toBeLessThanOrEqual(SQUEEZE.ventricles + 1e-12);
    }
  });

  it("repeats every beat", () => {
    const period = 60 / RESTING_BPM;
    expect(beatAt(0.3 + period).ventricles).toBeCloseTo(beatAt(0.3).ventricles, 9);
  });

  it("closes the atrioventricular valves after the atria and before the semilunar ones", () => {
    expect(CYCLE.s1).toBeGreaterThanOrEqual(CYCLE.atria.end);
    expect(CYCLE.s1).toBeLessThan(CYCLE.s2);
  });
});

describe("when a heart sound plays", () => {
  it("plays each sound once a beat, however the frames fall", () => {
    let t = 0;
    let lub = 0;
    let dub = 0;
    for (let frame = 0; frame < 600; frame++) {
      const next = t + 1 / 60;
      if (passed(t, next, CYCLE.s1)) lub++;
      if (passed(t, next, CYCLE.s2)) dub++;
      t = next;
    }
    // Ten seconds at 72 a minute is twelve beats.
    expect(lub).toBe(12);
    expect(dub).toBe(12);
  });

  it("still plays when one slow frame steps right over the moment", () => {
    expect(passed(0.1, 0.5, CYCLE.s1)).toBe(true);
  });

  it("does not play again within the same beat", () => {
    expect(passed(0.15, 0.4, CYCLE.s1)).toBe(false);
  });

  it("finds the moment again in the next beat", () => {
    const period = 60 / RESTING_BPM;
    expect(passed(period - 0.01, period + CYCLE.s1, CYCLE.s1)).toBe(true);
  });
});

function shader() {
  return {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
  } as Parameters<Material["onBeforeCompile"]>[0];
}

describe("the shader", () => {
  it("shares one program between every heart material", () => {
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    a.onBeforeCompile = heartbeatOnBeforeCompile;
    b.onBeforeCompile = heartbeatOnBeforeCompile;
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
  });

  it("reads the shared contraction and this material's own centre", () => {
    const centre = { value: new Vector3(1, 2, 3) };
    const material = new MeshStandardMaterial();
    material.onBeforeCompile = heartbeatOnBeforeCompile;
    material.userData = { beatAtrium: 1, beatCentre: centre };
    const compiled = shader();
    material.onBeforeCompile(compiled, {} as WebGLRenderer);

    expect(compiled.uniforms.uBeatAtria).toBe(BEAT_ATRIA);
    expect(compiled.uniforms.uBeatVentricles).toBe(BEAT_VENTRICLES);
    // The same object, so the driver can move it without a recompile.
    expect(compiled.uniforms.uBeatCentre).toBe(centre);
    expect(compiled.uniforms.uBeatIsAtrium?.value).toBe(1);
  });

  it("holds the base still where the great vessels join", () => {
    // The fault he saw: an even squeeze pulled the top of the heart away from
    // the superior vena cava and the pulmonary trunk at every beat.
    const compiled = shader();
    heartbeatOnBeforeCompile(compiled);
    expect(compiled.vertexShader).toContain("smoothstep(0.0, beatReach, beatBelow)");
    expect(compiled.vertexShader).toContain("beatSqueeze * beatFree");
  });

  it("draws the vertex in before it is projected", () => {
    const compiled = shader();
    heartbeatOnBeforeCompile(compiled);
    const drawn = compiled.vertexShader.indexOf("transformed = mix(transformed, uBeatCentre");
    expect(drawn).toBeGreaterThan(-1);
    expect(drawn).toBeLessThan(compiled.vertexShader.indexOf("#include <project_vertex>"));
  });
});

describe("where each chamber's centre is", () => {
  const box = (x: number) => new Box3(new Vector3(x - 1, 0, 0), new Vector3(x + 1, 2, 2));

  it("takes the centre of the chamber's own wall", () => {
    // A papillary muscle is inside the ventricle; letting it pull the centre
    // would make the wall contract towards a point off to one side.
    const organs = [
      inHeart("Ventriculus sinister", ["Heart"], "left_ventricle"),
      inHeart("Musculus papillaris inferior ventriculi sinistri", ["Heart"], "papillary"),
    ];
    const boxes = new Map([
      ["left_ventricle", box(0)],
      ["papillary", box(10)],
    ]);
    expect(chamberCentres(boxes, organs).get("left_ventricle")?.x).toBeCloseTo(0, 12);
  });

  it("falls back to everything in a chamber the atlas has no wall for", () => {
    const organs = [
      inHeart("Musculus papillaris anterior ventriculi dextri", ["Heart"], "p1"),
      inHeart("Musculus papillaris septalis ventriculi dextri", ["Heart"], "p2"),
    ];
    const boxes = new Map([
      ["p1", box(0)],
      ["p2", box(4)],
    ]);
    expect(chamberCentres(boxes, organs).get("right_ventricle")?.x).toBeCloseTo(2, 12);
  });
});

describe("where the base is held", () => {
  it("holds each group at the top of its own walls", () => {
    const organs = [
      inHeart("Atrium dextrum", ["Heart"], "ra"),
      inHeart("Ventriculus sinister", ["Heart"], "lv"),
      inHeart("Musculus papillaris inferior ventriculi sinistri", ["Heart"], "papillary"),
    ];
    const boxes = new Map([
      ["ra", new Box3(new Vector3(0, 1.3, 0), new Vector3(1, 1.4, 1))],
      ["lv", new Box3(new Vector3(0, 1.1, 0), new Vector3(1, 1.3, 1))],
      // Inside the ventricle and taller than it on purpose: not a wall, so it
      // must not move where the ventricle is held.
      ["papillary", new Box3(new Vector3(0, 0, 0), new Vector3(1, 9, 1))],
    ]);
    const holds = chamberHolds(boxes, organs);
    expect(holds.atria?.base).toBeCloseTo(1.4, 12);
    expect(holds.atria?.reach).toBeCloseTo(HOLD_FRACTION * 0.1, 12);
    expect(holds.ventricles?.base).toBeCloseTo(1.3, 12);
    expect(holds.ventricles?.reach).toBeCloseTo(HOLD_FRACTION * 0.2, 12);
  });

  it("holds nothing for a group the atlas has no walls for", () => {
    const organs = [inHeart("Musculus papillaris anterior ventriculi dextri", ["Heart"], "p")];
    const boxes = new Map([["p", new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1))]]);
    expect(chamberHolds(boxes, organs)).toEqual({ atria: null, ventricles: null });
  });
});

describe("the registry of beating meshes", () => {
  it("does not remove a mesh that has replaced the one being cleaned up", () => {
    const first = { chamber: "left_atrium", centre: { value: new Vector3() }, mesh: {} } as unknown as BeatingMesh;
    const second = { ...first };
    const dropFirst = registerBeating("left_atrium", first);
    registerBeating("left_atrium", second);
    dropFirst();
    expect(BEATING.get("left_atrium")).toBe(second);
    BEATING.clear();
  });
});
