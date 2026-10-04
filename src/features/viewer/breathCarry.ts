import * as THREE from "three";

import type { Vertices } from "./heartbeat";

/**
 * Which parts of a vessel the organs under the diaphragm carry with them.
 *
 * # Why
 *
 * In a breath the liver, the spleen, the kidneys, the stomach and the pancreas
 * are pushed down a centimetre or more (`breathing.ts`). The vessels inside
 * them — the hepatic and portal veins, the intrarenal arteries, the splenic
 * vessels in the hilum — are structures of their own in the atlas, and left
 * still they were swallowed by the organ moving over them.
 *
 * # What is carried
 *
 * Not a vessel, a point of one. The renal artery leaves an aorta that does not
 * move and enters a kidney that does: carried whole it would tear away from
 * the aorta, left whole it would be swallowed by the kidney. So each vertex is
 * given a weight, 0 to 1: 1 inside one of those organs or within a couple of
 * centimetres of it, falling to 0 beyond, and held at 0 where the vessel
 * leaves the aorta or opens into the heart — anchors, here: the aorta does not
 * move with a breath, and the heart moves by its own measure, which a vessel
 * keeps where it joins it. Between, the vessel stretches, as it does in life.
 *
 * The inferior vena cava is why the heart is one. It leaves the liver, which
 * goes down twelve millimetres in a quiet breath, and enters the right atrium a
 * centimetre or two higher, which goes down five; carried with the liver all
 * the way, it opened a gap at the atrium.
 *
 * # How
 *
 * Measured once, on the meshes themselves, when the body starts breathing or
 * what is on screen changes — never per frame. The organs are drawn into a
 * grid of small cubes; the cubes their surface passes through are filled, and
 * so is everything the outside cannot reach without crossing that surface,
 * which is what inside means. A distance from that solid, and one from the
 * aorta, give the weight; each vessel vertex reads it from the grid. The
 * shader then mixes the vessel's own movement with the organs' by it.
 */

/** The size of a cube in the grid, in metres. */
export const CARRY_VOXEL = 0.005;
/** How far outside an organ a vessel is still carried, fading to nothing. */
export const CARRY_REACH = 0.02;
/**
 * Within this of the aorta nothing is carried; from `ANCHOR_FAR` on, all of it.
 * More than a cube across, so that reading between cubes cannot lift a branch
 * where it leaves the aorta's wall.
 */
export const ANCHOR_NEAR = 0.006;
export const ANCHOR_FAR = 0.02;
/**
 * The heart's hold, which only the vessels that open into it feel — the venae
 * cavae. In this atlas the hepatic veins lie six to twelve millimetres from
 * the heart, the diaphragm between them; held by the heart as every vessel is
 * held by the aorta, they were carried a third of the way where the liver
 * around them goes all of it. They open into the vena cava, not the heart, and
 * a liver going down moves away from the heart, not into it.
 */
export const HEART_NEAR = 0.006;
export const HEART_FAR = 0.015;
/** The attribute a measured vessel carries. Every breathing material reads 0 without it. */
export const CARRY_ATTRIBUTE = "breathCarry";

/** A mesh's vertices and where it is in the world. */
export interface PointSet {
  vertices: Vertices;
  matrixWorld: THREE.Matrix4;
}

