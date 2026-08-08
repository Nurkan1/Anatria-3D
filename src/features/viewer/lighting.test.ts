import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { studioLightDirections } from "./lighting";

const UP = new THREE.Vector3(0, 1, 0);
/** Looking down -Z, the default camera direction. */
const AHEAD = new THREE.Vector3(0, 0, -1);

describe("studioLightDirections", () => {
  it("returns three unit directions", () => {
    const rig = studioLightDirections(AHEAD, UP);
    for (const [name, direction] of Object.entries(rig)) {
      expect(direction.length(), name).toBeCloseTo(1);
    }
  });

  it("puts the key on the viewer's side and the rim behind the model", () => {
    // The point of the rig: whatever the camera faces is lit, and the far side
    // gets an edge rather than nothing.
    const rig = studioLightDirections(AHEAD, UP);
    expect(rig.key.dot(AHEAD)).toBeLessThan(0);
    expect(rig.rim.dot(AHEAD)).toBeGreaterThan(0);
  });

  it("puts the fill opposite the key rather than beside it", () => {
    const rig = studioLightDirections(AHEAD, UP);
    // Two lights from the same side would be one brighter light.
    expect(rig.key.dot(rig.fill)).toBeLessThan(0.5);
  });

  it("lifts the key above the camera so surfaces still turn away from it", () => {
    // A light exactly at the eye lights everything head-on and erases the
    // shading that carries form.
    const rig = studioLightDirections(AHEAD, UP);
    expect(rig.key.dot(UP)).toBeGreaterThan(0.3);
  });

  it("follows the camera round the model", () => {
    // The whole reason for the rig: orbiting to the back used to arrive at the
    // shaded side of everything.
    const front = studioLightDirections(AHEAD, UP);
    const behind = studioLightDirections(new THREE.Vector3(0, 0, 1), UP);

    expect(front.key.dot(behind.key)).toBeLessThan(0);
    // …and the key stays on the viewer's side from both.
    expect(behind.key.z).toBeLessThan(0);
    expect(front.key.z).toBeGreaterThan(0);
  });

  it("survives a camera looking straight along its own up axis", () => {
    // From directly overhead the cross product is degenerate. NaN positions
    // would black the scene out entirely.
    const rig = studioLightDirections(new THREE.Vector3(0, -1, 0), UP);
    for (const [name, direction] of Object.entries(rig)) {
      expect(Number.isFinite(direction.x + direction.y + direction.z), name).toBe(true);
      expect(direction.length(), name).toBeCloseTo(1);
    }
  });

  it("writes into the vectors it is given rather than allocating each frame", () => {
    // Called on every rendered frame.
    const reused = studioLightDirections(AHEAD, UP);
    const again = studioLightDirections(new THREE.Vector3(1, 0, 0), UP, reused);
    expect(again).toBe(reused);
    expect(again.key).toBe(reused.key);
  });

  it("accepts an unnormalised forward vector", () => {
    const long = studioLightDirections(new THREE.Vector3(0, 0, -50), UP);
    const unit = studioLightDirections(AHEAD, UP);
    expect(long.key.angleTo(unit.key)).toBeCloseTo(0);
  });
});
