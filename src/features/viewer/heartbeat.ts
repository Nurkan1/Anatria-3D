import * as THREE from "three";
import type { Material } from "three";

import type { ManifestOrgan } from "@/lib/schemas";

/**
 * The heart, beating — phase 0 of an experiment, built to be looked at and
 * measured before anything is built on it.
 *
 * # What moves, and what does not
 *
 * The atlas's heart is a set of static surfaces: the four chambers, the valve
 * leaflets, the papillary muscles, the coronary vessels. Nothing here is a
 * mechanical model of the myocardium. Each of those surfaces is drawn slightly
 * in towards the centre of the chamber it belongs to, by an amount that follows
 * the order of the cardiac cycle — the atria first, then after the
 * atrioventricular delay the ventricles. It is an illustration of the sequence,
 * and the controls say so.
 *
 * # Why in the vertex shader and not by moving the meshes
 *
 * Scaling the objects would scale each about its own glTF origin, which is not
 * the centre of anything anatomical, and the structures of one chamber would
 * drift apart. Drawing vertices towards a chosen point in the shader is exact
 * about where the point is, costs one uniform write a frame for all of them,
 * and leaves the geometry the pointer is tested against untouched.
 *
 * # Why the valves and the coronaries go with a chamber
 *
 * A papillary muscle that stayed still while its ventricle drew in would come
 * through the wall, and a coronary artery left behind would float off the
 * surface it runs on. Every heart structure is therefore assigned to the
 * chamber it sits in or on, and moves with that chamber's centre.
 */

export type Chamber = "right_atrium" | "left_atrium" | "right_ventricle" | "left_ventricle";

type HeartCandidate = Pick<ManifestOrgan, "system" | "ta2_latin" | "path">;

/** *dexter* as well as *dextra*: the nominative drops the e only in the others. */
const RIGHT = /dext(e)?r/;
const LEFT = /sinist(e)?r/;

/**
 * Which chamber a structure moves with, or null when it is not part of the
 * heart.
 *
 * Read from the Terminologia Anatomica name, in an order that matters: the
 * aortic valve's leaflets are named *dextra* and *sinistra* but belong to the
 * left ventricle, and the pulmonary valve's to the right, so the valve is
 * decided before the side is. The side is matched in both of the forms the
 * names use — *dexter* and *sinister* on a ventricle, *dextra*, *dextri*,
 * *sinistrae* on everything else. Anything the rules do not place is left still —
 * a structure that does not move is a smaller error than one that moves with
 * the wrong chamber.
 */
export function beatChamber(organ: HeartCandidate): Chamber | null {
  if (organ.system !== "cardiovascular") return null;
  const path = organ.path ?? [];
  if (!path.includes("Heart") && !path.includes("Cardiac vessels")) return null;

  const name = organ.ta2_latin.toLowerCase();
  if (/\batrium\b|\bauricula\b/.test(name)) {
    return RIGHT.test(name) ? "right_atrium" : "left_atrium";
  }
  if (/aortae/.test(name)) return "left_ventricle";
  if (/trunci pulmonalis/.test(name)) return "right_ventricle";
  if (/circumflexa|interventricularis/.test(name)) return "left_ventricle";
  // The cardiac veins whose names carry no side. The great cardiac vein runs
  // with the anterior interventricular and circumflex arteries, the middle one
  // up the posterior interventricular groove, and the coronary sinus along the
  // posterior atrioventricular groove at the base of the left ventricle.
  if (/magna cordis|media cordis|sinus coronarius/.test(name)) return "left_ventricle";
  if (LEFT.test(name)) return "left_ventricle";
  if (RIGHT.test(name)) return "right_ventricle";
  return null;
}

export function isAtrium(chamber: Chamber): boolean {
  return chamber === "right_atrium" || chamber === "left_atrium";
}

/** A resting adult rate. Phase 0 has no control for it. */
export const RESTING_BPM = 72;

/**
 * One cycle, in seconds from the start of atrial contraction.
 *
 * Rounded textbook timings at about 72 beats a minute, where a cycle lasts
 * 0.83 s: atrial systole about a tenth of a second, a short pause while the
 * impulse is delayed at the atrioventricular node, ventricular systole about
 * three tenths, and diastole for the rest.
 */
export const CYCLE = {
  atria: { start: 0, peak: 0.05, end: 0.12 },
  ventricles: { start: 0.14, peak: 0.26, end: 0.44 },
  /** First heart sound: the atrioventricular valves close as the ventricles start. */
  s1: 0.14,
  /** Second: the aortic and pulmonary valves close as ejection ends. */
  s2: 0.42,
} as const;

/**
 * How far a chamber draws in at the height of its contraction, as a fraction of
 * each vertex's distance from the chamber's centre.
 *
 * Small on purpose. The walls of neighbouring chambers lie against each other,
 * and a larger squeeze opens gaps between them that read as the model coming
 * apart rather than as a heart contracting.
 */
export const SQUEEZE = { atria: 0.06, ventricles: 0.08 } as const;

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function bump(t: number, phase: { start: number; peak: number; end: number }): number {
  if (t <= phase.start || t >= phase.end) return 0;
  return t < phase.peak
    ? smooth((t - phase.start) / (phase.peak - phase.start))
    : 1 - smooth((t - phase.peak) / (phase.end - phase.peak));
}