/** The weight in space: one value per cube, read between cubes on a straight line. */
export interface CarryField {
  min: THREE.Vector3;
  size: [number, number, number];
  values: Float32Array;
  /** The selective holds, each 0 where it holds and 1 where it lets go. */
  selective: Float32Array[];
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Every vertex of a point set in world space, one after another. */
function eachWorld(set: PointSet, visit: (x: number, y: number, z: number) => void): void {
  const e = set.matrixWorld.elements;
  const { vertices } = set;
  for (let v = 0; v < vertices.count; v++) {
    const x = vertices.getX(v);
    const y = vertices.getY(v);
    const z = vertices.getZ(v);
    visit(
      e[0]! * x + e[4]! * y + e[8]! * z + e[12]!,
      e[1]! * x + e[5]! * y + e[9]! * z + e[13]!,
      e[2]! * x + e[6]! * y + e[10]! * z + e[14]!,
    );
  }
}

/**
 * Distance, in cubes, from every cube to the nearest seed — an approximation
 * of the straight-line distance, from two sweeps over the grid that look at
 * the thirteen neighbours already visited in each direction.
 */
function chamfer(seeds: Uint8Array, nx: number, ny: number, nz: number): Float32Array {
  const distance = new Float32Array(seeds.length);
  for (let i = 0; i < seeds.length; i++) distance[i] = seeds[i] ? 0 : Infinity;
  const offsets: [number, number, number, number][] = [];
  for (let dz = -1; dz <= 0; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        // The half of the neighbourhood that comes before a cube in a forward sweep.
        if (dz === 0 && (dy > 0 || (dy === 0 && dx >= 0))) continue;
        offsets.push([dx, dy, dz, Math.hypot(dx, dy, dz)]);
      }
    }
  }
  const sweep = (forward: boolean) => {
    const sign = forward ? 1 : -1;
    for (let k = forward ? 0 : nz - 1; forward ? k < nz : k >= 0; k += sign) {
      for (let j = forward ? 0 : ny - 1; forward ? j < ny : j >= 0; j += sign) {
        for (let i = forward ? 0 : nx - 1; forward ? i < nx : i >= 0; i += sign) {
          const here = i + nx * (j + ny * k);
          let best = distance[here]!;
          for (const [dx, dy, dz, cost] of offsets) {
            const x = i + sign * dx;
            const y = j + sign * dy;
            const z = k + sign * dz;
            if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
            const through = distance[x + nx * (y + ny * z)]! + cost;
            if (through < best) best = through;
          }
          distance[here] = best;
        }
      }
    }
  };
  sweep(true);
  sweep(false);
  return distance;
}

/** Structures that hold a vessel where it reaches them, and over how far. */
export interface AnchorGroup {
  sets: readonly PointSet[];
  near: number;
  far: number;
  /** Felt only by the vessels that ask for it (`carryWeights`'s `joinsHeart`), not by all. */
  selective?: boolean;
}

/**
 * The weight field for a set of organs that are carried and the structures
 * that anchor, or null when there are no organs to carry anything.
 */
