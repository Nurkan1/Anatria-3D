import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** One structure as `brain.json` lists it. */
export interface BrainStructure {
  node: string;
  name: string;
  latin: string;
  region: string;
  side: "left" | "right" | "midline";
}

/** One named part of the brain: both hemispheres of it, lit together. */
export interface BrainRegion {
  name: string;
  latin: string;
  /** Cerebrum, Cerebellum, Brainstem, Diencephalon or Ventricular system. */
  division: string;
  /** Centre in the brain's own space, where the label and impulses attach. */
  centre: THREE.Vector3;
}

export interface Brain {
  /**
   * Every structure merged into one geometry, centred and scaled to fit a unit
   * sphere, with a `region` attribute naming each vertex's region by index.
   */
  geometry: THREE.BufferGeometry;
  /** In mapping order: bottom to top, so the scan and the mapping move together. */
  regions: BrainRegion[];
  /** Brain-space height of the lowest and highest vertex. */
  bottom: number;
  top: number;
  /**
   * How the atlas's own space was moved into this one: subtract `centre`, then
   * multiply by `scale`. Anything else from the same atlas lands in the right
   * place by going through the same two steps.
   */
  normalise: { centre: THREE.Vector3; scale: number };
}

export interface BrainSource {
  /** The GLB holding the brain (Anatria3D's `nervous_male.glb`). */
  meshUrl: string;
  /** Which nodes are brain, and what they are called. */
  structures: readonly BrainStructure[];
  /** Where the Draco decoder lives, with a trailing slash. */
  dracoPath: string;
}

/**
 * One Draco decoder for everything the lab loads, however many loads overlap.
 *
 * Each DRACOLoader fetches and compiles the decoder and starts its own pool of
 * worker threads. The brain, the figure and the studied organs each had one,
 * so opening the lab set the decoder up three times over. Now the first user
 * makes it and the last one to let go frees it.
 */
const decoders = new Map<string, { loader: DRACOLoader; users: number }>();

export function acquireDraco(path: string): DRACOLoader {
  let entry = decoders.get(path);
  if (!entry) {
    entry = { loader: new DRACOLoader().setDecoderPath(path), users: 0 };
    decoders.set(path, entry);
  }
  entry.users += 1;
  return entry.loader;
}

export function releaseDraco(path: string): void {
  const entry = decoders.get(path);
  if (!entry) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  entry.loader.dispose();
  decoders.delete(path);
}

/**
 * Load the brain out of the atlas's nervous-system file.
 *
 * GLTFLoader passes every node name through `sanitizeNodeName`, so a node is
 * looked up both as the manifest spells it and sanitised — the same lookup
 * Anatria3D's own viewer does.
 */
export async function loadBrain(source: BrainSource): Promise<Brain> {
  const loader = new GLTFLoader().setDRACOLoader(acquireDraco(source.dracoPath));
  try {
    const gltf = await loader.loadAsync(source.meshUrl);
    gltf.scene.updateMatrixWorld(true);
    const nodes = new Map<string, THREE.Object3D>();
    gltf.scene.traverse((object) => nodes.set(object.name, object));
    return buildBrain(source.structures, (node) => nodes.get(node) ?? nodes.get(THREE.PropertyBinding.sanitizeNodeName(node)));
  } finally {
    releaseDraco(source.dracoPath);
  }
}

/** Kept apart from loading so it can be tested with plain meshes. */
export function buildBrain(
  structures: readonly BrainStructure[],
  find: (node: string) => THREE.Object3D | undefined,
): Brain {
  const regionIndex = new Map<string, number>();
  const regionInfo: { name: string; latin: string; division: string; box: THREE.Box3 }[] = [];
  const parts: THREE.BufferGeometry[] = [];

  for (const structure of structures) {
    const object = find(structure.node);
    if (!object) continue;
    let index = regionIndex.get(structure.name);
    if (index === undefined) {
      index = regionInfo.length;
      regionIndex.set(structure.name, index);
      regionInfo.push({ name: structure.name, latin: structure.latin, division: structure.region, box: new THREE.Box3() });
    }
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      parts.push(worldGeometry(mesh, index!));
    });
  }
  if (parts.length === 0) throw new Error("No brain structures were found in the mesh file.");

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error("The brain's meshes could not be merged.");

  // Centre on the brain and scale it to a unit sphere, so the scene can be
  // framed the same way whatever units the atlas uses.
  merged.computeBoundingSphere();
  const sphere = merged.boundingSphere!;
  const scale = 1 / sphere.radius;
  const centre = sphere.center.clone();
  merged.translate(-sphere.center.x, -sphere.center.y, -sphere.center.z);
  merged.scale(scale, scale, scale);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  // Region boxes, from the vertices as they now are.
  const position = merged.getAttribute("position") as THREE.BufferAttribute;
  const region = merged.getAttribute("region") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    regionInfo[region.getX(i)]!.box.expandByPoint(point);
  }

  // Mapping order: by height, so the rising scan plane and the region being
  // mapped are always in the same place. The region attribute is renumbered to
  // match, so index i in the activation texture is the i-th region mapped.
  const order = regionInfo
    .map((info, index) => ({ info, index, y: info.box.getCenter(new THREE.Vector3()).y }))
    .sort((a, b) => a.y - b.y);
  const renumber = new Map<number, number>();
  order.forEach((entry, rank) => renumber.set(entry.index, rank));
  for (let i = 0; i < region.count; i++) region.setX(i, renumber.get(region.getX(i))!);
  region.needsUpdate = true;

  return {
    geometry: merged,
    regions: order.map(({ info }) => ({
      name: info.name,
      latin: info.latin,
      division: info.division,
      centre: info.box.getCenter(new THREE.Vector3()),
    })),
    bottom: merged.boundingBox!.min.y,
    top: merged.boundingBox!.max.y,
    normalise: { centre, scale },
  };
}

/** A world-space copy of a mesh with only what the hologram needs, tagged with its region. */
export function worldGeometry(mesh: THREE.Mesh, region: number): THREE.BufferGeometry {
  mesh.updateWorldMatrix(true, false);
  const source = mesh.geometry;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", source.getAttribute("position").clone());
  if (source.getAttribute("normal")) geometry.setAttribute("normal", source.getAttribute("normal").clone());
  if (source.index) geometry.setIndex(source.index.clone());
  else geometry.setIndex([...Array(source.getAttribute("position").count).keys()]);
  geometry.applyMatrix4(mesh.matrixWorld);
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("region", new THREE.BufferAttribute(new Float32Array(count).fill(region), 1));
  return geometry;
}
