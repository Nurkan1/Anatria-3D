import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";

import { BRIDGE_REACH, flowPaths, PATH_CELL, type PathMesh } from "./flowPaths";

/** Points every millimetre along straight segments, as a vessel's vertices. */
function line(points: [number, number, number][], seed = false, matrix = new Matrix4()): PathMesh {
  const xyz: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = new Vector3(...points[i]!);
    const b = new Vector3(...points[i + 1]!);
    const steps = Math.ceil(a.distanceTo(b) / 0.001);
    for (let s = 0; s < steps; s++) {
      const p = a.clone().lerp(b, s / steps);
      xyz.push(p.x, p.y, p.z);
    }
  }
  xyz.push(...points[points.length - 1]!);
  return {
    vertices: {
      count: xyz.length / 3,
      getX: (i) => xyz[i * 3]!,
      getY: (i) => xyz[i * 3 + 1]!,
      getZ: (i) => xyz[i * 3 + 2]!,
    },
    matrixWorld: matrix,
    seed,
  };
}

const at = (paths: Float32Array[], mesh: number, vertex: number) => paths[mesh]![vertex]! - 1;
const last = (mesh: PathMesh) => mesh.vertices.count - 1;

describe("flowPaths", () => {
  it("measures along a vessel that doubles back, not across the gap", () => {
    // A hairpin: out 30 cm, across 4 cm, back 30 cm. Its far end is 4 cm from
    // the start in a straight line and 64 cm along the vessel.
    const hairpin = line([
      [0, 0, 0],
      [0.3, 0, 0],
      [0.3, 0.04, 0],
      [0, 0.04, 0],
    ]);
    const paths = flowPaths([hairpin], new Vector3(0, 0, 0));
    expect(at(paths, 0, last(hairpin))).toBeGreaterThan(0.6);
    expect(at(paths, 0, last(hairpin))).toBeLessThan(0.68);
  });

  it("starts at the vessel that leaves the heart, not the nearest one", () => {
    // The descending piece passes closer to the origin than the ascending one,
    // the way the thoracic aorta passes behind the heart.
    const ascending = line([[0.05, 0, 0], [0.05, 0.1, 0]], true);
    const arch = line([[0.05, 0.1, 0], [-0.01, 0.1, 0]]);
    const descending = line([[-0.01, 0.1, 0], [-0.01, -0.2, 0]]);
    const paths = flowPaths([ascending, arch, descending], new Vector3(0, 0, 0));
    // The point of the descending aorta beside the heart is reached the long
    // way round, over the arch.
    const beside = descending.vertices.count - 1 - 200;
    expect(at(paths, 2, beside)).toBeGreaterThan(0.25);
  });

  it("joins segments the atlas modelled separately", () => {
    const first = line([[0, 0, 0], [0.1, 0, 0]], true);
    const second = line([[0.1, 0, 0], [0.2, 0, 0]]);
    const paths = flowPaths([first, second], new Vector3(0, 0, 0));
    expect(at(paths, 1, last(second))).toBeCloseTo(0.2, 1);
  });

  it("bridges a small gap and carries the distance across it", () => {
    const first = line([[0, 0, 0], [0.1, 0, 0]], true);
    const second = line([[0.13, 0, 0], [0.23, 0, 0]]);
    const paths = flowPaths([first, second], new Vector3(0, 0, 0));
    expect(at(paths, 1, last(second))).toBeGreaterThan(0.2);
    expect(at(paths, 1, last(second))).toBeLessThan(0.25);
  });

  it("leaves a piece beyond reach unmeasured, for the straight line to cover", () => {
    const first = line([[0, 0, 0], [0.1, 0, 0]], true);
    const far = line([[0.1 + BRIDGE_REACH * 3, 0, 0], [0.5, 0, 0]]);
    const paths = flowPaths([first, far], new Vector3(0, 0, 0));
    expect(paths[1]!.every((value) => value === 0)).toBe(true);
    expect(paths[0]!.every((value) => value > 0)).toBe(true);
  });

  it("reads vertices in world space", () => {
    const moved = new Matrix4().makeTranslation(1, 0, 0);
    const vessel = line([[0, 0, 0], [0.1, 0, 0]], true, moved);
    const paths = flowPaths([vessel], new Vector3(1, 0, 0));
    expect(at(paths, 0, 0)).toBeLessThan(PATH_CELL);
  });

  it("returns empty paths for no vertices", () => {
    expect(flowPaths([], new Vector3())).toEqual([]);
  });
});
