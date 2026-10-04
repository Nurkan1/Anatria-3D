import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  ANCHOR_FAR,
  ANCHOR_NEAR,
  CARRY_REACH,
  carryAt,
  carryField,
  carryWeights,
  HEART_FAR,
  HEART_NEAR,
  type PointSet,
} from "./breathCarry";

/** Points as a point set, already in world space. */
function points(list: [number, number, number][]): PointSet {
  const flat = new Float32Array(list.flat());
  return { vertices: new THREE.BufferAttribute(flat, 3), matrixWorld: new THREE.Matrix4() };
}

/** The surface of a ball — hollow, as a mesh is — with roughly `spacing` between points. */
function ballSurface(centre: [number, number, number], radius: number, spacing: number): PointSet {
  const list: [number, number, number][] = [];
  const rings = Math.ceil((Math.PI * radius) / spacing);
  for (let r = 0; r <= rings; r++) {
    const polar = (Math.PI * r) / rings;
    const around = Math.max(1, Math.ceil((2 * Math.PI * radius * Math.sin(polar)) / spacing));
    for (let a = 0; a < around; a++) {
      const azimuth = (2 * Math.PI * a) / around;
      list.push([
        centre[0] + radius * Math.sin(polar) * Math.cos(azimuth),
        centre[1] + radius * Math.cos(polar),
        centre[2] + radius * Math.sin(polar) * Math.sin(azimuth),
      ]);
    }
  }
  return points(list);
}

/** A straight vessel or aorta, a point every millimetre. */
function line(from: [number, number, number], to: [number, number, number]): PointSet {
  const list: [number, number, number][] = [];
  const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const n = Math.ceil(length / 0.001);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    list.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]);
  }
  return points(list);
}

const KIDNEY: [number, number, number] = [0.08, 1.0, 0];
const kidney = ballSurface(KIDNEY, 0.03, 0.003);
const aorta = line([0, 0.9, 0], [0, 1.1, 0]);

describe("what the organs carry", () => {
  const held = (sets: PointSet[]) => [{ sets, near: ANCHOR_NEAR, far: ANCHOR_FAR }];
  const field = carryField([kidney], held([aorta]))!;

  it("carries all of what lies inside an organ, deep in it as well as near its surface", () => {
    expect(carryAt(field, ...KIDNEY)).toBeCloseTo(1, 2);
    expect(carryAt(field, KIDNEY[0] + 0.02, KIDNEY[1], KIDNEY[2])).toBeCloseTo(1, 2);
  });

  it("carries what runs just outside, less and less, and nothing beyond its reach", () => {
    const at = (gap: number) => carryAt(field, KIDNEY[0] + 0.03 + gap, KIDNEY[1], KIDNEY[2]);
    expect(at(0.003)).toBeGreaterThan(0.9);
    expect(at(0.015)).toBeLessThan(at(0.003));
    expect(at(CARRY_REACH + 0.015)).toBe(0);
  });

  it("holds a vessel still where it leaves the aorta, and stretches it from there to the organ", () => {
    const renal = carryWeights(field, line([0, 1.0, 0], [KIDNEY[0], KIDNEY[1], KIDNEY[2]]));
    expect(renal[0]!).toBeLessThan(0.01);
    expect(renal[renal.length - 1]).toBeCloseTo(1, 2);
    // Never moving back the way it came: the stretch runs one way.
    for (let i = 1; i < renal.length; i++) expect(renal[i]!).toBeGreaterThanOrEqual(renal[i - 1]! - 1e-3);
    // And no step a vertex apart large enough to show as a kink.
    for (let i = 1; i < renal.length; i++) expect(Math.abs(renal[i]! - renal[i - 1]!)).toBeLessThan(0.08);
  });

  it("carries nothing of the aorta itself, even beside an organ", () => {
    const beside = carryField([ballSurface([0.035, 1.0, 0], 0.03, 0.003)], held([aorta]))!;
    // Under a hundredth: a fraction of a millimetre even in a deep breath.
    expect(carryAt(beside, 0, 1.0, 0)).toBeLessThan(0.01);
    expect(carryAt(beside, ANCHOR_FAR + 0.01, 1.0, 0)).toBeGreaterThan(0.9);
  });

  it("still finds the inside of a mesh coarser than its grid", () => {
    const coarse = carryField([ballSurface(KIDNEY, 0.03, 0.009)], [])!;
    expect(carryAt(coarse, ...KIDNEY)).toBeCloseTo(1, 2);
  });

  it("leaves everything still when there is no organ to carry it", () => {
    expect(carryField([], held([aorta]))).toBeNull();
  });

  it("lets the heart hold only what opens into it, so the veins in the organ below stay carried", () => {
    // A heart sitting just above the organ: its wall 15 mm over the organ's top.
    const top = KIDNEY[1] + 0.03;
    const heart = line([KIDNEY[0] - 0.02, top + 0.015, 0], [KIDNEY[0] + 0.02, top + 0.015, 0]);
    const both = carryField([kidney], [{ sets: [heart], near: HEART_NEAR, far: HEART_FAR, selective: true }])!;
    // A vena cava running up out of the organ into the heart.
    const cava = line([KIDNEY[0], top - 0.01, 0], [KIDNEY[0], top + 0.015, 0]);
    const intoHeart = carryWeights(both, cava, true);
    // Carried where it is in the organ, and keeping the heart's movement where it opens into it.
    expect(intoHeart[0]!).toBeGreaterThan(0.95);
    expect(intoHeart[intoHeart.length - 1]!).toBeLessThan(0.01);
    // A vein in the organ the same few millimetres from the heart, which opens
    // into the vena cava and not the heart, goes all the way with the organ.
    const vein = line([KIDNEY[0] - 0.01, top - 0.006, 0], [KIDNEY[0] + 0.01, top - 0.006, 0]);
    for (const weight of carryWeights(both, vein)) expect(weight).toBeGreaterThan(0.95);
  });

  it("reads 0 outside the measured space", () => {
    expect(carryAt(field, 5, 5, 5)).toBe(0);
  });
});