export function carryField(carriers: readonly PointSet[], anchors: readonly AnchorGroup[]): CarryField | null {
  const bounds = new THREE.Box3();
  for (const carrier of carriers) eachWorld(carrier, (x, y, z) => bounds.expandByPoint(new THREE.Vector3(x, y, z)));
  if (bounds.isEmpty()) return null;
  // Room for the reach outside, and a free border the outside can flow around.
  bounds.expandByScalar(CARRY_REACH + 3 * CARRY_VOXEL);
  const min = bounds.min.clone();
  const extent = bounds.getSize(new THREE.Vector3());
  const nx = Math.ceil(extent.x / CARRY_VOXEL) + 1;
  const ny = Math.ceil(extent.y / CARRY_VOXEL) + 1;
  const nz = Math.ceil(extent.z / CARRY_VOXEL) + 1;
  const index = (x: number, y: number, z: number) => {
    const i = Math.floor((x - min.x) / CARRY_VOXEL);
    const j = Math.floor((y - min.y) / CARRY_VOXEL);
    const k = Math.floor((z - min.z) / CARRY_VOXEL);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
    return i + nx * (j + ny * k);
  };

  // The surface, thickened by a cube so a mesh coarser than the grid still
  // closes: the outside must not leak in between two vertices.
  const surface = new Uint8Array(nx * ny * nz);
  for (const carrier of carriers) {
    eachWorld(carrier, (x, y, z) => {
      const at = index(x, y, z);
      if (at >= 0) surface[at] = 1;
    });
  }
  const shell = new Uint8Array(surface.length);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!surface[i + nx * (j + ny * k)]) continue;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = i + dx;
              const y = j + dy;
              const z = k + dz;
              if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) shell[x + nx * (y + ny * z)] = 1;
            }
          }
        }
      }
    }
  }

  // Flood the outside in from the border; whatever it never reaches is inside.
  const outside = new Uint8Array(shell.length);
  const queue: number[] = [];
  const push = (i: number, j: number, k: number) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    const at = i + nx * (j + ny * k);
    if (shell[at] || outside[at]) return;
    outside[at] = 1;
    queue.push(at);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) push(i, j, k);
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const i = at % nx;
    const j = Math.floor(at / nx) % ny;
    const k = Math.floor(at / (nx * ny));
    push(i - 1, j, k);
    push(i + 1, j, k);
    push(i, j - 1, k);
    push(i, j + 1, k);
    push(i, j, k - 1);
    push(i, j, k + 1);
  }
  const solid = new Uint8Array(shell.length);
  for (let at = 0; at < solid.length; at++) solid[at] = outside[at] ? 0 : 1;

  const fromOrgan = chamfer(solid, nx, ny, nz);
  const values = new Float32Array(solid.length);
  for (let at = 0; at < values.length; at++) {
    values[at] = 1 - smooth(0, CARRY_REACH, fromOrgan[at]! * CARRY_VOXEL);
  }
  const selective: Float32Array[] = [];
  for (const group of anchors) {
    const anchored = new Uint8Array(shell.length);
    let any = false;
    for (const anchor of group.sets) {
      eachWorld(anchor, (x, y, z) => {
        const at = index(x, y, z);
        if (at < 0) return;
        anchored[at] = 1;
        any = true;
      });
    }
    if (!any) continue;
    const fromAnchor = chamfer(anchored, nx, ny, nz);
    const into = group.selective ? new Float32Array(values.length) : values;
    for (let at = 0; at < values.length; at++) {
      const free = smooth(group.near, group.far, fromAnchor[at]! * CARRY_VOXEL);
      into[at] = group.selective ? free : values[at]! * free;
    }
    if (group.selective) selective.push(into);
  }
  return { min, size: [nx, ny, nz], values, selective };
}

/**
 * The field at a point in world space, between cube centres on a straight
 * line; 0 outside it. `values` is the field's own weight unless another of its
 * grids is asked for.
 */
export function carryAt(field: CarryField, x: number, y: number, z: number, values = field.values): number {
  const [nx, ny, nz] = field.size;
  const fx = (x - field.min.x) / CARRY_VOXEL - 0.5;
  const fy = (y - field.min.y) / CARRY_VOXEL - 0.5;
  const fz = (z - field.min.z) / CARRY_VOXEL - 0.5;
  if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return 0;
  const i = Math.min(nx - 2, Math.floor(fx));
  const j = Math.min(ny - 2, Math.floor(fy));
  const k = Math.min(nz - 2, Math.floor(fz));
  const tx = fx - i;
  const ty = fy - j;
  const tz = fz - k;
  const v = (a: number, b: number, c: number) => values[i + a + nx * (j + b + ny * (k + c))]!;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(v(0, 0, 0), v(1, 0, 0), tx), lerp(v(0, 1, 0), v(1, 1, 0), tx), ty),
    lerp(lerp(v(0, 0, 1), v(1, 0, 1), tx), lerp(v(0, 1, 1), v(1, 1, 1), tx), ty),
    tz,
  );
}

/** Each vertex's weight, for the attribute. A vessel that `joinsHeart` feels the selective holds too. */
export function carryWeights(field: CarryField, target: PointSet, joinsHeart = false): Float32Array {
  const weights = new Float32Array(target.vertices.count);
  let v = 0;
  eachWorld(target, (x, y, z) => {
    let weight = carryAt(field, x, y, z);
    if (joinsHeart && weight > 0) {
      for (const hold of field.selective) weight *= carryAt(field, x, y, z, hold);
    }
    weights[v++] = weight;
  });
  return weights;
}

