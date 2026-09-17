import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  EJECTION_DELAY_S,
  flowMaterial,
  FLOW_FRAGMENT,
  PULSE_SLOTS,
  PulseTrain,
  vesselFlow,
} from "./bloodFlow";
import { RhythmPlayer, rhythm, type RhythmId } from "./rhythms";

const vessel = (path: string[], ta2_latin = "Arteria femoralis") => ({
  system: "cardiovascular" as const,
  path,
  ta2_latin,
});

describe("vesselFlow", () => {
  it("reads the direction of the blood from the atlas's hierarchy", () => {
    expect(vesselFlow(vessel(["Systemic arteries", "Aorta"], "Pars thoracica aortae"))).toBe("artery");
    expect(vesselFlow(vessel(["Systemic veins"], "Vena saphena magna"))).toBe("vein");
    expect(vesselFlow(vessel(["Pulmonary vessels", "Pulmonary arteries", "Left pulmonary artery'"], "Arteria lobaris"))).toBe(
      "pulmonary_artery",
    );
    expect(vesselFlow(vessel(["Pulmonary vessels", "Pulmonary veins", "Right superior pulmonary vein'"], "Vena"))).toBe(
      "pulmonary_vein",
    );
  });

  it("leaves out the vessels on the heart, which beat with it, so the light cannot slide off them", () => {
    expect(vesselFlow(vessel(["Cardiac vessels", "Arteries of heart"], "Arteria coronaria dextra"))).toBeNull();
    expect(vesselFlow(vessel(["Cardiac vessels", "Cardiac veins"], "Vena magna cordis"))).toBeNull();
    expect(vesselFlow(vessel(["Heart"], "Ventriculus sinister"))).toBeNull();
  });

  it("ignores every other system", () => {
    expect(vesselFlow({ system: "skeletal", path: ["Systemic arteries"], ta2_latin: "Femur" })).toBeNull();
  });
});

/** Play a rhythm with the flow following it, and report what the vessels show. */
function flow(id: RhythmId, seconds = 12) {
  const player = new RhythmPlayer(rhythm(id));
  const train = new PulseTrain();
  const ages = new Float32Array(PULSE_SLOTS);
  const strengths = new Float32Array(PULSE_SLOTS);
  let launched = 0;
  let t = 0;
  for (let frame = 0; frame < seconds * 60; frame++) {
    const next = t + 1 / 60;
    for (const level of player.advance(t, next).lub) {
      train.launch(next, level);
      launched++;
    }
    train.advance(next, next - t, ages, strengths);
    t = next;
  }
  return { launched, venous: train.venous, inFlight: strengths.filter((s) => s > 0).length };
}

describe("PulseTrain", () => {
  it("sends a pulse with every contraction, and brings the blood back", () => {
    const normal = flow("normal");
    expect(normal.launched).toBe(15);
    expect(normal.inFlight).toBeGreaterThan(0);
    expect(normal.venous).toBeGreaterThan(0.8);
  });

  it("has no pulse and drains the veins when the heart pumps nothing", () => {
    for (const id of ["ventricular_fibrillation", "asystole"] as const) {
      const arrest = flow(id);
      expect(arrest.launched).toBe(0);
      expect(arrest.inFlight).toBe(0);
      expect(arrest.venous).toBe(0);
    }
  });

  it("brings less back when fewer beats reach the ventricles", () => {
    expect(flow("av_block_3").venous).toBeLessThan(flow("normal").venous);
  });

  it("waits for the valves to open before the blood leaves", () => {
    const train = new PulseTrain();
    const ages = new Float32Array(PULSE_SLOTS);
    const strengths = new Float32Array(PULSE_SLOTS);
    train.launch(1, 1);
    train.advance(1, 0, ages, strengths);
    expect(ages[0]).toBeCloseTo(-EJECTION_DELAY_S, 6);
  });

  it("keeps no more pulses than the shader has slots for", () => {
    const train = new PulseTrain();
    const ages = new Float32Array(PULSE_SLOTS);
    const strengths = new Float32Array(PULSE_SLOTS);
    for (let i = 0; i < 20; i++) train.launch(i * 0.1, 1);
    train.advance(2, 0.1, ages, strengths);
    expect(strengths.filter((s) => s > 0).length).toBe(PULSE_SLOTS);
    // The newest are the ones kept.
    expect(Math.min(...Array.from(ages))).toBeCloseTo(2 - (1.9 + EJECTION_DELAY_S), 5);
  });
});

describe("flowMaterial", () => {
  it("is one shared material per kind, drawn as added light", () => {
    const material = flowMaterial("artery");
    expect(flowMaterial("artery")).toBe(material);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
  });

  it("shares one program across every kind", () => {
    expect(flowMaterial("vein").onBeforeCompile).toBe(flowMaterial("artery").onBeforeCompile);
  });

  it("finds the anchors it needs in three's basic shader", () => {
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as unknown as Parameters<THREE.Material["onBeforeCompile"]>[0];
    const material = flowMaterial("pulmonary_artery");
    material.onBeforeCompile.call(material, shader, undefined as never);
    expect(shader.vertexShader).toContain("vFlowWorld = (modelMatrix");
    expect(shader.fragmentShader).toContain(FLOW_FRAGMENT.trim().split("\n")[0]!);
    expect(shader.fragmentShader).toContain("opacity * flowGlow()");
    expect(shader.uniforms).toHaveProperty("uFlowSource");
  });
});
