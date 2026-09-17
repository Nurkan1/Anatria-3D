import * as THREE from "three";

import type { ManifestOrgan } from "@/lib/schemas";

import { beatChamber, BLOOD_HEX, type Chamber } from "./heartbeat";

/**
 * The blood the heartbeat pushes, drawn as light moving through the vessels.
 *
 * # What it is, and what it is not
 *
 * Each ventricular contraction launches a pulse of light from the heart that
 * travels out through the arteries, fading as it goes, and the veins carry a
 * slow, steady glow back. It is not a simulation of flow. The distance a pulse
 * has travelled is measured **along the vessels** from the heart — see
 * `flowPaths.ts` — and in a straight line only for the rare piece the path
 * could not reach, or until the path has been measured.
 *
 * # Slowed to be seen
 *
 * A real pulse wave crosses the body in about a fifth of a second, faster than
 * an eye can follow. This one is slowed several times over, and the panel says
 * so, the same way it says the beat is illustrative.
 *
 * # Why the rhythm decides it
 *
 * The pulses come from the rhythm player's own first heart sounds — the moment
 * the ventricles contract — so whatever the chosen rhythm does, the blood does:
 * irregular pulses in atrial fibrillation, a missing one when a beat drops, and
 * none at all in ventricular fibrillation or asystole, where the venous glow
 * drains away too. That there is no pulse is the lesson.
 *
 * # Why one child mesh per vessel, sharing four materials
 *
 * The vessel's own material is left alone: the scanner and the heartbeat
 * already take turns attaching theirs, and a third would have to join that
 * ordering. A child mesh draws the light on top, additively, and every child of
 * one kind shares one material — so six hundred vessels are one program and
 * four sets of uniforms, written once a frame by the driver.
 */

export type FlowKind = "artery" | "vein" | "pulmonary_artery" | "pulmonary_vein";

/**
 * Which way the blood in this structure goes, or null for anything that is not
 * a vessel the light should travel through.
 *
 * Read from the atlas's own hierarchy, which already separates systemic from
 * pulmonary and arteries from veins. Anything that moves with the heartbeat is
 * left out — the coronary arteries and cardiac veins are drawn in with
 * their chamber by the heartbeat's shader, and a light drawn by a material that
 * does not share that squeeze would slide off them.
 */
export function vesselFlow(
  organ: Pick<ManifestOrgan, "system" | "path" | "ta2_latin">,
): FlowKind | null {
  if (organ.system !== "cardiovascular") return null;
  if (beatChamber(organ) !== null) return null;
  const path = organ.path ?? [];
  if (path.includes("Pulmonary arteries")) return "pulmonary_artery";
  if (path.includes("Pulmonary veins")) return "pulmonary_vein";
  if (path.includes("Systemic arteries") || path.includes("Arteries of heart")) return "artery";
  if (path.includes("Systemic veins") || path.includes("Cardiac veins")) return "vein";
  return null;
}

/** The chamber blood of each kind leaves from, or returns to. */
export const FLOW_CHAMBER: Readonly<Record<FlowKind, Chamber>> = {
  artery: "left_ventricle",
  pulmonary_artery: "right_ventricle",
  vein: "right_atrium",
  pulmonary_vein: "left_atrium",
};

/** How many pulses can be in flight at once. Enough for 170 bpm over the body. */
export const PULSE_SLOTS = 8;

/**
 * From the first heart sound to blood leaving the ventricle, in seconds: the
 * isovolumetric contraction, when the valves are shut and nothing moves yet.
 */
export const EJECTION_DELAY_S = 0.06;

/** How the light travels in each kind of vessel. Metres and seconds. */
export const FLOW_SHAPE = {
  /** A pulse's speed. Real pulse waves run at five to ten metres a second. */
  arterySpeed: 0.8,
  /** The lungs are close; slower, or the pulse is gone before it is seen. */
  pulmonarySpeed: 0.3,
  /** How long the bright band of a pulse is. */
  width: 0.07,
  /** Distance over which a pulse fades to a little over a third. */
  reach: 1.2,
  /** The venous glow's stripes: their spacing and how fast they drift home. */
  venousWave: 0.14,
  venousSpeed: 0.12,
} as const;

/** The longest a pulse is kept, by which time it has faded past the feet. */
const PULSE_LIFETIME_S = 3;
/** Pulses a normal heart launches over `OUTPUT_WINDOW_S`, as the venous yardstick. */
const OUTPUT_WINDOW_S = 3;
const NORMAL_PULSES_IN_WINDOW = (72 / 60) * OUTPUT_WINDOW_S;
/** How quickly the venous glow follows a change in output, in seconds. */
const VENOUS_SETTLE_S = 1.5;