/** How far the atria and the ventricles are drawn in, `seconds` after the start. */
export function beatAt(seconds: number, bpm = RESTING_BPM): { atria: number; ventricles: number } {
  const period = 60 / bpm;
  const t = ((seconds % period) + period) % period;
  return {
    atria: SQUEEZE.atria * bump(t, CYCLE.atria),
    ventricles: SQUEEZE.ventricles * bump(t, CYCLE.ventricles),
  };
}

/**
 * Whether the cycle reached `mark` in the interval (`before`, `after`].
 *
 * What fires a heart sound. Asked of an interval rather than of a frame, so a
 * slow frame that steps over the moment still plays it, and never twice.
 */
export function passed(before: number, after: number, mark: number, bpm = RESTING_BPM): boolean {
  if (!(after > before)) return false;
  const period = 60 / bpm;
  const next = mark + (Math.floor((before - mark) / period) + 1) * period;
  return next <= after;
}

/** The shared contraction values. One write a frame reaches every heart material. */
export const BEAT_ATRIA = { value: 0 };
export const BEAT_VENTRICLES = { value: 0 };

type Shader = Parameters<Material["onBeforeCompile"]>[0];

/**
 * The same function object on every heart material, so they share one program.
 *
 * three calls it as a method, so `this` is the material, and each material's
 * own chamber centre and atrium flag travel on its `userData` — the pattern the
 * scanner's band uses, for the same reason.
 */
export function heartbeatOnBeforeCompile(this: unknown, shader: Shader): void {
  const chunk = "#include <project_vertex>";
  if (!shader.vertexShader.includes(chunk)) {
    throw new Error("Heartbeat: the expected three.js vertex chunk is missing.");
  }
  const owner = this as
    | { userData?: { beatAtrium?: number; beatCentre?: { value: THREE.Vector3 } } }
    | undefined;
  shader.uniforms.uBeatAtria = BEAT_ATRIA;
  shader.uniforms.uBeatVentricles = BEAT_VENTRICLES;
  shader.uniforms.uBeatIsAtrium = { value: owner?.userData?.beatAtrium ?? 0 };
  // The object itself, not a copy: the driver moves the centre as the mesh
  // moves, and the uniform has to see that without a recompile.
  shader.uniforms.uBeatCentre = owner?.userData?.beatCentre ?? { value: new THREE.Vector3() };

  shader.vertexShader =
    "uniform float uBeatAtria;\nuniform float uBeatVentricles;\n" +
    "uniform float uBeatIsAtrium;\nuniform vec3 uBeatCentre;\n" +
    shader.vertexShader.replace(
      chunk,
      "transformed = mix(transformed, uBeatCentre, " +
        `mix(uBeatVentricles, uBeatAtria, uBeatIsAtrium));\n${chunk}`,
    );
}

/** A heart mesh while it beats: what the driver needs to keep its centre right. */
export interface BeatingMesh {
  mesh: THREE.Mesh;
  chamber: Chamber;
  /** The uniform the shader reads, in the mesh's own coordinates. */
  centre: { value: THREE.Vector3 };
}

/**
 * The heart meshes currently beating, by structure.
 *
 * A registry rather than a prop, so the driver can reach two dozen meshes
 * without the three and a half thousand others re-rendering to hand them over.
 */
export const BEATING = new Map<string, BeatingMesh>();

/** Add one, and get back what removes it — but only if it is still this one. */
export function registerBeating(organId: string, entry: BeatingMesh): () => void {
  BEATING.set(organId, entry);
  return () => {
    if (BEATING.get(organId) === entry) BEATING.delete(organId);
  };
}

type Placed = Pick<ManifestOrgan, "organ_id" | "system" | "ta2_latin" | "path">;

/**
 * Where each chamber's centre is, in world space.
 *
 * Taken from the chamber's own wall — the structure named *Atrium dextrum*,
 * *Ventriculus sinister* — so the valves inside it and the vessels on it do not
 * pull the point off centre. A chamber the atlas has no wall for falls back to
 * everything assigned to it.
 */
export function chamberCentres(
  boxes: ReadonlyMap<string, THREE.Box3>,
  organs: readonly Placed[],
): Map<Chamber, THREE.Vector3> {
  const walls = new Map<Chamber, THREE.Box3>();
  const everything = new Map<Chamber, THREE.Box3>();
  for (const organ of organs) {
    const chamber = beatChamber(organ);
    const box = boxes.get(organ.organ_id);
    if (!chamber || !box || box.isEmpty()) continue;
    const all = everything.get(chamber) ?? new THREE.Box3();
    everything.set(chamber, all.union(box));
    if (/^(atrium|ventriculus)\b/i.test(organ.ta2_latin)) {
      const wall = walls.get(chamber) ?? new THREE.Box3();
      walls.set(chamber, wall.union(box));
    }
  }
  const centres = new Map<Chamber, THREE.Vector3>();
  for (const [chamber, box] of everything) {
    centres.set(chamber, (walls.get(chamber) ?? box).getCenter(new THREE.Vector3()));
  }
  return centres;
}