/** What a structure is to the measurement. */
/**
 * - `carrier`: an organ the breath pushes down, which carries what is in it.
 * - `anchor`: the aorta, which holds every vessel where it leaves it.
 * - `heart`: the heart, which holds only what opens into it.
 * - `vessel`, and `vena cava` for the vessels that open into the heart.
 */
export type CarryPart = "carrier" | "anchor" | "heart" | "vessel" | "vena cava";

export interface CarryMesh {
  mesh: THREE.Mesh;
  part: CarryPart;
}

/**
 * The meshes the measurement reads, by structure. A registry rather than a
 * prop, as the heartbeat's is: the driver reaches the few hundred it needs
 * without the rest of the atlas re-rendering to hand them over.
 */
export const CARRY_MESHES = new Map<string, CarryMesh>();

/** Bumped whenever a mesh joins or leaves, so the weights are measured again. */
export const CARRY_VERSION = { value: 0 };

/** Add one, and get back what removes it — but only if it is still this one. */
export function registerCarry(organId: string, entry: CarryMesh): () => void {
  CARRY_MESHES.set(organId, entry);
  CARRY_VERSION.value += 1;
  return () => {
    if (CARRY_MESHES.get(organId) !== entry) return;
    CARRY_MESHES.delete(organId);
    CARRY_VERSION.value += 1;
  };
}

/**
 * Where the registered meshes are, as one number in metres — so the driver can
 * tell the scene has moved (the exploded view slides structures apart, and
 * nothing in the scene's own revision says so) and measure again once it holds
 * still. A sum of world positions: a few hundred additions a frame.
 */
export function carryPlacement(): number {
  let sum = 0;
  for (const { mesh } of CARRY_MESHES.values()) {
    const e = mesh.matrixWorld.elements;
    sum += Math.abs(e[12]!) + Math.abs(e[13]!) + Math.abs(e[14]!);
  }
  return sum;
}

/** Published for the render panel: what the last measurement cost. */
export const CARRY_PROBE = { ms: -1, vessels: 0 };

/**
 * Measure every registered vessel against every registered organ, and write
 * the weights onto the vessels' geometry. A vessel nowhere near an organ is
 * skipped and keeps no attribute, which every breathing material reads as 0.
 */
export function measureCarry(): void {
  const started = performance.now();
  const setOf = (mesh: THREE.Mesh): PointSet => {
    mesh.updateWorldMatrix(true, false);
    return { vertices: mesh.geometry.getAttribute("position"), matrixWorld: mesh.matrixWorld };
  };
  const entries = [...CARRY_MESHES.values()];
  const of = (part: CarryPart) => entries.filter((entry) => entry.part === part).map((entry) => setOf(entry.mesh));
  const field = carryField(of("carrier"), [
    { sets: of("anchor"), near: ANCHOR_NEAR, far: ANCHOR_FAR },
    { sets: of("heart"), near: HEART_NEAR, far: HEART_FAR, selective: true },
  ]);
  let vessels = 0;
  if (field) {
    const [nx, ny, nz] = field.size;
    const reach = new THREE.Box3(
      field.min.clone(),
      field.min.clone().add(new THREE.Vector3(nx, ny, nz).multiplyScalar(CARRY_VOXEL)),
    );
    const box = new THREE.Box3();
    for (const entry of entries) {
      if (entry.part !== "vessel" && entry.part !== "vena cava") continue;
      const { geometry } = entry.mesh;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      entry.mesh.updateWorldMatrix(true, false);
      box.copy(geometry.boundingBox!).applyMatrix4(entry.mesh.matrixWorld);
      if (!box.intersectsBox(reach)) {
        if (geometry.getAttribute(CARRY_ATTRIBUTE)) geometry.deleteAttribute(CARRY_ATTRIBUTE);
        continue;
      }
      const weights = carryWeights(field, setOf(entry.mesh), entry.part === "vena cava");
      geometry.setAttribute(CARRY_ATTRIBUTE, new THREE.BufferAttribute(weights, 1));
      vessels += 1;
    }
  }
  CARRY_PROBE.ms = performance.now() - started;
  CARRY_PROBE.vessels = vessels;
}