interface Pulse {
  launch: number;
  strength: number;
}

/**
 * The pulses in flight, and how much blood is coming back.
 *
 * Plain arithmetic on the heartbeat's clock, kept apart from three so the
 * behaviour a rhythm teaches — a dropped pulse, no pulse, weak ones — can be
 * tested without a renderer.
 */
export class PulseTrain {
  private pulses: Pulse[] = [];
  /** Venous return, 0 to 1: how much blood the veins are seen to carry. */
  venous = 0;

  /** A ventricular contraction heard at `at`, at a strength relative to normal. */
  launch(at: number, strength: number): void {
    if (!(strength > 0)) return;
    this.pulses.push({ launch: at + EJECTION_DELAY_S, strength: Math.min(1, strength) });
    if (this.pulses.length > PULSE_SLOTS) this.pulses.splice(0, this.pulses.length - PULSE_SLOTS);
  }

  /**
   * Move to `now`, `step` seconds after the last call, and write every slot:
   * each pulse's age and strength, and an empty slot as strength zero.
   */
  advance(now: number, step: number, ages: Float32Array, strengths: Float32Array): void {
    this.pulses = this.pulses.filter((pulse) => now - pulse.launch < PULSE_LIFETIME_S);

    const recent = this.pulses
      .filter((pulse) => pulse.launch <= now && now - pulse.launch < OUTPUT_WINDOW_S)
      .reduce((sum, pulse) => sum + pulse.strength, 0);
    const target = Math.min(1, recent / NORMAL_PULSES_IN_WINDOW);
    this.venous += (target - this.venous) * Math.min(1, step / VENOUS_SETTLE_S);

    for (let slot = 0; slot < PULSE_SLOTS; slot++) {
      const pulse = this.pulses[slot];
      ages[slot] = pulse ? now - pulse.launch : -1;
      strengths[slot] = pulse ? pulse.strength : 0;
    }
  }

  reset(): void {
    this.pulses = [];
    this.venous = 0;
  }
}

/** Uniforms every flow material reads, written once a frame by the driver. */
export const FLOW_UNIFORMS = {
  uPulseAge: { value: new Float32Array(PULSE_SLOTS).fill(-1) },
  uPulseStrength: { value: new Float32Array(PULSE_SLOTS) },
  uVenous: { value: 0 },
  uFlowTime: { value: 0 },
};

/** Where each kind's blood leaves from or returns to, in world space. */
export const FLOW_SOURCES: Readonly<Record<FlowKind, { value: THREE.Vector3 }>> = {
  artery: { value: new THREE.Vector3() },
  vein: { value: new THREE.Vector3() },
  pulmonary_artery: { value: new THREE.Vector3() },
  pulmonary_vein: { value: new THREE.Vector3() },
};

/**
 * The colours, by the blood rather than by the vessel's name: the pulmonary
 * arteries carry blue blood and the pulmonary veins red, which is exactly the
 * thing students get wrong and the reason it is worth drawing. The same two
 * colours light the chambers, so the blood is one colour from heart to vessel.
 */
const FLOW_COLOUR: Readonly<Record<FlowKind, string>> = {
  artery: BLOOD_HEX.left,
  pulmonary_vein: BLOOD_HEX.left,
  vein: BLOOD_HEX.right,
  pulmonary_artery: BLOOD_HEX.right,
};

/**
 * How bright each kind is allowed to get. Noticed, never the loudest thing on
 * screen: at full strength the first version burned the lungs' arterial tree
 * white, because dozens of branches overlap and added light adds up.
 */
const FLOW_GAIN: Readonly<Record<FlowKind, number>> = {
  artery: 0.4,
  pulmonary_artery: 0.22,
  vein: 0.5,
  pulmonary_vein: 0.35,
};

/** 0 for a pulse travelling out, 1 for a steady drift home. */
const FLOW_MODE: Readonly<Record<FlowKind, number>> = {
  artery: 0,
  pulmonary_artery: 0,
  vein: 1,
  pulmonary_vein: 1,
};

type Shader = Parameters<THREE.Material["onBeforeCompile"]>[0];

/** The attribute each vessel carries: its distance along the vessels, plus one. */
export const FLOW_PATH_ATTRIBUTE = "flowPath";

/**
 * The vessels that join the chamber itself, where a path starts. See
 * `flowPaths.ts`: with these the pulse leaves through the ascending aorta,
 * not through whichever piece of aorta happens to pass nearest the ventricle.
 */
const SEED: Readonly<Record<FlowKind, RegExp>> = {
  artery: /^Aorta ascendens\b/i,
  pulmonary_artery: /^Truncus pulmonalis\b/i,
  vein: /^Vena cava (superior|inferior)\b/i,
  pulmonary_vein: /^Vena pulmonalis\b/i,
};

