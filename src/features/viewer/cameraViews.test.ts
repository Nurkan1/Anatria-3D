import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  DOLLY_IN,
  DOLLY_OUT,
  framingDistance,
  lateralSign,
  VIEW_ORDER,
  viewDirection,
} from "./cameraViews";

/** A model exported with the body's left at +X. */
const leftIsPositive = new Map([
  ["kidney_l", new THREE.Vector3(0.05, 1.0, 0)],
  ["kidney_r", new THREE.Vector3(-0.05, 1.0, 0)],
  ["lung_l", new THREE.Vector3(0.08, 1.3, 0)],
  ["lung_r", new THREE.Vector3(-0.08, 1.3, 0)],
  ["heart", new THREE.Vector3(0, 1.3, 0)],
]);

describe("lateralSign", () => {
  it("reads which way the body's left lies from its own paired structures", () => {
    expect(lateralSign(leftIsPositive.keys(), leftIsPositive)).toBe(1);
  });

  it("reads a model exported the other way round", () => {
    // The axes are known; which end of X is the body's left is an export
    // convention. Assuming it means a button labelled "left" that shows the
    // right side, which in a teaching tool is not a cosmetic bug.
    const mirrored = new Map(
      [...leftIsPositive].map(([id, p]) => [id, new THREE.Vector3(-p.x, p.y, p.z)]),
    );
    expect(lateralSign(mirrored.keys(), mirrored)).toBe(-1);
  });

  it("is not decided by a single oddly placed mesh", () => {
    // Counted rather than trusted to the first pair found: one stray structure
    // should not mirror the whole interface.
    const withOutlier = new Map(leftIsPositive);
    withOutlier.set("stray_l", new THREE.Vector3(-0.4, 0.5, 0));
    withOutlier.set("stray_r", new THREE.Vector3(0.4, 0.5, 0));
    expect(lateralSign(withOutlier.keys(), withOutlier)).toBe(1);
  });

  it("ignores a structure whose partner has not loaded", () => {
    const lonely = new Map([["kidney_l", new THREE.Vector3(0.05, 1, 0)]]);
    expect(lateralSign(lonely.keys(), lonely)).toBe(1);
  });

  it("has a default when the model offers nothing to measure", () => {
    expect(lateralSign([], new Map())).toBe(1);
  });
});

describe("viewDirection", () => {
  it("stands the camera on the side it is named after", () => {
    // To *look at* the left side the camera has to be on the left side, so the
    // sign is used directly rather than inverted — the mistake that produces a
    // mirrored atlas.
    expect(viewDirection("left", 1).x).toBeGreaterThan(0);
    expect(viewDirection("right", 1).x).toBeLessThan(0);
    expect(viewDirection("left", -1).x).toBeLessThan(0);
  });

  it("puts anterior and posterior on opposite sides of the body", () => {
    const front = viewDirection("anterior", 1);
    const back = viewDirection("posterior", 1);
    expect(front.dot(back)).toBeCloseTo(-1);
  });

  it("keeps the superior view off the pole", () => {
    // Straight down, the camera's up vector and its view direction are
    // parallel: the orbit has no defined orientation and the model spins on the
    // spot the moment it is dragged.
    const above = viewDirection("superior", 1);
    expect(above.y).toBeGreaterThan(0.99);
    expect(Math.abs(above.z)).toBeGreaterThan(0);
  });

  it("hands back a unit direction for every view", () => {
    // The rig multiplies these by a distance; a direction of any other length
    // would silently change how far away the camera ends up.
    for (const view of VIEW_ORDER) {
      expect(viewDirection(view, 1).length()).toBeCloseTo(1);
    }
  });
});

describe("framingDistance", () => {
  it("stands further back for a bigger subject", () => {
    expect(framingDistance(1, 45)).toBeGreaterThan(framingDistance(0.1, 45));
  });

  it("stands closer for a wider lens", () => {
    expect(framingDistance(1, 80)).toBeLessThan(framingDistance(1, 45));
  });

  it("leaves headroom rather than framing to the edges", () => {
    // Framed exactly, a body touches all four edges and reads as cropped
    // rather than as fitted.
    const exact = 1 / Math.tan((45 * Math.PI) / 360);
    expect(framingDistance(1, 45)).toBeGreaterThan(exact);
  });

  it("survives a subject with no measurable size", () => {
    expect(framingDistance(0, 45)).toBeGreaterThan(0);
  });
});

describe("the dolly steps", () => {
  it("undo each other exactly", () => {
    // In and out have to be reciprocal, or repeated zooming drifts and the
    // reader never gets back to where they started.
    expect(DOLLY_IN * DOLLY_OUT).toBeCloseTo(1);
  });

  it("moves in towards the subject, not away", () => {
    expect(DOLLY_IN).toBeLessThan(1);
    expect(DOLLY_OUT).toBeGreaterThan(1);
  });
});
