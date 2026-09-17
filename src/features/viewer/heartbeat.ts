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
 * # Why the base stays where it is
 *
 * The great vessels do not move: the venae cavae, the pulmonary trunk and the
 * aorta are drawn where the atlas put them. A chamber drawn in evenly towards
 * its centre pulled its own top away from them, and a gap opened at every beat
 * exactly where the superior vena cava and the pulmonary trunk meet the heart.
 *
 * So each vertex is held in proportion to how near it is to the top of its
 * group of chambers — where those vessels join — and moves fully only once it
 * is a third of the way down. That is also closer to the truth than the even
 * squeeze was: the base of the heart is tethered by those vessels, and it is
 * the body of the chambers, and the apex, that visibly move.
 *
 * # Why the chambers stay joined to each other
 *
 * Holding the top was not enough. Each chamber draws in towards its own centre
 * and at its own moment — the atrium, then the ventricle — so where two
 * chambers' walls lie against each other they moved apart, and the right atrium
 * and the right ventricle opened a visible gap along the atrioventricular
 * groove.
 *
 * A plane across the heart's axis was tried first, and measured against the
 * real atlas before it was ever drawn: this heart is tilted so far that its
 * atria and its ventricles occupy almost the same heights, and a plane placed
 * from their bounding boxes ran through the middle of all four chambers. It
 * would have held the whole heart still.
 *
 * So each vertex is held by how close it actually is to another chamber's wall,
 * measured on the meshes themselves once, when the heartbeat starts: still
 * within four millimetres of one, fully free from a centimetre and a half. Only
 * the strips where chambers meet — the atrioventricular grooves, the septum —
 * stay put, and the coronary arteries that run in those grooves stay in them.
 * See `seamFreedom`.
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

/** Whether a structure is a chamber's own wall rather than something in or on it. */
export function isChamberWall(organ: Pick<ManifestOrgan, "ta2_latin">): boolean {
  return /^(atrium|ventriculus)\b/i.test(organ.ta2_latin);
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
 * apart rather than as a heart contracting. The atria's is raised to match the
 * ventricles': held at their top and where they meet the ventricles, they have
 * less of themselves left free to show it.
 */
export const SQUEEZE = { atria: 0.08, ventricles: 0.08 } as const;

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

/**
 * Where each group of chambers is held: the height of the top of its walls in
 * world space, and how far below that the hold has faded out. A reach of zero
 * holds nothing, which is what a material compiled before the heart has been
 * measured must do. See "Why the base stays where it is".
 */
export const BEAT_BASE_ATRIA = { value: 0 };
export const BEAT_BASE_VENTRICLES = { value: 0 };
export const BEAT_REACH_ATRIA = { value: 0 };
export const BEAT_REACH_VENTRICLES = { value: 0 };

/** How far down a group's own height the hold fades out. */
export const HOLD_FRACTION = 0.35;

/** Within this distance of another chamber's wall, in metres, a vertex does not move. */
export const SEAM_NEAR = 0.004;
/** From this distance on it moves fully. */
export const SEAM_FAR = 0.015;
/** Wall points closer together than this are measured as one. */
export const SEAM_SPACING = 0.004;
/** The attribute every beating geometry carries: 0 held at a seam, 1 free. */
export const SEAM_ATTRIBUTE = "beatSeamFree";

/** Published for the render panel: what measuring the seams last cost. */
export const HEART_PROBE = { seamMs: -1 };

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
  shader.uniforms.uBeatBaseAtria = BEAT_BASE_ATRIA;
  shader.uniforms.uBeatBaseVentricles = BEAT_BASE_VENTRICLES;
  shader.uniforms.uBeatReachAtria = BEAT_REACH_ATRIA;
  shader.uniforms.uBeatReachVentricles = BEAT_REACH_VENTRICLES;
  shader.uniforms.uBeatIsAtrium = { value: owner?.userData?.beatAtrium ?? 0 };
  // The object itself, not a copy: the driver moves the centre as the mesh
  // moves, and the uniform has to see that without a recompile.
  shader.uniforms.uBeatCentre = owner?.userData?.beatCentre ?? { value: new THREE.Vector3() };

  shader.vertexShader =
    `attribute float ${SEAM_ATTRIBUTE};\n` +
    "uniform float uBeatAtria;\nuniform float uBeatVentricles;\n" +
    "uniform float uBeatBaseAtria;\nuniform float uBeatBaseVentricles;\n" +
    "uniform float uBeatReachAtria;\nuniform float uBeatReachVentricles;\n" +
    "uniform float uBeatIsAtrium;\nuniform vec3 uBeatCentre;\n" +
    shader.vertexShader.replace(
      chunk,
      `float beatSqueeze = mix(uBeatVentricles, uBeatAtria, uBeatIsAtrium);
float beatBase = mix(uBeatBaseVentricles, uBeatBaseAtria, uBeatIsAtrium);
float beatReach = mix(uBeatReachVentricles, uBeatReachAtria, uBeatIsAtrium);
// How far below the top of its chambers this vertex lies, in world space: held
// still where the great vessels join, free to move a third of the way down.
float beatBelow = beatBase - (modelMatrix * vec4(transformed, 1.0)).y;
float beatFree = beatReach > 0.0 ? smoothstep(0.0, beatReach, beatBelow) : 1.0;
// And held where it lies against another chamber's wall — see seamFreedom.
transformed = mix(transformed, uBeatCentre, beatSqueeze * beatFree * ${SEAM_ATTRIBUTE});
${chunk}`,
    );
}