export function isFlowSeed(kind: FlowKind, organ: Pick<ManifestOrgan, "ta2_latin">): boolean {
  return SEED[kind].test(organ.ta2_latin);
}

/** A vessel mesh while its light is shown: what the driver measures paths on. */
export interface FlowingMesh {
  mesh: THREE.Mesh;
  kind: FlowKind;
  seed: boolean;
}

/** The vessels currently lit, by structure. */
export const FLOWING = new Map<string, FlowingMesh>();
/** Bumped whenever one joins or leaves, so the paths are measured again. */
export const FLOWING_VERSION = { value: 0 };

export function registerFlowing(organId: string, entry: FlowingMesh): () => void {
  FLOWING.set(organId, entry);
  FLOWING_VERSION.value += 1;
  return () => {
    if (FLOWING.get(organId) !== entry) return;
    FLOWING.delete(organId);
    FLOWING_VERSION.value += 1;
  };
}

/** Published for the render panel: what measuring the paths last cost. */
export const FLOW_PROBE = { pathMs: -1, vertices: 0 };

export const FLOW_VERTEX = /* glsl */ `
attribute float ${FLOW_PATH_ATTRIBUTE};
varying vec3 vFlowWorld;
varying float vFlowPath;
`;

export const FLOW_FRAGMENT = /* glsl */ `
uniform float uPulseAge[${PULSE_SLOTS}];
uniform float uPulseStrength[${PULSE_SLOTS}];
uniform float uVenous;
uniform float uFlowTime;
uniform vec3 uFlowSource;
uniform float uFlowMode;
uniform float uFlowSpeed;
uniform float uFlowGain;
varying vec3 vFlowWorld;
varying float vFlowPath;

float flowGlow() {
  // Along the vessel where it has been measured; zero means it has not.
  float d = vFlowPath > 0.5 ? vFlowPath - 1.0 : distance(vFlowWorld, uFlowSource);
  if (uFlowMode < 0.5) {
    float glow = 0.0;
    for (int i = 0; i < ${PULSE_SLOTS}; i++) {
      if (uPulseAge[i] < 0.0 || uPulseStrength[i] <= 0.0) continue;
      float front = uPulseAge[i] * uFlowSpeed;
      float x = (d - front) / ${FLOW_SHAPE.width.toFixed(3)};
      glow += uPulseStrength[i] * exp(-x * x) * exp(-front / ${FLOW_SHAPE.reach.toFixed(3)});
    }
    return uFlowGain * clamp(glow, 0.0, 1.0);
  }
  // Stripes that drift towards the heart: a pattern in (d + vt) moves to smaller d.
  float stripe = 0.5 + 0.5 * sin((d + uFlowTime * ${FLOW_SHAPE.venousSpeed.toFixed(3)}) * 6.2831853 / ${FLOW_SHAPE.venousWave.toFixed(3)});
  return uFlowGain * uVenous * (0.18 + 0.22 * stripe);
}
`;

/** One function object for every flow material, so all four share a program. */
function flowOnBeforeCompile(this: THREE.Material, shader: Shader): void {
  const data = this.userData as {
    flowSource: { value: THREE.Vector3 };
    flowMode: number;
    flowSpeed: number;
    flowGain: number;
  };
  Object.assign(shader.uniforms, FLOW_UNIFORMS, {
    uFlowSource: data.flowSource,
    uFlowMode: { value: data.flowMode },
    uFlowSpeed: { value: data.flowSpeed },
    uFlowGain: { value: data.flowGain },
  });
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${FLOW_VERTEX}`)
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n  vFlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vFlowPath = ${FLOW_PATH_ATTRIBUTE};`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${FLOW_FRAGMENT}`)
    .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( diffuse, opacity * flowGlow() );");
}

const materials = new Map<FlowKind, THREE.MeshBasicMaterial>();

/** The shared material for one kind of vessel, made on first use. */
export function flowMaterial(kind: FlowKind): THREE.MeshBasicMaterial {
  let material = materials.get(kind);
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      color: FLOW_COLOUR[kind],
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    material.userData = {
      flowSource: FLOW_SOURCES[kind],
      flowMode: FLOW_MODE[kind],
      flowGain: FLOW_GAIN[kind],
      flowSpeed: kind === "pulmonary_artery" ? FLOW_SHAPE.pulmonarySpeed : FLOW_SHAPE.arterySpeed,
    };
    material.onBeforeCompile = flowOnBeforeCompile;
    materials.set(kind, material);
  }
  return material;
}

/** Every flow material made so far, for the driver to hand the clipping planes to. */
export function flowMaterials(): Iterable<THREE.MeshBasicMaterial> {
  return materials.values();
}