/** A heart mesh while it beats: what the driver needs to keep it right. */
export interface BeatingMesh {
  mesh: THREE.Mesh;
  chamber: Chamber;
  /** A chamber's own wall, which is what the seams are measured against. */
  wall: boolean;
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

/** Bumped whenever a mesh joins or leaves, so the seams are measured again. */
export const BEATING_VERSION = { value: 0 };

/** Add one, and get back what removes it — but only if it is still this one. */
export function registerBeating(organId: string, entry: BeatingMesh): () => void {
  BEATING.set(organId, entry);
  BEATING_VERSION.value += 1;
  return () => {
    if (BEATING.get(organId) !== entry) return;
    BEATING.delete(organId);
    BEATING_VERSION.value += 1;
  };
}

type Placed = Pick<ManifestOrgan, "organ_id" | "system" | "ta2_latin" | "path">;

/** The atria's walls and the ventricles' walls, each as one box. */
function wallGroups(
  boxes: ReadonlyMap<string, THREE.Box3>,
  organs: readonly Placed[],
): { atria: THREE.Box3; ventricles: THREE.Box3 } {
  const atria = new THREE.Box3();
  const ventricles = new THREE.Box3();
  for (const organ of organs) {
    const chamber = beatChamber(organ);
    const box = boxes.get(organ.organ_id);
    if (!chamber || !box || box.isEmpty() || !isChamberWall(organ)) continue;
    (isAtrium(chamber) ? atria : ventricles).union(box);
  }
  return { atria, ventricles };
}

export interface Hold {
  /** The height of the top of the group's walls, in world space. */
  base: number;
  /** How far below that the hold has faded out. */
  reach: number;
}

/**
 * Where the atria and the ventricles are each held still.
 *
 * From the walls only, like the centres. A group the atlas has no walls for is
 * null, and its structures are then free along their whole height — a heart
 * that separates slightly from its vessels is a smaller fault than one that
 * does not beat.
 */
export function chamberHolds(
  boxes: ReadonlyMap<string, THREE.Box3>,
  organs: readonly Placed[],
): { atria: Hold | null; ventricles: Hold | null } {
  const { atria, ventricles } = wallGroups(boxes, organs);
  const hold = (box: THREE.Box3): Hold | null =>
    box.isEmpty()
      ? null
      : { base: box.max.y, reach: HOLD_FRACTION * (box.max.y - box.min.y) };
  return { atria: hold(atria), ventricles: hold(ventricles) };
}

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
    if (isChamberWall(organ)) {
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

/** What measuring a seam needs of a geometry: its vertices, one axis at a time. */
export interface Vertices {
  count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

/** A mesh's vertices, the chamber it moves with, and where it is in the world. */
export interface ChamberPoints {
  chamber: Chamber;
  vertices: Vertices;
  matrixWorld: THREE.Matrix4;
}

const CHAMBER_INDEX: Readonly<Record<Chamber, number>> = {
  right_atrium: 0,
  left_atrium: 1,
  right_ventricle: 2,
  left_ventricle: 3,
};

/** The walls' points, bucketed by cells a seam's width across. */
export interface SeamGrid {
  cells: Map<number, number[]>;
}

/**
 * A number for a cell. Two cells whose numbers collide share a bucket and cost a
 * few extra distance checks; the distances themselves stay exact.
 */
function cellKey(i: number, j: number, k: number): number {
  return (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
}

/**
 * Every chamber wall's vertices in world space, thinned to one per few
 * millimetres and bucketed so a nearby point is found without looking at all of
 * them. The heart's walls are about thirty-seven thousand vertices; measuring
 * every vertex of the heart against all of them would be billions of distances.
 */
export function seamGrid(walls: readonly ChamberPoints[]): SeamGrid {
  const cells = new Map<number, number[]>();
  const taken = new Set<string>();
  for (const wall of walls) {
    const e = wall.matrixWorld.elements;
    const owner = CHAMBER_INDEX[wall.chamber];
    const { vertices } = wall;
    for (let v = 0; v < vertices.count; v++) {
      const x = vertices.getX(v);
      const y = vertices.getY(v);
      const z = vertices.getZ(v);
      const wx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      const wy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      const wz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      const voxel = `${Math.floor(wx / SEAM_SPACING)},${Math.floor(wy / SEAM_SPACING)},${Math.floor(wz / SEAM_SPACING)},${owner}`;
      if (taken.has(voxel)) continue;
      taken.add(voxel);
      const key = cellKey(Math.floor(wx / SEAM_FAR), Math.floor(wy / SEAM_FAR), Math.floor(wz / SEAM_FAR));
      let bucket = cells.get(key);
      if (!bucket) {
        bucket = [];
        cells.set(key, bucket);
      }
      bucket.push(wx, wy, wz, owner);
    }
  }
  return { cells };
}

/**
 * How free each vertex of a mesh is to move: 0 against another chamber's wall,
 * 1 from `SEAM_FAR` away, eased between.
 *
 * Its own chamber's wall is ignored — a ventricle's surface is not held by being
 * near itself — so what is measured is exactly where one chamber meets another.
 * The cells are `SEAM_FAR` across, so the twenty-seven around a vertex hold
 * every point near enough to matter.
 */
export function seamFreedom(grid: SeamGrid, target: ChamberPoints): Float32Array {
  const e = target.matrixWorld.elements;
  const own = CHAMBER_INDEX[target.chamber];
  const { vertices } = target;
  const free = new Float32Array(vertices.count);
  const nearSq = SEAM_NEAR * SEAM_NEAR;
  const span = SEAM_FAR - SEAM_NEAR;
  for (let v = 0; v < vertices.count; v++) {
    const x = vertices.getX(v);
    const y = vertices.getY(v);
    const z = vertices.getZ(v);
    const wx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
    const wy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
    const wz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    const ci = Math.floor(wx / SEAM_FAR);
    const cj = Math.floor(wy / SEAM_FAR);
    const ck = Math.floor(wz / SEAM_FAR);
    let nearest = Infinity;
    search: for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
          const bucket = grid.cells.get(cellKey(ci + di, cj + dj, ck + dk));
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b += 4) {
            if (bucket[b + 3] === own) continue;
            const dx = bucket[b]! - wx;
            const dy = bucket[b + 1]! - wy;
            const dz = bucket[b + 2]! - wz;
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq < nearest) {
              nearest = distanceSq;
              // Already as held as a vertex gets; nothing nearer changes that.
              if (distanceSq <= nearSq) break search;
            }
          }
        }
      }
    }
    free[v] = smooth((Math.sqrt(nearest) - SEAM_NEAR) / span);
  }
  return free;
}
